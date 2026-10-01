import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { loginHistory, products, transactions, users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export class StoreError extends Error {}
export class NotFoundError extends StoreError {}
export class ValidationError extends StoreError {}
export class ConflictError extends StoreError {}

type ProductRow = typeof products.$inferSelect;
type UserRow = typeof users.$inferSelect;
export type FormInput = Record<string, unknown>;

export interface Product {
  product_id: string; barcode: string; name: string; category: string; description: string;
  quantity: number; minimum_quantity: number; location: string; created_at: Date; updated_at: Date;
}
export interface User {
  user_id: string; name: string; username: string; role: string; enabled: boolean;
  created_at: Date; last_login: Date | null; must_change_password: boolean;
}

const publicProduct = (r: ProductRow): Product => ({
  product_id: r.productId ?? "", barcode: r.barcode, name: r.name, category: r.category, description: r.description,
  quantity: r.quantity, minimum_quantity: r.minimumQuantity, location: r.location, created_at: r.createdAt, updated_at: r.updatedAt,
});
const publicUser = (r: UserRow): User => ({
  user_id: r.userId ?? "", name: r.fullName || r.username, username: r.username, role: r.role, enabled: r.active,
  created_at: r.createdAt, last_login: r.lastLogin, must_change_password: r.mustChangePassword,
});

const str = (value: unknown) => String(value ?? "").trim();
const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

function cleanBarcode(value: unknown) {
  const barcode = str(value);
  if (!barcode || barcode.length > 128) throw new ValidationError("Barcode is required and must be 128 characters or fewer.");
  return barcode;
}

function wholeNumber(value: unknown, fallback: number, message: string) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(message);
  return n;
}

function normalizeRole(role: unknown) {
  const value = str(role || "Staff");
  const titled = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  return titled === "User" ? "Staff" : titled;
}

// ---- Accounts -------------------------------------------------------------

async function userRow(username: string) {
  const [row] = await db.select().from(users).where(eq(users.username, str(username).toLowerCase()));
  return row;
}

async function logEvent(username: string, successful: boolean, event: string, ip: string) {
  await db.insert(loginHistory).values({ username: username.slice(0, 100), successful, event, ipAddress: String(ip || "").slice(0, 64) });
}

export async function authenticate(username: unknown, password: unknown, ip: string) {
  const name = str(username).toLowerCase();
  const now = new Date();
  const match = name ? await userRow(name) : undefined;
  let valid = false;
  if (match) {
    const locked = !!match.lockedUntil && match.lockedUntil > now;
    valid = match.active && !locked && verifyPassword(match.passwordHash, String(password ?? ""));
  }
  await logEvent(match?.username || name || "Unknown", valid, "LOGIN", ip);
  if (match) {
    if (valid) {
      await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLogin: now }).where(eq(users.id, match.id));
    } else {
      const attempts = match.failedAttempts + 1;
      await db.update(users).set({
        failedAttempts: attempts,
        ...(attempts >= 5 ? { lockedUntil: new Date(now.getTime() + 15 * 60 * 1000) } : {}),
      }).where(eq(users.id, match.id));
    }
  }
  return valid && match ? publicUser(match) : null;
}

export const recordLogout = (username: string, ip: string) => logEvent(username, true, "LOGOUT", ip);
export const recordResetRequest = (requester: unknown, ip: string) =>
  logEvent(str(requester) || "Not provided", false, "PASSWORD RESET REQUEST", ip);

export async function getUser(username: string) {
  const row = await userRow(username);
  return row ? publicUser(row) : null;
}

export async function listUsers() {
  return (await db.select().from(users).orderBy(asc(users.id))).map(publicUser);
}

export async function listLoginActivity(limit = 100) {
  return db.select().from(loginHistory).orderBy(desc(loginHistory.id)).limit(limit);
}

export async function createUser(usernameInput: unknown, password: unknown, roleInput: unknown, nameInput: unknown, temporary = false) {
  const username = str(usernameInput).toLowerCase();
  const role = normalizeRole(roleInput);
  const name = str(nameInput || username);
  const pass = String(password ?? "");
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw new ValidationError("Username must be 3–40 characters using letters, numbers, dots, dashes, or underscores.");
  if (pass.length < 10) throw new ValidationError("Password must be at least 10 characters.");
  if (role !== "Admin" && role !== "Staff") throw new ValidationError("Role must be Admin or Staff.");
  if (!name || name.length > 100) throw new ValidationError("Full name is required and must be 100 characters or fewer.");
  try {
    const [row] = await db.insert(users).values({
      fullName: name, username, passwordHash: hashPassword(pass), role, mustChangePassword: temporary,
    }).returning();
    return publicUser(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("That username already exists.");
    throw error;
  }
}

export async function updateUser(username: string, changes: { role?: unknown; enabled?: boolean; password?: string | null }) {
  const row = await userRow(username);
  if (!row) throw new NotFoundError("User not found.");
  const update: Partial<typeof users.$inferInsert> = {};
  if (changes.role !== undefined && changes.role !== null) {
    const role = normalizeRole(changes.role);
    if (role !== "Admin" && role !== "Staff") throw new ValidationError("Role must be Admin or Staff.");
    update.role = role;
  }
  if (changes.enabled !== undefined) update.active = changes.enabled;
  if (changes.password) {
    if (changes.password.length < 10) throw new ValidationError("Password must be at least 10 characters.");
    Object.assign(update, { passwordHash: hashPassword(changes.password), mustChangePassword: true, failedAttempts: 0, lockedUntil: null });
  }
  if (Object.keys(update).length) await db.update(users).set(update).where(eq(users.id, row.id));
}

export async function changePassword(username: string, current: unknown, next: unknown) {
  const newPassword = String(next ?? "");
  if (newPassword.length < 10) throw new ValidationError("New password must be at least 10 characters.");
  const row = await userRow(username);
  if (!row) throw new NotFoundError("User not found.");
  if (!verifyPassword(row.passwordHash, String(current ?? ""))) throw new ValidationError("Current password is incorrect.");
  await db.update(users).set({ passwordHash: hashPassword(newPassword), mustChangePassword: false }).where(eq(users.id, row.id));
}

// ---- Products ---------------------------------------------------------------

export async function listProducts() {
  return (await db.select().from(products).orderBy(asc(products.id))).map(publicProduct);
}

export async function findProduct(barcodeInput: unknown) {
  const barcode = cleanBarcode(barcodeInput);
  const [row] = await db.select().from(products).where(eq(products.barcode, barcode));
  return row ? publicProduct(row) : null;
}

export async function searchProducts(query: unknown, limit = 100) {
  const q = str(query);
  if (!q) return (await listProducts()).slice(0, limit);
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.select().from(products).where(or(
    ilike(products.productId, pattern), ilike(products.barcode, pattern), ilike(products.name, pattern),
    ilike(products.category, pattern), ilike(products.description, pattern), ilike(products.location, pattern),
  )).orderBy(asc(products.id)).limit(limit);
  return rows.map(publicProduct);
}

export async function createProduct(data: FormInput, username: string) {
  const barcode = cleanBarcode(data.barcode);
  const name = str(data.name || data.product_name), category = str(data.category), location = str(data.location), description = str(data.description);
  const quantity = wholeNumber(data.quantity, 0, "Quantity values must be whole numbers.");
  const minimum = wholeNumber(data.minimum_quantity ?? data.minimum, 5, "Quantity values must be whole numbers.");
  if (!name || name.length > 120 || !category || category.length > 80 || !location || location.length > 80 || description.length > 500)
    throw new ValidationError("Name, category, and location are required. Check the field limits.");
  if (quantity < 0 || minimum < 0) throw new ValidationError("Quantities cannot be negative.");
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(products).values({ barcode, name, category, description, quantity, minimumQuantity: minimum, location }).returning();
      await tx.insert(transactions).values({
        productId: created.productId ?? "", productName: name, barcode, action: "CREATE",
        quantityChanged: quantity, previousQuantity: 0, newQuantity: quantity, username,
      });
      return created;
    });
    return publicProduct(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A product with that barcode already exists.");
    throw error;
  }
}

export async function updateProduct(barcodeInput: string, data: FormInput, username: string) {
  const barcode = cleanBarcode(barcodeInput);
  const name = str(data.name), category = str(data.category), location = str(data.location), description = str(data.description);
  const minimum = wholeNumber(data.minimum_quantity, 5, "Minimum quantity must be a whole number.");
  if (!name || !category || !location || minimum < 0) throw new ValidationError("Enter valid product details and a non-negative minimum quantity.");
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(products)
      .set({ name, category, description, location, minimumQuantity: minimum, updatedAt: new Date() })
      .where(eq(products.barcode, barcode)).returning();
    if (!updated) return null;
    await tx.insert(transactions).values({
      productId: updated.productId ?? "", productName: name, barcode, action: "EDIT",
      quantityChanged: 0, previousQuantity: updated.quantity, newQuantity: updated.quantity, username,
    });
    return updated;
  });
  if (!row) throw new NotFoundError("Product not found.");
  return publicProduct(row);
}

export async function updateQuantity(barcodeInput: unknown, actionInput: unknown, amountInput: unknown, username: string) {
  const barcode = cleanBarcode(barcodeInput);
  const action = str(actionInput).toUpperCase();
  const amount = Number(amountInput);
  if (!Number.isInteger(amount)) throw new ValidationError("Amount must be a whole number.");
  if ((action !== "ADD" && action !== "REMOVE") || amount <= 0) throw new ValidationError("Choose add or remove and enter an amount greater than zero.");
  const row = await db.transaction(async (tx) => {
    // Lock the row so simultaneous scans can't both read the same starting quantity.
    const [current] = await tx.select().from(products).where(eq(products.barcode, barcode)).for("update");
    if (!current) throw new NotFoundError("Product not found.");
    const next = action === "ADD" ? current.quantity + amount : current.quantity - amount;
    if (next < 0) throw new ValidationError("Cannot remove more stock than is available.");
    const [updated] = await tx.update(products).set({ quantity: next, updatedAt: new Date() }).where(eq(products.id, current.id)).returning();
    await tx.insert(transactions).values({
      productId: current.productId ?? "", productName: current.name, barcode, action,
      quantityChanged: amount, previousQuantity: current.quantity, newQuantity: next, username,
    });
    return updated;
  });
  return publicProduct(row);
}

// ---- Transactions -------------------------------------------------------------

export type TransactionFilters = { product?: string; user?: string; action?: string; date?: string };

export async function listTransactions(limit = 100, filters: TransactionFilters = {}) {
  const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conditions = [];
  if (filters.product) {
    const p = like(filters.product);
    conditions.push(or(ilike(transactions.productName, p), ilike(transactions.productId, p), ilike(transactions.barcode, p)));
  }
  if (filters.user) conditions.push(ilike(transactions.username, like(filters.user)));
  if (filters.action) conditions.push(ilike(transactions.action, like(filters.action)));
  if (filters.date) conditions.push(sql`to_char(${transactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') LIKE ${like(filters.date)}`);
  return db.select().from(transactions).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(transactions.id)).limit(limit);
}
