import click
from flask import current_app

from .excel_store import StoreError


def register_commands(app):
    @app.cli.command("create-admin")
    @click.option("--username", prompt=True)
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    def create_admin(username, password):
        """Create the first administrator account."""
        try:
            current_app.extensions["excel_store"].create_user(username, password, "Admin")
        except StoreError as exc:
            raise click.ClickException(str(exc))
        click.echo(f"Administrator '{username.lower()}' created.")

