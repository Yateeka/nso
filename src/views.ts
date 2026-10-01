import type { Flash } from "./session.js";
import type { Product, User } from "./store.js";
import type { loginHistory, transactions } from "../db/schema.js";

type LoginEvent = typeof loginHistory.$inferSelect;
type Transaction = typeof transactions.$inferSelect;

// ---- Tiny HTML templating with automatic escaping -----------------------------

export class SafeHtml {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]) {
  return new SafeHtml(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

const enc = encodeURIComponent;
const productUrl = (barcode: string) => `/products/${enc(barcode)}`;

export function formatTime(value: Date | string | null | undefined) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// ---- Layout -------------------------------------------------------------------

export interface PageContext {
  user: User | null;
  csrf: string;
  flashes: Flash[];
}

function layout(ctx: PageContext, title: string, content: SafeHtml) {
  const { user, csrf } = ctx;
  const csrfField = html`<input type="hidden" name="csrf_token" value="${csrf}">`;
  const nav = user ? html`
  <header class="topbar">
    <a class="brand" href="/"><span>GSU</span><span class="brand-title">Digital Inventory</span></a>
    <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">☰</button>
    <nav>
      <a href="/">Dashboard</a>
      <a href="/scan">Scan Item</a>
      <a href="/inventory">Inventory</a>
      <a href="/transactions">Transactions</a>
      ${user.role === "Admin" && html`<a href="/admin/users">Users</a><a href="/settings">Settings</a>`}
      <details class="user-menu"><summary><span class="user-chip">${user.name} · ${user.role}</span></summary><div class="user-menu-pop"><a href="/account">My Account</a><a href="/account/password">Change Password</a><form action="/logout" method="post">${csrfField}<button class="link-button" type="submit">Logout</button></form></div></details>
    </nav>
  </header>` : "";
  const assistant = user ? html`<button class="assistant-launch" type="button" aria-label="Open Inventory Assistant">✦</button><aside class="assistant-panel" hidden aria-label="Inventory Assistant"><div class="assistant-head"><strong>Inventory Assistant</strong><button type="button" class="assistant-close" aria-label="Close assistant">×</button></div><div class="assistant-messages" aria-live="polite"><p class="assistant-bubble">Hi ${user.name}! Ask me to find products, show low stock, or take you to a page.</p></div><form class="assistant-form"><input name="message" placeholder="Ask about your inventory…" autocomplete="off" required><button class="button primary" type="submit">Send</button></form></aside><script defer src="/static/chatbot.js"></script>` : "";
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${csrf}">
  <meta name="theme-color" content="#a8205e">
  <title>${title}</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="stylesheet" href="/static/theme.css">
  <script defer src="/static/app.js"></script>
</head>
<body>
  ${nav}
  <main class="container ${!user && "auth-container"}">
    <div class="flash-stack" aria-live="polite">
      ${ctx.flashes.map(([category, message]) => html`<div class="alert alert-${category}">${message}</div>`)}
    </div>
    ${content}
  </main>
  ${assistant}
</body>
</html>`.value;
}

const csrfInput = (ctx: PageContext) => html`<input type="hidden" name="csrf_token" value="${ctx.csrf}">`;

// ---- Pages --------------------------------------------------------------------

export function loginPage(ctx: PageContext, next: string) {
  return layout(ctx, "Sign in · Digital Inventory System", html`
<section class="auth-card">
  <div class="auth-mark" aria-hidden="true">▤</div>
  <p class="eyebrow">GEORGIA STATE UNIVERSITY</p>
  <h1>Digital Inventory System</h1>
  <p class="department">Student Orientation &amp; Family Engagement</p>
  <p class="muted">Sign in with your department account.</p>
  <form method="post" class="stack-form">
    ${csrfInput(ctx)}
    <input type="hidden" name="next" value="${next}">
    <label>Username<input name="username" autocomplete="username" required maxlength="40" autofocus></label>
    <label>Password<div class="password-field"><input id="login-password" type="password" name="password" autocomplete="current-password" required><button type="button" class="password-toggle" aria-label="Show password" aria-pressed="false">◉</button></div></label>
    <label class="remember-option"><input type="checkbox" name="remember" value="1"> Remember Me</label>
    <button class="button primary" type="submit">Sign In</button>
  </form>
  <p class="auth-help"><a href="/forgot-password">Forgot your password?</a></p>
  <p class="form-note">Accounts are created by an administrator.</p>
</section>`);
}

export function forgotPasswordPage(ctx: PageContext) {
  return layout(ctx, "Password Help · Digital Inventory", html`<section class="auth-card"><p class="eyebrow">ACCOUNT SUPPORT</p><h1>Password help</h1><p class="muted">For this internal system, an administrator must issue a temporary password. Send a reset request below, then contact your department administrator.</p><form method="post" class="stack-form">${csrfInput(ctx)}<label>Your username or name<input name="requester" maxlength="100" autocomplete="username" required></label><button class="button primary" type="submit">Request a reset</button></form><p class="auth-help"><a href="/login">Back to sign in</a></p></section>`);
}

function transactionRows(rows: Transaction[], empty: string, withBalanceBadge: boolean) {
  if (!rows.length) return html`<tr><td colspan="${withBalanceBadge ? 6 : 7}" class="empty">${empty}</td></tr>`;
  return rows.map((row) => withBalanceBadge
    ? html`<tr><td>${formatTime(row.createdAt)}</td><td>${row.username}</td><td>${row.productName || row.productId}</td><td><span class="badge badge-${row.action.toLowerCase()}">${row.action}</span></td><td>${row.quantityChanged}</td><td>${row.newQuantity}</td></tr>`
    : html`<tr><td>${formatTime(row.createdAt)}</td><td>${row.productName || row.productId}</td><td>${row.action}</td><td>${row.quantityChanged}</td><td>${row.previousQuantity}</td><td>${row.newQuantity}</td><td>${row.username}</td></tr>`);
}

export function dashboardPage(ctx: PageContext, products: Product[], recent: Transaction[]) {
  const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0);
  const lowCount = products.filter((p) => p.quantity <= p.minimum_quantity).length;
  const outCount = products.filter((p) => p.quantity === 0).length;
  const recentProducts = products.slice(-5).reverse();
  const isAdmin = ctx.user?.role === "Admin";
  return layout(ctx, "Dashboard · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">OVERVIEW</p><h1>Inventory dashboard</h1><p class="muted">A quick look at your current stock.</p></div><a class="button primary" href="/scan">Scan barcode</a></div>
<section class="stats-grid">
  <article class="stat"><span>Products</span><strong>${products.length}</strong></article>
  <article class="stat"><span>Total units</span><strong>${totalUnits}</strong></article>
  <article class="stat"><span>Low stock</span><strong>${lowCount}</strong></article><article class="stat"><span>Out of stock</span><strong>${outCount}</strong></article>
</section>
<section class="quick-actions"><a class="button primary" href="/scan">▦ Scan Item</a>${isAdmin ? html`<a class="button secondary" href="/products/new">＋ Register Product</a>` : html`<a class="button secondary" href="/scan">＋ Add Inventory</a>`}<a class="button secondary" href="/inventory">View Inventory</a><a class="button secondary" href="/transactions">Transaction History</a></section>
<section class="panel"><div class="panel-heading"><h2>Stock alerts</h2><a href="/inventory">Review inventory →</a></div>${lowCount ? html`<div class="alert alert-info">${lowCount} product(s) are at or below their minimum quantity, including ${outCount} out of stock.</div>` : html`<p class="muted">All products are above their minimum quantity.</p>`}</section>
<section class="panel">
  <div class="panel-heading"><h2>Recent activity</h2><a href="/inventory">View inventory →</a></div>
  <div class="table-wrap"><table><thead><tr><th>Date</th><th>User</th><th>Product</th><th>Action</th><th>Amount</th><th>Balance</th></tr></thead><tbody>
  ${transactionRows(recent, "No transactions yet.", true)}
  </tbody></table></div>
</section>
<section class="panel"><div class="panel-heading"><h2>Recently added</h2><a href="/inventory">Browse all products →</a></div><div class="recent-product-grid">${recentProducts.length ? recentProducts.map((p) => html`<a class="recent-product" href="${productUrl(p.barcode)}"><span>${p.category}</span><strong>${p.name}</strong><small>${p.product_id} · ${p.quantity} in stock</small></a>`) : html`<p class="muted">New products will appear here.</p>`}</div></section>`);
}

export function scanPage(ctx: PageContext) {
  return layout(ctx, "Scan Item · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">BARCODE LOOKUP</p><h1>Scan or enter a barcode</h1><p class="muted">USB scanners can type directly into the field below.</p></div></div>
<div class="scan-layout">
  <section class="panel scan-panel" data-can-register="${ctx.user?.role === "Admin" ? "true" : "false"}">
    <form id="barcode-form" class="scan-form">
      <label for="barcode-input">Barcode</label>
      <div class="input-action"><input id="barcode-input" autocomplete="off" inputmode="numeric" maxlength="128" placeholder="Scan or type barcode" required autofocus><button class="button primary" type="submit">Look up</button></div>
      <p class="form-note">Most USB scanners send Enter automatically.</p>
    </form>
    <div id="scan-message" class="inline-message" aria-live="polite"></div>
    <div id="product-result"></div>
  </section>
  <section class="panel camera-panel">
    <div class="panel-heading"><h2>Camera scanner</h2><span class="badge">HTTPS required</span></div>
    <div class="camera-frame"><video id="camera-preview" playsinline muted></video><div class="camera-guide"></div></div>
    <div class="button-row"><button id="start-camera" class="button secondary" type="button">Start camera</button><button id="stop-camera" class="button ghost" type="button" disabled>Stop</button></div>
    <p id="camera-status" class="form-note">Uses your browser’s built-in barcode detector when available.</p>
  </section>
</div>`);
}

export function newProductPage(ctx: PageContext, form: Record<string, string>) {
  const v = (key: string, fallback = "") => form[key] ?? fallback;
  return layout(ctx, "New product · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">NEW RECORD</p><h1>Add a product</h1><p class="muted">A product ID will be assigned automatically.</p></div></div>
<section class="panel form-panel"><form method="post" class="form-grid">
  ${csrfInput(ctx)}
  <label>Product name<input name="name" required maxlength="120" value="${v("name")}"></label>
  <label>Barcode<input name="barcode" required maxlength="128" value="${v("barcode")}"></label>
  <label>Category<input name="category" required maxlength="80" value="${v("category")}"></label>
  <label>Starting quantity<input type="number" name="quantity" required min="0" step="1" value="${v("quantity", "0")}"></label>
  <label>Minimum quantity<input type="number" name="minimum_quantity" required min="0" step="1" value="${v("minimum_quantity", "5")}"></label>
  <label class="full">Description<textarea name="description" maxlength="500" rows="3">${v("description")}</textarea></label>
  <label class="full">Location<input name="location" required maxlength="80" value="${v("location")}"></label>
  <div class="full button-row"><button class="button primary" type="submit">Create product</button><a class="button ghost" href="/scan">Cancel</a></div>
</form></section>`);
}

export function productDetailPage(ctx: PageContext, p: Product) {
  return layout(ctx, `${p.name} · Digital Inventory`, html`
<div class="page-heading"><div><p class="eyebrow">${p.product_id}</p><h1>${p.name}</h1><p class="muted">Barcode ${p.barcode}</p></div><div class="button-row"><a class="button secondary" href="/scan">Scan another</a>${ctx.user?.role === "Admin" && html`<a class="button secondary" href="${productUrl(p.barcode)}/edit">Edit product</a>`}</div></div>
<div class="detail-grid">
  <section class="panel product-card">
    <dl><div><dt>Category</dt><dd>${p.category}</dd></div><div><dt>Description</dt><dd>${p.description || "—"}</dd></div><div><dt>Minimum quantity</dt><dd>${p.minimum_quantity}</dd></div><div><dt>Location</dt><dd>${p.location}</dd></div><div><dt>Last updated</dt><dd>${formatTime(p.updated_at)}</dd></div></dl>
  </section>
  <section class="panel quantity-card" data-barcode="${p.barcode}"><span>Current quantity</span><strong id="quantity-value">${p.quantity}</strong>
    <form id="quantity-form"><div class="segmented"><label><input type="radio" name="action" value="ADD" checked><span>Add</span></label><label><input type="radio" name="action" value="REMOVE"><span>Remove</span></label></div><label>Amount<input id="quantity-amount" type="number" min="1" step="1" value="1" required></label><button class="button primary" type="submit">Update quantity</button></form>
    <div id="quantity-message" class="inline-message" aria-live="polite"></div><dialog id="quantity-confirm" class="confirm-dialog"><h2>Confirm inventory change</h2><p id="quantity-confirm-copy"></p><div class="button-row"><button type="button" id="quantity-cancel" class="button ghost">Cancel</button><button type="button" id="quantity-confirm-button" class="button primary">Confirm</button></div></dialog>
  </section>
</div>`);
}

export function editProductPage(ctx: PageContext, p: Product) {
  return layout(ctx, "Edit Product · Digital Inventory", html`<div class="page-heading"><div><p class="eyebrow">${p.product_id}</p><h1>Edit product</h1></div></div><section class="panel form-panel"><form method="post" class="form-grid">${csrfInput(ctx)}<label>Name<input name="name" value="${p.name}" required maxlength="120"></label><label>Category<input name="category" value="${p.category}" required maxlength="80"></label><label>Minimum quantity<input name="minimum_quantity" type="number" min="0" value="${p.minimum_quantity}" required></label><label>Location<input name="location" value="${p.location}" required maxlength="80"></label><label class="full">Description<textarea name="description" maxlength="500" rows="3">${p.description}</textarea></label><div class="full button-row"><button class="button primary">Save changes</button><a class="button ghost" href="${productUrl(p.barcode)}">Cancel</a></div></form></section>`);
}

export function inventoryPage(ctx: PageContext, products: Product[]) {
  const categories = [...new Set(products.map((p) => p.category))].sort();
  const stock = (p: Product) => (p.quantity === 0 ? "out" : p.quantity <= p.minimum_quantity ? "low" : "available");
  return layout(ctx, "Inventory · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">ALL PRODUCTS</p><h1>Inventory</h1><p class="muted">${products.length} product records</p></div><a class="button primary" href="/products/new">Add product</a></div>
<section class="panel"><div class="table-tools inventory-filters"><input id="inventory-search" type="search" placeholder="Search name, ID, barcode, category…" aria-label="Search inventory"><select id="category-filter" aria-label="Filter by category"><option value="">All categories</option>${categories.map((c) => html`<option>${c}</option>`)}</select><select id="stock-filter" aria-label="Filter by stock status"><option value="">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="available">Available</option></select></div><div class="table-wrap"><table id="inventory-table"><thead><tr><th>ID</th><th>Product</th><th>Barcode</th><th>Category</th><th>Quantity</th><th>Minimum</th><th>Location</th></tr></thead><tbody>
${products.length ? products.map((p) => html`<tr data-category="${p.category.toLowerCase()}" data-stock="${stock(p)}"><td><a href="${productUrl(p.barcode)}">${p.product_id}</a></td><td><a href="${productUrl(p.barcode)}">${p.name}</a></td><td><code>${p.barcode}</code></td><td>${p.category}</td><td><strong>${p.quantity}</strong> ${stock(p) === "out" ? html`<span class="stock-pill out">Out of stock</span>` : stock(p) === "low" ? html`<span class="stock-pill low">Low stock</span>` : ""}</td><td>${p.minimum_quantity}</td><td>${p.location}</td></tr>`) : html`<tr><td colspan="7" class="empty">No products have been added.</td></tr>`}
</tbody></table></div></section>`);
}

export function usersPage(ctx: PageContext, users: User[], activity: LoginEvent[]) {
  return layout(ctx, "Users · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">ADMINISTRATION</p><h1>User management</h1><p class="muted">Create accounts and control access.</p></div></div>
<div class="admin-layout">
<section class="panel form-panel"><h2>Add user</h2><p class="muted">New users must change their temporary password after their first login.</p><form method="post" class="stack-form">${csrfInput(ctx)}<label>Full name<input name="name" required maxlength="100"></label><label>Username<input name="username" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.\\-]+"></label><label>Temporary password<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><label>Role<select name="role"><option>Staff</option><option>Admin</option></select></label><button class="button primary" type="submit">Create account</button></form></section>
<section class="panel"><h2>Registered users</h2><div class="user-list">${users.map((u) => html`<form class="user-row" method="post" action="/admin/users/${enc(u.username)}/update">${csrfInput(ctx)}<div><strong>${u.name}</strong><small>${u.username} · Created ${formatTime(u.created_at)}</small></div><select name="role" aria-label="Role for ${u.username}"><option ${u.role === "Staff" && "selected"}>Staff</option><option ${u.role === "Admin" && "selected"}>Admin</option></select><select name="enabled" aria-label="Status for ${u.username}"><option value="true" ${u.enabled && "selected"}>Enabled</option><option value="false" ${!u.enabled && "selected"}>Disabled</option></select><input type="password" name="password" minlength="10" placeholder="Issue temporary password" aria-label="Reset password for ${u.username}"><button class="button secondary" type="submit">Save</button></form>`)}</div></section>
</div>
<section class="panel"><h2>Recent login activity</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Event</th><th>Result</th></tr></thead><tbody>${activity.length ? activity.map((r) => html`<tr><td>${formatTime(r.createdAt)}</td><td>${r.username}</td><td>${r.event}</td><td>${r.successful ? "Successful" : "Failed"}</td></tr>`) : html`<tr><td colspan="4" class="empty">No sign-in activity yet.</td></tr>`}</tbody></table></div></section>`);
}

export function changePasswordPage(ctx: PageContext) {
  return layout(ctx, "Change Password · Digital Inventory", html`
<div class="page-heading"><div><p class="eyebrow">MY ACCOUNT</p><h1>Change password</h1><p class="muted">Choose a password with at least 10 characters.</p></div></div>
<section class="panel form-panel"><form method="post" class="stack-form">${csrfInput(ctx)}<label>Current password<input type="password" name="current_password" required autocomplete="current-password"></label><label>New password<input type="password" name="new_password" required minlength="10" autocomplete="new-password"></label><label>Confirm new password<input type="password" name="confirm_password" required minlength="10" autocomplete="new-password"></label><button class="button primary" type="submit">Save password</button></form></section>`);
}

export function accountPage(ctx: PageContext, user: User) {
  return layout(ctx, "My Account · Digital Inventory", html`<div class="page-heading"><div><p class="eyebrow">MY ACCOUNT</p><h1>Account details</h1></div></div><section class="panel account-card"><dl><div><dt>Full name</dt><dd>${user.name}</dd></div><div><dt>Username</dt><dd>${user.username}</dd></div><div><dt>Role</dt><dd>${user.role}</dd></div><div><dt>Last sign in</dt><dd>${formatTime(user.last_login) || "Not available"}</dd></div></dl><a class="button primary" href="/account/password">Change password</a></section>`);
}

export function transactionsPage(ctx: PageContext, rows: Transaction[], filters: Record<string, string>) {
  return layout(ctx, "Transactions · Digital Inventory", html`<div class="page-heading"><div><p class="eyebrow">AUDIT TRAIL</p><h1>Transaction history</h1><p class="muted">Every stock change is recorded with its previous and new balance.</p></div></div><section class="panel"><form class="filter-form" method="get"><input name="product" value="${filters.product}" placeholder="Product or ID"><input name="user" value="${filters.user}" placeholder="User"><select name="action"><option value="">All actions</option>${["CREATE", "ADD", "REMOVE", "EDIT"].map((a) => html`<option ${filters.action === a && "selected"}>${a}</option>`)}</select><input type="date" name="date" value="${filters.date}"><button class="button primary">Filter</button></form><div class="table-wrap"><table><thead><tr><th>Date/Time</th><th>Product</th><th>Action</th><th>Changed</th><th>Previous</th><th>New</th><th>User</th></tr></thead><tbody>${transactionRows(rows, "No matching transactions.", false)}</tbody></table></div></section>`);
}

export function settingsPage(ctx: PageContext, activity: LoginEvent[]) {
  return layout(ctx, "Settings · Digital Inventory", html`<div class="page-heading"><div><p class="eyebrow">ADMINISTRATION</p><h1>Settings &amp; activity</h1><p class="muted">Review recent sign-in and sign-out events.</p></div></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Event</th><th>Result</th><th>IP</th></tr></thead><tbody>${activity.length ? activity.map((r) => html`<tr><td>${formatTime(r.createdAt)}</td><td>${r.username}</td><td>${r.event}</td><td>${r.successful ? "Successful" : "Failed"}</td><td>${r.ipAddress}</td></tr>`) : html`<tr><td colspan="5" class="empty">No login activity recorded.</td></tr>`}</tbody></table></div></section>`);
}

export function errorPage(ctx: PageContext, title: string, message: string) {
  return layout(ctx, `${title} · Digital Inventory`, html`<section class="panel"><h1>${title}</h1><p class="muted">${message}</p><a class="button primary" href="/">Back to dashboard</a></section>`);
}
