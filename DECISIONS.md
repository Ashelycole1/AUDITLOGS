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

4. **Two-step sign-in.** A correct password only marks the session as pending, for 5 minutes. The session is signed in after a valid one-time PIN (decision 12). A password-only session is refused by every endpoint (tested). Five wrong codes end the pending sign-in.

5. ~~First sign-in enrols a TOTP authenticator.~~ Replaced by decision 12.

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

## 2026-10-16: Owner decisions after the first push

12. **MFA is a one-time PIN by email, not an authenticator app (owner).**
    - After the password step, the server emails a 6-digit PIN through the client's own SMTP server.
    - The PIN is valid for 5 minutes and works once. One resend is allowed per minute, three in all. Five wrong PINs end the attempt, and django-otp adds growing delays.
    - The email contains only the PIN.
    - This uses django-otp's built-in email plugin, so there's no new dependency.
    - **Trade-off:** the second factor is only as strong as the user's mailbox. Whoever controls a work email can complete a sign-in if they also have the password. ICT alone can change an account's email (logged as `user.email_change`) and can't change its own.
    - SMS would need a Ugandan SMS provider and owner approval.
    - Production refuses to start without SMTP configured.

13. **No password or secret is written in the repository (owner).**
    - The dev secret key, the dev database password, the demo-account password and the test password are now generated or read from `.env`.
    - CI uses a passwordless throwaway Postgres.
    - The earlier commits still contain dev-only dummy values: `demo-password`, `demo-password-2026`, `auditlogs-dev-only`, `ci-only`, `correct-horse-battery-2026` and a dev key string. None was ever a real credential.
    - Rewriting the published history is the owner's call.

14. **Commits carry the owner as the only author (owner).** No AI co-author or attribution lines.

## 2026-10-16: Query scoping and import

15. **`for_user` scoping is enforced by a test, not by convention.**
    - Models holding audit content are listed in `apps/core/scoping.py`. Views reach them only through `ScopedQuerysetMixin`.
    - `tests/test_scoping.py` fails if a view sets a plain `queryset` on such a model, or overrides `get_queryset` without calling `super()`.
    - IA requests for someone else's query get 404, not 403, so the response doesn't reveal that the query exists.
    - CEO is in scope for all queries but reaches only summary endpoints, which choose the fields (design.md 6).
    - ICT sees no queries until the break-glass grant exists.

16. **Import rules.**
    - Headers are matched through `IMPORT_HEADER_ALIASES` until the client's template is final.
    - Dates are read as YYYY-MM-DD or DD/MM/YYYY, and Excel date cells are read directly.
    - Risk ratings are matched without regard to case.
    - A deadline before the import date is a warning, not a block (design.md 13).
    - References are re-checked inside the confirm transaction, so two previews of the same file can't both create queries.
    - The limits are 10 MB and 5,000 rows.
    - PDF and Word are refused with a message for now. The lower-reliability fallback comes later.
    - **Open:** import source files are stored as plain files outside the web root. Encrypting them at rest, like evidence, comes with the evidence task. That needs `cryptography`, which architecture.md names.
