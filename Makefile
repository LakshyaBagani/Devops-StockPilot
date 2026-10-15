# StockPilot command map. Run `make` (or `make help`) to list every target.
#
# This file holds the shared settings. Each layer owns one include file:
#   mk/backend.mk  backend tests and lint      mk/local.mk  machine checks, local runs, compose, scans
#   mk/kind.mk     kind cluster and Helm       mk/eks.mk    Terraform and the EKS lifecycle
#
# Written for GNU Make 3.81 (macOS /usr/bin/make): no .ONESHELL, .SHELLFLAGS, != or $(file),
# and every recipe line runs in its own shell.

# 3.81 has no .SHELLFLAGS, so the strict flags ride on SHELL: stop on an error, an unset
# variable or a failed pipe stage.
SHELL := /bin/bash -eu -o pipefail
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

REPO_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
GIT_SHA   := $(shell git -C '$(REPO_ROOT)' rev-parse HEAD 2>/dev/null || echo dev)
SHORT_SHA := $(shell git -C '$(REPO_ROOT)' rev-parse --short=7 HEAD 2>/dev/null || echo dev)
# Tag for locally built images; a new tag per commit makes kind roll the pods.
TAG ?= dev-$(SHORT_SHA)

# Backend. PYTHON creates backend/.venv; PY is that venv's interpreter once it exists.
# PY is absolute, so recipes can `cd backend` first, and recursively expanded, so it
# picks up a venv created earlier in the same run.
PYTHON ?= python3.14
VENV   := backend/.venv
PY     ?= $(if $(wildcard $(VENV)/bin/python),$(REPO_ROOT)/$(VENV)/bin/python,python3)

# Frontend.
NPM ?= npm

# Local image names. CI publishes ghcr.io/lakshyabagani/stockpilot-{backend,frontend}.
BACKEND_IMG  := stockpilot-backend
FRONTEND_IMG := stockpilot-frontend

# The one Postgres image for test-pg, dev-db and compose. Pin the multi-arch index digest
# (amd64 CI + arm64 Mac), never a single-platform one.
PG_IMAGE := postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873

.PHONY: help
help: ## List the targets, grouped by the file that defines them
	@echo 'Usage: make <target> [VAR=value]'
	@awk -F ':.*## ' '/^[A-Za-z0-9_.-]+:.*## / { if (FILENAME != shown) { printf "\n%s\n", FILENAME; shown = FILENAME } printf "  %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

include $(sort $(wildcard mk/*.mk))
