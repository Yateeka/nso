import pytest

from inventory_app import create_app


@pytest.fixture()
def app(tmp_path):
    app = create_app({"TESTING": True, "WORKBOOK_PATH": str(tmp_path / "test.xlsx")})
    store = app.extensions["excel_store"]
    store.create_user("admin", "admin-password-123", "Admin")
    store.create_user("worker", "worker-password-123", "User")
    return app


@pytest.fixture()
def client(app):
    return app.test_client()


def csrf(client):
    with client.session_transaction() as session:
        return session["csrf_token"]


def login(client, username="admin", password="admin-password-123"):
    client.get("/login")
    return client.post("/login", data={"username": username, "password": password, "csrf_token": csrf(client)})

