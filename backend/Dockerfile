# Backend image: the FastAPI app on uvicorn, as uid 10001, with no pip and no compiler.
# CI, compose, kind and EKS all run this image. Both stages use the same python:3.14-alpine index
# digest: every dependency ships a musllinux wheel for amd64 and arm64, so nothing is compiled.
# A new HIGH/CRITICAL finding is handled with the remediation ladder in .trivyignore, starting with
# a digest bump (make digests shows drift).

FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72 AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /build
RUN python -m venv /opt/venv
# Only the dependency lists, so this layer stays cached until a pin changes.
COPY requirements-runtime.txt constraints.txt ./
# The runtime set only (no pytest or ruff), held to the exact versions CI tests. pip then leaves
# the venv: nothing installs packages at runtime.
RUN /opt/venv/bin/pip install -r requirements-runtime.txt -c constraints.txt \
 && /opt/venv/bin/pip uninstall -y pip

FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH
# The base image's own pip vendors urllib3, msgpack and setuptools, which the strict Trivy gate
# reports as HIGH; nothing here needs it.
RUN python -m pip uninstall -y --root-user-action=ignore pip \
 && addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
# Only what runs: the app and its migrations, root-owned and read-only to uid 10001. Nothing is
# written at runtime, so a read-only root filesystem works.
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

LABEL org.opencontainers.image.source=https://github.com/LakshyaBagani/Devops-StockPilot \
      org.opencontainers.image.title=stockpilot-backend \
      org.opencontainers.image.licenses=MIT
# Reported by /api/version. CI passes the commit SHA and build time; compose and Helm can override
# them at runtime. Declared after the copies, so a new SHA rebuilds no file layer.
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
ENV GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
# One worker per container: Kubernetes scales with replicas. No migrations here: compose runs
# app.prestart first, and Kubernetes runs them in a Helm hook Job.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
