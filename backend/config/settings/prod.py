from .base import *  # noqa: F403
from .base import env, env_list

DEBUG = False
ENVIRONMENT = "prod"
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

# HTTPS only (architecture.md 8). Nginx terminates TLS and sets X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
# Container health checks call the app directly over HTTP inside the private network.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health$"]
# Nginx sets X-Real-IP from the connection on every request, so the audit log records the real client.
CLIENT_IP_HEADER = env("CLIENT_IP_HEADER", "")
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"

EMAIL_HOST = env("SMTP_HOST", "")
EMAIL_PORT = int(env("SMTP_PORT", "587") or 587)
EMAIL_HOST_USER = env("SMTP_USER", "")
EMAIL_HOST_PASSWORD = env("SMTP_PASSWORD", "")
EMAIL_USE_TLS = True
