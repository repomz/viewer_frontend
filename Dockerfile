# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-alpine AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

FROM dependencies AS build
ENV NODE_ENV=production
COPY . .
RUN pnpm run typecheck && pnpm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG VERSION=0.2.0
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="viewer-frontend" \
      org.opencontainers.image.description="Responsive clinical frontend for Viewer Backend and Hospital Agent" \
      org.opencontainers.image.source="https://github.com/repomz/viewer_frontend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf.template /etc/nginx/frontend.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R 101:101 /usr/share/nginx/html /etc/nginx/frontend.conf.template
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD if [ -r /etc/viewer-tls/fullchain.pem ]; then wget -q --no-check-certificate -O /dev/null https://127.0.0.1:8443/healthz; else wget -q -O /dev/null http://127.0.0.1:8080/healthz; fi || exit 1
CMD ["/bin/sh", "-c", "TLS_LISTEN=''; HTTP_REDIRECT=''; if [ -r /etc/viewer-tls/fullchain.pem ] && [ -r /etc/viewer-tls/privkey.pem ]; then TLS_LISTEN='listen 8443 ssl; http2 on; ssl_certificate /etc/viewer-tls/fullchain.pem; ssl_certificate_key /etc/viewer-tls/privkey.pem; ssl_protocols TLSv1.2 TLSv1.3; ssl_session_cache shared:viewer_tls:10m; ssl_session_timeout 1d;'; HTTP_REDIRECT='if ($scheme = http) { return 308 https://$host$request_uri; }'; fi; export TLS_LISTEN HTTP_REDIRECT; envsubst '$BACKEND_URL $PACS_URL $PACS_AUTHORIZATION $TLS_LISTEN $HTTP_REDIRECT' < /etc/nginx/frontend.conf.template > /tmp/default.conf && exec nginx -c /tmp/default.conf -g 'daemon off;'"]
