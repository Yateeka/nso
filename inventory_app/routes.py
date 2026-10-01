import secrets
from urllib.parse import urljoin, urlparse
from flask import Blueprint, current_app, flash, jsonify, redirect, render_template, request, session, url_for
from .auth import admin_required, current_user, login_required
from .excel_store import ConflictError, NotFoundError, StoreError, ValidationError

bp = Blueprint("main", __name__)
def store(): return current_app.extensions["excel_store"]
def safe_next(target):
    if not target: return False
    ref=urlparse(request.host_url); test=urlparse(urljoin(request.host_url,target))
    return test.scheme in {"http","https"} and ref.netloc==test.netloc
def csrf_token():
    if "csrf_token" not in session: session["csrf_token"]=secrets.token_urlsafe(32)
    return session["csrf_token"]
@bp.app_context_processor
def inject_globals(): return {"current_user":current_user(),"csrf_token":csrf_token}
@bp.before_app_request
def check_csrf():
    if request.method in {"POST","PUT","PATCH","DELETE"}:
        supplied=request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
        if not supplied or not secrets.compare_digest(supplied,session.get("csrf_token","")):
            if request.path.startswith("/api/"): return jsonify(error="Invalid or missing security token."),400
            flash("Your form expired. Please try again.","error"); return redirect(request.referrer or url_for("main.login"))
    user=current_user()
    if user and user.get("must_change_password") and request.endpoint not in {"main.change_password","main.logout","static"}:
        flash("Change your temporary password to continue.","info")
        return redirect(url_for("main.change_password"))
@bp.route("/login",methods=["GET","POST"])
def login():
    if current_user(): return redirect(url_for("main.dashboard"))
    if request.method=="POST":
        user=store().authenticate(request.form.get("username"),request.form.get("password"),request.remote_addr)
        if user:
            session.clear(); session.permanent=request.form.get("remember")=="1"; session["username"]=user["username"]; session["csrf_token"]=secrets.token_urlsafe(32)
            if user.get("must_change_password"): return redirect(url_for("main.change_password"))
            target=request.form.get("next"); flash(f"Welcome, {user['name']}.","success")
            return redirect(target if safe_next(target) else url_for("main.dashboard"))
        flash("Incorrect username or password.","error")
    return render_template("login.html",next=request.args.get("next",""))
@bp.route("/forgot-password",methods=["GET","POST"])
def forgot_password():
    if request.method=="POST":
        store().record_reset_request(request.form.get("requester"),request.remote_addr)
        flash("Your reset request has been noted. Please contact a system administrator to issue a temporary password.","info")
    return render_template("forgot_password.html")
@bp.post("/logout")
@login_required
def logout():
    store().record_logout(session.get("username"),request.remote_addr); session.clear(); response=redirect(url_for("main.login")); response.headers["Cache-Control"]="no-store, no-cache, must-revalidate, max-age=0"; response.headers["Pragma"]="no-cache"; flash("You have been logged out.","success"); return response
@bp.get("/")
@login_required
def dashboard():
    products=store().list_products(); low=[p for p in products if p["quantity"]<=p["minimum_quantity"]]
    return render_template("dashboard.html",products=products,transactions=store().list_transactions(8),total_units=sum(p["quantity"] for p in products),low_count=len(low),out_count=sum(p["quantity"]==0 for p in products),recent_products=products[-5:][::-1])
@bp.get("/scan")
@login_required
def scan(): return render_template("scan.html")
@bp.route("/products/new",methods=["GET","POST"])
@admin_required
def new_product():
    barcode=request.args.get("barcode","")
    if request.method=="POST":
        try:
            product=store().create_product(request.form,session["username"]); flash(f"{product['name']} was created successfully.","success"); return redirect(url_for("main.product_detail",barcode=product["barcode"]))
        except StoreError as exc: flash(str(exc),"error"); barcode=request.form.get("barcode","")
    return render_template("new_product.html",barcode=barcode)
@bp.get("/products/<path:barcode>")
@login_required
def product_detail(barcode):
    product=store().find_product(barcode)
    if not product: flash("Product not registered. Add it as a new product.","info"); return redirect(url_for("main.new_product",barcode=barcode))
    return render_template("product_detail.html",product=product)
@bp.route("/products/<path:barcode>/edit",methods=["GET","POST"])
@admin_required
def edit_product(barcode):
    product=store().find_product(barcode)
    if not product: raise NotFoundError("Product not found.")
    if request.method=="POST":
        try: store().update_product(barcode,request.form,session["username"]); flash("Product details saved.","success"); return redirect(url_for("main.product_detail",barcode=barcode))
        except StoreError as exc: flash(str(exc),"error")
    return render_template("edit_product.html",product=product)
@bp.get("/inventory")
@login_required
def inventory():
    products=store().list_products(); return render_template("inventory.html",products=products,categories=sorted({p["category"] for p in products}))
@bp.route("/admin/users",methods=["GET","POST"])
@admin_required
def users():
    if request.method=="POST":
        try:
            store().create_user(request.form.get("username"),request.form.get("password"),request.form.get("role"),request.form.get("name"),temporary=True); flash("User account created. Share the temporary password securely.","success"); return redirect(url_for("main.users"))
        except StoreError as exc: flash(str(exc),"error")
    return render_template("users.html",users=store().list_users(),activity=store().list_login_activity(30))
@bp.post("/admin/users/<username>/update")
@admin_required
def update_user(username):
    try:
        enabled=request.form.get("enabled")=="true"
        if username.lower()==session["username"].lower() and not enabled: raise ValidationError("You cannot disable your own account.")
        store().update_user(username,role=request.form.get("role"),enabled=enabled,password=request.form.get("password") or None); flash(f"Account {username} updated.","success")
    except StoreError as exc: flash(str(exc),"error")
    return redirect(url_for("main.users"))
@bp.route("/account/password",methods=["GET","POST"])
@login_required
def change_password():
    if request.method=="POST":
        if request.form.get("new_password")!=request.form.get("confirm_password"): flash("New passwords do not match.","error")
        else:
            try: store().change_password(session["username"],request.form.get("current_password"),request.form.get("new_password")); flash("Password changed successfully.","success"); return redirect(url_for("main.dashboard"))
            except StoreError as exc: flash(str(exc),"error")
    return render_template("change_password.html")
@bp.get("/account")
@login_required
def account(): return render_template("account.html",user=current_user())
@bp.get("/transactions")
@login_required
def transactions():
    filters={k:request.args.get(k,"") for k in ("product","user","action","date")}; return render_template("transactions.html",transactions=store().list_transactions(500,filters),filters=filters)
@bp.get("/settings")
@admin_required
def settings(): return render_template("settings.html",activity=store().list_login_activity(50))
@bp.get("/api/products/<path:barcode>")
@login_required
def api_product(barcode):
    try: product=store().find_product(barcode)
    except ValidationError as exc: return jsonify(error=str(exc)),400
    if not product: return jsonify(found=False,barcode=barcode),404
    return jsonify(found=True,product=product)
@bp.get("/api/search")
@login_required
def api_search():
    query=request.args.get("q","")
    products=store().find_product_query(query) if query else store().list_products()
    return jsonify(products=products[:100])
@bp.post("/api/products")
@admin_required
def api_create_product():
    try: return jsonify(product=store().create_product(request.get_json(silent=True) or {},session["username"])),201
    except ConflictError as exc: return jsonify(error=str(exc)),409
    except ValidationError as exc: return jsonify(error=str(exc)),400
@bp.post("/api/products/<path:barcode>/quantity")
@login_required
def api_quantity(barcode):
    data=request.get_json(silent=True) or {}
    try: return jsonify(product=store().update_quantity(barcode,data.get("action"),data.get("amount"),session["username"]),message="Quantity updated successfully.")
    except NotFoundError as exc: return jsonify(error=str(exc)),404
    except ValidationError as exc: return jsonify(error=str(exc)),400

@bp.after_app_request
def prevent_authenticated_page_cache(response):
    if current_user() or request.endpoint == "main.logout":
        response.headers["Cache-Control"]="no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"]="no-cache"
    return response
