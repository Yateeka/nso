import os
from datetime import timedelta
from pathlib import Path

from flask import Flask

from .excel_store import ExcelStore
from .routes import bp


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY"),
        WORKBOOK_PATH=os.getenv(
            "WORKBOOK_PATH", str(Path(app.instance_path) / "inventory.xlsx")
        ),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "0") == "1",
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if not app.config.get("SECRET_KEY"):
        if app.config.get("TESTING"):
            app.config["SECRET_KEY"] = "test-only-secret"
        else:
            raise RuntimeError("SECRET_KEY must be set to a long, random value.")

    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    app.extensions["excel_store"] = ExcelStore(app.config["WORKBOOK_PATH"])
    app.register_blueprint(bp)

    from .cli import register_commands

    register_commands(app)
    return app

