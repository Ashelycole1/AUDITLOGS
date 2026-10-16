# DECISIONS.md

Date, decision, reason. Newest last.

## 2026-10-16: Backend foundation

1. **Django 5.2 LTS, DRF 3.16, Python 3.12.** Django 5.2 is the long-term support release (security fixes into 2028). Python 3.12 matches system.md 7. Versions are pinned in `backend/requirements*.txt`.

2. **Dependencies added beyond the names in system.md 5.** All are needed for the locked stack to work, and none calls an outside service:
   - `psycopg[binary]`, the PostgreSQL driver.
   - `argon2-cffi`, the Argon2 implementation Django uses.
   - `pytest-django`, which runs pytest against Django.
   - `ruff` and `black`, already named in system.md 7.

   The owner should confirm these in writing, per system.md 5.

3. **Session cookies, not tokens.** The SPA uses Django sessions with CSRF protection. Login and MFA endpoints check CSRF explicitly. Sessions give the 30-minute idle timeout and server-side logout for free, and keep tokens out of browser storage.

4. **Two-step sign-in.** A correct password only marks the session as pending, for 5 minutes. The session is signed in after a valid TOTP code. A password-only session is refused by every endpoint (tested). Five wrong codes end the pending sign-in.

5. **First sign-in enrols MFA.** A user with no confirmed authenticator gets a TOTP secret after the password step. The device counts only once a code from it is accepted.
   - **Known risk:** someone who learns a new user's password before that user's first sign-in could enrol their own authenticator.
   - **Planned fix, with the email task:** ICT-issued one-time enrolment links.
   - The API returns the `otpauth://` URI and secret. Drawing a QR code needs either a new frontend dependency or a small in-house encoder. Owner to choose.

6. **Lockout is per account, not per IP.** Axes locks after 5 failures for 15 minutes, counting email case variants together. IP lockout stays off while Nginx is the only client, because every request would share one IP. DRF rate limits cover bursts.

7. **No superuser and no Django admin.** Every power comes from a role. The `User` model has no `is_staff` or `is_superuser`. The admin site is not mounted.

8. **Default deny.** Every API view must declare `allowed_roles`. A view without it refuses everyone. `tests/test_permission_matrix.py` fails if a route is missing from the matrix.

9. **Audit log.**
   - Entries are written under a PostgreSQL advisory lock.
   - Each entry is hashed as `SHA-256(prev_hash || canonical JSON)`.
   - Canonical JSON means sorted keys, compact separators and UTF-8, with the timestamp as ISO UTC including microseconds.
   - Triggers refuse UPDATE, DELETE and TRUNCATE in PostgreSQL, and UPDATE and DELETE in SQLite.
   - The model and queryset also refuse changes.
   - Role grants are in `deploy/db_grants.sql`.

10. **SQLite for local runs without Docker.** If `DATABASE_URL` is unset, dev uses `backend/dev.sqlite3` and tests use in-memory SQLite. CI runs the same tests against PostgreSQL 16. Production refuses to start on anything but PostgreSQL.

11. **Client IP in the log is REMOTE_ADDR for now.** The real client address will be taken from a header only Nginx can set. That will be decided in the deployment task.
