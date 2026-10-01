# GSU Digital Inventory System

A responsive Flask inventory application for Georgia State University Student Orientation & Family Engagement. It uses an Excel workbook for inventory and account data, supports USB and camera barcode scanning, and requires administrator-created accounts.

## Requirements

- Python 3.10 or newer
- A local writable folder for the workbook
- A stable random `SECRET_KEY`

## Install and run locally

From the project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
flask --app run.py create-admin
flask --app run.py run
```

The `create-admin` command prompts for the first administrator username and password. No default credentials are stored in the source code. The workbook is initialized automatically at `instance/inventory.xlsx`. Open `http://127.0.0.1:5000` and sign in.

To use a different workbook location, set `WORKBOOK_PATH=/absolute/path/inventory.xlsx` before starting Flask. Keep the workbook on local storage and back it up regularly.

## Accounts and roles

Administrators create accounts under **Users**. Each new account has a temporary password and must change it at first sign in. Administrators can assign Admin or Staff roles, disable/reactivate accounts, and issue a new temporary password. Staff can view and search inventory, scan items, adjust stock, and view transactions. Only administrators can register or edit products, manage accounts, or view Settings.

Passwords are stored as Werkzeug hashes. Sessions use HTTP-only, same-site cookies, expire after eight hours when Remember Me is selected, and include CSRF protection. Five consecutive failed sign-in attempts lock that account for 15 minutes. Login attempts, resets, and available logout events are kept in the `Login History` sheet. Inventory changes are retained in `Transactions` with old and new quantities.

## Scanning

- **USB scanner:** Open **Scan Item**, focus the barcode field, then scan. Most scanners send Enter automatically.
- **Camera:** Start the camera scanner and allow camera access. Browser camera access generally requires HTTPS except on localhost. Barcode Detection API support varies by browser; manual entry remains available.

## Security and deployment

For deployment, set a persistent randomly generated `SECRET_KEY`, run behind a production WSGI server over HTTPS, and set `SESSION_COOKIE_SECURE=1`. Do not expose the development server directly to the internet. This workbook design is intended for a small department and light concurrent use; make regular backups and consider a transactional database if usage grows substantially.
