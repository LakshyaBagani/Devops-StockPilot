# Local tooling: setup, dev loop, lint gate, compose stack, image scans and machine checks.

# Extra arguments for the doctor, digests and seed scripts, e.g. ARGS=--offline.
ARGS ?=

# Install stamps. They are rebuilt when a dependency file changes, so any target that needs the
# venv or node_modules works on a fresh clone.
VENV_STAMP := $(VENV)/.stamp
NODE_STAMP := frontend/node_modules/.package-lock.json

# The dev database persists between runs (make dev-clean deletes it). Local-only credentials,
# published on 127.0.0.1 only; the tests use their own throwaway container on :55432.
DEV_DB        := stockpilot-dev-pg
DEV_DB_VOLUME := stockpilot_devpg
DEV_DB_PORT   := 55433
DEV_DB_URL    := postgresql+psycopg://app:localdev@127.0.0.1:$(DEV_DB_PORT)/stockpilot

# The flags of the CI gate step "Trivy gate (HIGH/CRITICAL, strict)": unfixed findings fail too.
# CI builds linux/amd64 images, so make scan builds and scans that platform, even on an arm64 Mac.
TRIVY_FLAGS   := --scanners vuln --pkg-types os,library --severity HIGH,CRITICAL --exit-code 1 --ignorefile .trivyignore --format table
SCAN_PLATFORM ?= linux/amd64

.PHONY: setup dev-db dev dev-api dev-ui dev-clean lint lint-frontend lint-infra \
	up down ps logs seed scan digests doctor gitleaks loadtest loadtest-stop

setup: $(VENV_STAMP) $(if $(wildcard frontend/package.json),$(NODE_STAMP)) ## Install backend/.venv and frontend/node_modules from the lock files

$(VENV_STAMP): backend/requirements-runtime.txt backend/requirements.txt backend/requirements-dev.txt backend/constraints.txt
	[ -x $(VENV)/bin/python ] || $(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install -q -r backend/requirements-dev.txt -c backend/constraints.txt
	touch $@

$(NODE_STAMP): frontend/package.json frontend/package-lock.json
	cd frontend && $(NPM) ci

# The backend targets (mk/backend.mk) run in the venv.
test cov test-pg lint-backend fmt: $(VENV_STAMP)

dev-db: $(VENV_STAMP) ## Start or reuse the dev Postgres on 127.0.0.1:55433, then migrate and seed it
	@if docker container inspect $(DEV_DB) >/dev/null 2>&1; then \
	  echo "dev-db: reusing $(DEV_DB)"; \
	  docker start $(DEV_DB) >/dev/null; \
	else \
	  echo "dev-db: starting $(DEV_DB) on 127.0.0.1:$(DEV_DB_PORT) (volume $(DEV_DB_VOLUME))"; \
	  docker run -d --name $(DEV_DB) -p 127.0.0.1:$(DEV_DB_PORT):5432 -v $(DEV_DB_VOLUME):/var/lib/postgresql \
	    -e POSTGRES_USER=app -e POSTGRES_PASSWORD=localdev -e POSTGRES_DB=stockpilot $(PG_IMAGE) >/dev/null; \
	fi; \
	for i in $$(seq 60); do \
	  docker exec $(DEV_DB) pg_isready -h 127.0.0.1 -U app -d stockpilot >/dev/null 2>&1 && break; \
	  if [ "$$i" -eq 60 ]; then echo 'dev-db: Postgres not ready after 60 s' >&2; exit 1; fi; \
	  sleep 1; \
	done
	cd backend && DATABASE_URL='$(DEV_DB_URL)' $(PY) -m alembic upgrade head
	cd backend && DATABASE_URL='$(DEV_DB_URL)' $(PY) -m app.seed

dev: dev-db $(NODE_STAMP) ## dev-db, then uvicorn --reload on :8000 and Vite on :5173 (Ctrl-C stops both)
	@echo 'dev: UI http://127.0.0.1:5173  API docs http://127.0.0.1:8000/api/docs'
	$(MAKE) --no-print-directory -j2 dev-api dev-ui

dev-api: $(VENV_STAMP) ## uvicorn --reload on 127.0.0.1:8000 against the dev database
	cd backend && DATABASE_URL='$(DEV_DB_URL)' GIT_SHA='$(GIT_SHA)' $(PY) -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

dev-ui: $(NODE_STAMP) ## Vite on 127.0.0.1:5173, proxying /api to :8000
	cd frontend && $(NPM) run dev -- --host 127.0.0.1 --port 5173 --strictPort

dev-clean: ## Delete the dev Postgres container and its volume
	docker rm -fv $(DEV_DB) 2>/dev/null || true
	docker volume rm -f $(DEV_DB_VOLUME)

lint: lint-backend $(if $(wildcard frontend/package.json),lint-frontend) lint-infra ## The lint gate: backend, frontend and infra

lint-frontend: $(NODE_STAMP) ## ESLint and the guardrails, then the node:test suite
	cd frontend && $(NPM) run lint && $(NPM) test

lint-infra: ## docker compose config, then shellcheck on the scripts (skipped if not installed)
	docker compose config --quiet
	@if command -v shellcheck >/dev/null 2>&1; then \
	  echo 'shellcheck -S warning scripts/*.sh scripts/lib/*.sh'; \
	  shellcheck -S warning scripts/*.sh scripts/lib/*.sh; \
	else \
	  echo 'lint-infra: shellcheck not installed, scripts not checked (brew install shellcheck)'; \
	fi

# Echoed on purpose: the M4 evidence shows the compose command itself.
up: ## Build and start postgres, backend and frontend; returns once all three are healthy
	GIT_SHA=$(GIT_SHA) docker compose up --build --wait
	@echo 'up: UI http://localhost:3000  API docs http://localhost:3000/api/docs  demo data: make seed'

down: ## Stop the compose stack and delete its database volume
	docker compose down -v

ps: ## The compose services and their health
	docker compose ps

logs: ## Follow the compose logs
	docker compose logs -f --tail=100

seed: ## Load the demo data into the compose database; safe to repeat (ARGS=--demo-reset)
	docker compose exec -T backend python -m app.seed $(ARGS)

scan: ## Strict Trivy gate on linux/amd64 builds of both images, as in CI: any HIGH/CRITICAL fails
	docker build --platform $(SCAN_PLATFORM) --provenance=false --build-arg GIT_SHA=$(GIT_SHA) -t $(BACKEND_IMG):scan backend
	docker build --platform $(SCAN_PLATFORM) --provenance=false --build-arg VITE_GIT_SHA=$(GIT_SHA) -t $(FRONTEND_IMG):scan frontend
	@rc=0; \
	for img in $(BACKEND_IMG):scan $(FRONTEND_IMG):scan; do \
	  echo "trivy image --platform $(SCAN_PLATFORM) $(TRIVY_FLAGS) $$img"; \
	  trivy image --platform $(SCAN_PLATFORM) $(TRIVY_FLAGS) $$img || rc=1; \
	done; \
	if [ $$rc = 0 ]; then echo 'scan: 0 HIGH/CRITICAL in both images (strict, unfixed included)'; \
	else echo 'scan: HIGH/CRITICAL found; fix it with the remediation ladder in .trivyignore' >&2; fi; \
	exit $$rc

digests: ## Compare every pinned image digest with its registry tag; warns on drift, never edits
	scripts/doctor.sh digests $(ARGS)

doctor: ## Check tools, GitHub/AWS identity, ignore rules and ports (ARGS='repo --offline')
	scripts/doctor.sh $(ARGS)

gitleaks: ## Scan the local Git history for secrets; run before every push
	gitleaks git --redact -v .

# The load generator follows the current kube context (kind or EKS), or KUBE_CONTEXT=<name>.
loadtest: ## Planner load for the HPA demo: checks for a seeded plan, then starts Job default/stockpilot-loadgen
	scripts/load-test.sh start

loadtest-stop: ## Stop the load generator; the HPA returns to 2 replicas about a minute later
	scripts/load-test.sh stop
