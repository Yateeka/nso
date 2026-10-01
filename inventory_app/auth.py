from functools import wraps

from flask import current_app, flash, jsonify, redirect, request, session, url_for


def current_user():
    username = session.get("username")
    if not username:
        return None
    return current_app.extensions["excel_store"].get_user(username)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user or not user["enabled"]:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify(error="Authentication required."), 401
            flash("Please log in to continue.", "error")
            return redirect(url_for("main.login", next=request.full_path))
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if current_user()["role"] != "Admin":
            if request.path.startswith("/api/"):
                return jsonify(error="Administrator access required."), 403
            flash("Administrator access required.", "error")
            return redirect(url_for("main.dashboard"))
        return view(*args, **kwargs)
    return wrapped
