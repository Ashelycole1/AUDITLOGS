# AuditLogs web image: the React build served by Nginx, which also terminates TLS and forwards /api.
# Build context is the repository root: docker build -f deploy/web/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The production build always talks to the API. VITE_DEPLOY_ENV=staging adds the dummy-data banner.
ARG VITE_DEPLOY_ENV=
ENV VITE_DATA_SOURCE=api \
    VITE_DEPLOY_ENV=${VITE_DEPLOY_ENV}
RUN npm run build


FROM nginx:1.27-alpine AS web
RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/web/check-certs.sh /docker-entrypoint.d/05-check-certs.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/05-check-certs.sh
EXPOSE 80 443
