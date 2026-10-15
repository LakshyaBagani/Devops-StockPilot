#!/usr/bin/env bash
# make kind-down: deletes the kind cluster "stockpilot" and its kube context. Docker images stay.
set -euo pipefail
kind delete cluster --name stockpilot
