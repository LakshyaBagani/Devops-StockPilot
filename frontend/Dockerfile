# Frontend image: the Vite build served by nginx as uid 101 on port 8080. Compose and Kubernetes run
# the same image; API_UPSTREAM picks the backend when the container starts.
# A new HIGH/CRITICAL finding is handled with the remediation ladder in .trivyignore, starting with
# a digest bump (make digests shows drift).

# The build runs on the builder's own platform, even for an amd64 image built on an arm64 Mac: its
# output is plain static files, so there is nothing to emulate.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
# After npm ci, so a new commit SHA does not invalidate the dependency layer. Vite bakes it into the
# bundle for the footer.
ARG VITE_GIT_SHA=dev
RUN npm run build

FROM nginx:1.27-alpine
# The base entrypoint fills NGINX_LOCAL_RESOLVERS from /etc/resolv.conf, then renders the template
# into conf.d with envsubst. backend:8000 suits compose; Kubernetes sets the backend's FQDN.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 API_UPSTREAM=backend:8000
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
LABEL org.opencontainers.image.source=https://github.com/LakshyaBagani/Devops-StockPilot \
      org.opencontainers.image.title=stockpilot-frontend \
      org.opencontainers.image.licenses=MIT
# Numeric and explicit, although the base image already runs as 101 (nginx).
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
