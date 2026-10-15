# ADR-0001: Application stack

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** [ADR-0005](0005-derived-stock-ledger.md) (data model), [ADR-0007](0007-reorder-planner-policy.md) (planner)

## Context

The capstone rubric fixes the shape of the system: a FastAPI backend with `/health`, PostgreSQL
managed by Alembic, a React or HTML frontend, Docker images that run as non-root, a GitHub Actions
pipeline with a Trivy gate, Terraform for AWS, Helm on Kubernetes, and Prometheus with Grafana.
Within that shape the project needed:

- a small, original product that can be built quickly, so most of the time goes to the DevOps layer;
- a toolchain that is current in October 2026 and passes a **strict** Trivy gate (any HIGH or
  CRITICAL finding fails, unfixed ones included);
- one set of images that runs unchanged on Docker Compose, kind and EKS;
- reproducible builds: the same commit always produces the same dependency set.

## Decision

| Layer | Choice |
|---|---|
| API | Python 3.14, FastAPI 0.143.1 on Starlette 1.8.0, uvicorn 0.54.0 (one worker per container), Pydantic 2.14 + pydantic-settings |
| Data | PostgreSQL 18 (`postgres:18-alpine`), SQLAlchemy 2.1 + psycopg 3, Alembic 1.20 with a fixed naming convention so `alembic check` stays clean |
| Metrics | prometheus-fastapi-instrumentator 8.1.0 for the `http_*` series, prometheus-client for the `stockpilot_*` business series |
| Tests and quality | pytest 9 + httpx2 (in `requirements.txt`, so `pip install -r requirements.txt && pytest` works for anyone), pytest-cov and ruff (in `requirements-dev.txt`) |
| UI | React 19 + Vite 8 on Node 24, plain CSS, no UI or chart library; bars and risk meters are CSS |
| Backend image | `python:3.14-alpine` for both build and runtime stages, a virtualenv with the runtime dependencies only, pip removed, uid 10001 |
| Frontend image | `node:24-alpine` build stage, `nginxinc/nginx-unprivileged:1.30-alpine-slim` runtime, uid 101, port 8080 |

Everything is pinned: exact versions in `backend/requirements*.txt`, the full transitive set in
`backend/constraints.txt`, `frontend/package-lock.json` installed with `npm ci`, and every base
image by digest (`make digests` reports drift).

## Alternatives considered

- **`python:3.14-slim` (Debian) as the backend base.** Rejected: a strict scan on 2026-10-15 found
  44 HIGH findings in its Debian packages, none with a fix available, so the gate could never pass.
  The Alpine base had no HIGH/CRITICAL OS findings; its only four were in pip's vendored
  libraries, which disappear with pip.
- **`nginx:*-alpine` (the stock image) as the frontend base.** Rejected: it runs as root and listens
  on port 80, and older tags carry dozens of OpenSSL, libxml2 and libpng findings (see the README's
  "Security scan explained"). The unprivileged slim variant ships 21 packages, against 70 in
  `nginx-unprivileged:1.30-alpine`, with the same entrypoint chain.
- **Older FastAPI or instrumentator lines.** Rejected: instrumentator 7 breaks routed requests on
  FastAPI 0.137 and later, and the pre-1.0 Starlette line it pulls in carries HIGH CVEs.
- **A UI component or chart library.** Not needed for five screens; plain CSS keeps the bundle small
  and the dependency surface tiny.

## Consequences

- Both images pass the strict gate: 0 HIGH/CRITICAL with Trivy 0.75.0 and the 2026-10-15 database.
  Sizes: backend 209 MB, frontend 30.5 MB.
- Alpine means musl: every runtime dependency must ship a musllinux wheel for amd64 and arm64, or
  the build would need a compiler. Any pin bump therefore repeats the wheel check before the strict
  scan (the remediation ladder in `.trivyignore`).
- Python 3.14 is new. Graders need Python 3.11 or later for the plain `pytest` path; the README also
  gives a Docker-only way to run the tests.
- One uvicorn worker per container keeps scaling a Kubernetes concern (replicas and the HPA), not a
  process-manager concern.
