from .base import *  # noqa: F403
from .base import REST_FRAMEWORK, database_from_url, env

ENVIRONMENT = "test"
# Postgres in CI when DATABASE_URL is set; otherwise an in-memory SQLite database.
DATABASES = {"default": database_from_url(env("DATABASE_URL"))}
if DATABASES["default"]["ENGINE"].endswith("sqlite3"):
    DATABASES["default"]["NAME"] = ":memory:"

REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {"login": "1000/min", "export": "1000/min"}}
