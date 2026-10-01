import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Readable IDs (PRD-000001, TXN-000001, USR-000001) are derived from the serial key so they never collide.
const readableId = (prefix: string) => sql.raw(`'${prefix}-' || lpad(id::text, 6, '0')`);

export const products = pgTable("products", {
  id: serial().primaryKey(),
  productId: text("product_id").generatedAlwaysAs(readableId("PRD")),
  barcode: text().notNull().unique(),
  name: text().notNull(),
  category: text().notNull(),
  description: text().notNull().default(""),
  quantity: integer().notNull().default(0),
  minimumQuantity: integer("minimum_quantity").notNull().default(5),
  location: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: serial().primaryKey(),
  transactionId: text("transaction_id").generatedAlwaysAs(readableId("TXN")),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  barcode: text().notNull(),
  action: text().notNull(),
  quantityChanged: integer("quantity_changed").notNull(),
  previousQuantity: integer("previous_quantity").notNull(),
  newQuantity: integer("new_quantity").notNull(),
  username: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial().primaryKey(),
  userId: text("user_id").generatedAlwaysAs(readableId("USR")),
  fullName: text("full_name").notNull(),
  username: text().notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text().notNull().default("Staff"),
  active: boolean().notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginHistory = pgTable("login_history", {
  id: serial().primaryKey(),
  username: text().notNull(),
  successful: boolean().notNull(),
  event: text().notNull(),
  ipAddress: text("ip_address").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Holds generated app secrets (e.g. the session signing key) when no environment variable provides one.
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
