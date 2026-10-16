# AuditLogs API image. Two targets:
#   dev  : runserver with live reload and the test tools (docker-compose.dev.yml)
#   prod : gunicorn as a non-root user (docker-compose.yml); also used by migrate and scheduler
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=UTC

WORKDIR /app
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin auditlogs \
    && mkdir -p /var/lib/auditlogs/evidence /var/lib/auditlogs/imports \
    && chown -R auditlogs /var/lib/auditlogs

COPY requirements.txt ./
RUN pip install -r requirements.txt


FROM base AS dev
COPY requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY . .
USER auditlogs
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]


FROM base AS prod
COPY --chown=root:root . .
ENV DJANGO_SETTINGS_MODULE=config.settings.prod \
    EVIDENCE_DIR=/var/lib/auditlogs/evidence \
    IMPORT_DIR=/var/lib/auditlogs/imports
USER auditlogs
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "docker/healthcheck.py"]
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--access-logfile", "-"]
