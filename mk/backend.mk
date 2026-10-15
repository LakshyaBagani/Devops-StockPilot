# Backend tests and lint. Every recipe runs from backend/ with PY, the venv interpreter.
# `lint` (the aggregate over all layers) lives in mk/local.mk.

PYTEST_ARGS ?=
TESTDB      ?= stockpilot-test-pg
TESTDB_PORT ?= 55432
# Throwaway credentials of the disposable test container; it only listens on 127.0.0.1.
TESTDB_URL  := postgresql+psycopg://test:test@127.0.0.1:$(TESTDB_PORT)

.PHONY: test cov test-pg lint-backend fmt

test: ## Backend tests on in-memory SQLite (PYTEST_ARGS='-k planner')
	cd backend && $(PY) -m pytest -v $(PYTEST_ARGS)

cov: ## Backend tests with a coverage report (threshold in backend/pyproject.toml)
	cd backend && $(PY) -m pytest -v --cov=app --cov-report=term-missing $(PYTEST_ARGS)

# One shell line (GNU Make 3.81 has no .ONESHELL), so the trap removes the container on
# success, failure and Ctrl-C. pg_isready -h 127.0.0.1 checks TCP: the image's socket-only
# init server never counts as ready. Alembic cycles on /postgres, pytest runs on
# /stockpilot_test, as in CI; the compose database and port 5432 are never touched.
test-pg: ## Alembic cycle + backend tests on a throwaway Postgres 18 at 127.0.0.1:55432
	docker rm -fv $(TESTDB) >/dev/null 2>&1 || true; \
	trap 'docker rm -fv $(TESTDB) >/dev/null 2>&1 || true' EXIT INT TERM; \
	docker run -d --rm --name $(TESTDB) -p 127.0.0.1:$(TESTDB_PORT):5432 \
		-e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=stockpilot_test \
		$(PG_IMAGE) >/dev/null; \
	for i in $$(seq 60); do \
		docker exec $(TESTDB) pg_isready -h 127.0.0.1 -U test -d stockpilot_test >/dev/null 2>&1 && break; \
		if [ "$$i" -eq 60 ]; then echo 'test-pg: Postgres not ready after 60 s' >&2; exit 1; fi; \
		sleep 1; \
	done; \
	echo '== alembic upgrade head, check, downgrade base, upgrade head on .../postgres'; \
	(cd backend && export DATABASE_URL=$(TESTDB_URL)/postgres \
		&& $(PY) -m alembic upgrade head && $(PY) -m alembic check \
		&& $(PY) -m alembic downgrade base && $(PY) -m alembic upgrade head); \
	echo '== pytest on .../stockpilot_test'; \
	cd backend && TEST_DATABASE_URL=$(TESTDB_URL)/stockpilot_test TEST_REQUIRE_POSTGRES=1 \
		$(PY) -m pytest -v $(PYTEST_ARGS)

lint-backend: ## ruff check + format check of backend/
	cd backend && $(PY) -m ruff check . && $(PY) -m ruff format --check .

fmt: ## Format backend/ and apply ruff's safe fixes
	cd backend && $(PY) -m ruff format . && $(PY) -m ruff check --fix .
