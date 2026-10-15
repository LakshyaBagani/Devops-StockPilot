#!/usr/bin/env bash
# make kind-up and make kind-deploy: the free local rehearsal on the kind cluster "stockpilot".
#
# Usage: scripts/kind-up.sh [all|preflight|cluster|platform|app]
#   all (default)  preflight + cluster + platform, which is make kind-up. Never deploys the app.
#   preflight      tools, Docker, Helm 4, Docker memory, and port 8080 for a new cluster
#   cluster        creates the kind cluster unless it exists
#   platform       namespaces, Secrets, metrics-server, Traefik, kube-prometheus-stack
#   app            make kind-deploy: build and kind load both images, helm upgrade, helm test,
#                  seed, then a smoke check through Traefik on http://localhost:8080
#
# Environment for app:
#   TAG              image tag; default dev-<sha7>, or with SKIP_BUILD=1 the deployed release's tag
#   SKIP_BUILD=1     no docker build: reuse images already in Docker or on the kind node
#   HELM_EXTRA_ARGS  extra simple flags for helm upgrade, e.g. '--set postgres.hardened=true'
#   GIT_SHA          backend.gitSha; default git rev-parse HEAD, or the deployed one when the tag is
#
# Every kubectl and helm call is pinned to context kind-stockpilot, so a current EKS context never
# receives these local arm64 images.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/platform.sh
. scripts/lib/platform.sh

CLUSTER=stockpilot
CTX=kind-$CLUSTER
RELEASE=stockpilot
CHART=helm/stockpilot
URL=http://localhost:8080
SKIP_BUILD=${SKIP_BUILD:-0}
HELM_EXTRA_ARGS=${HELM_EXTRA_ARGS:-}

usage() { echo "usage: scripts/kind-up.sh [all|preflight|cluster|platform|app]"; }

cluster_exists() {
  case $'\n'"$(kind get clusters 2>/dev/null)"$'\n' in
    *$'\n'"$CLUSTER"$'\n'*) return 0 ;;
  esac
  return 1
}

preflight() {
  local tool mem
  for tool in docker kind kubectl helm jq openssl curl lsof; do
    command -v "$tool" >/dev/null 2>&1 || sp_die "$tool not found (make doctor prints the install command)"
  done
  docker info >/dev/null 2>&1 || sp_die "Docker is not running (open -a Docker)"
  case $(sp_h "$CTX" version --short 2>/dev/null) in
    v4.*) ;;
    *) sp_die "Helm 4 is required for --rollback-on-failure" ;;
  esac
  mem=$(docker info --format '{{.MemTotal}}')
  if [ "$mem" -lt $((6 * 1024 * 1024 * 1024)) ]; then
    sp_log "WARN: Docker has $((mem / 1024 / 1024 / 1024)) GiB of memory; kind with monitoring wants 6 GiB or more"
  fi
  if ! cluster_exists && lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    sp_die "port 8080 is in use, but the new cluster publishes Traefik on 127.0.0.1:8080:" \
      "$(lsof -nP -iTCP:8080 -sTCP:LISTEN | sed -n 2p)"
  fi
  sp_log "preflight ok"
}

cluster() {
  if cluster_exists; then
    sp_log "kind cluster $CLUSTER exists"
  else
    sp_log "creating kind cluster $CLUSTER"
    kind create cluster --name "$CLUSTER" --config k8s/kind-config.yaml --wait 2m
  fi
  sp_k "$CTX" get nodes
}

platform() {
  sp_namespaces "$CTX"
  sp_secrets "$CTX"
  sp_metrics_server "$CTX"
  sp_traefik "$CTX" kind
  sp_monitoring "$CTX" kind
}

platform_summary() {
  cat <<EOF

kind cluster $CLUSTER is ready (context $CTX): metrics-server, Traefik, kube-prometheus-stack.
  $URL/ answers 404 from Traefik until the app is deployed.
Grafana (user admin): kubectl --context $CTX -n monitoring port-forward svc/kube-prometheus-stack-grafana 13000:80
  password: kubectl --context $CTX -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode
Next: make kind-deploy
EOF
}

# deployed JQ_PATH: a value the deployed release was installed with, or nothing.
deployed() {
  local json
  json=$(sp_h "$CTX" -n "$SP_NS_APP" get values "$RELEASE" -o json 2>/dev/null) || return 0
  jq -r "$1 // empty" <<<"$json"
}

# load_image IMAGE: copies IMAGE from Docker into the kind node; kind skips it when the node
# already has that image ID. With SKIP_BUILD=1 an image that is only on the node is fine too.
load_image() {
  if docker image inspect "$1" >/dev/null 2>&1; then
    kind load docker-image "$1" --name "$CLUSTER" ||
      sp_die "kind load failed for $1. On 'content digest not found': docker save --platform linux/arm64" \
        "-o /tmp/image.tar $1 && kind load image-archive /tmp/image.tar --name $CLUSTER"
  elif docker exec "$CLUSTER-control-plane" crictl inspecti "docker.io/library/$1" >/dev/null 2>&1; then
    sp_log "$1 is not in Docker but already on the kind node"
  else
    sp_die "$1 is neither in Docker nor on the kind node: run make kind-deploy without SKIP_BUILD=1"
  fi
}

# smoke SHA: /api/version through Traefik serves SHA, and / answers 200.
smoke() {
  local want=$1 got="" code="" _
  for _ in $(seq 30); do
    got=$(curl -fsS --max-time 5 "$URL/api/version" 2>/dev/null | jq -r '.git_sha // empty' 2>/dev/null) || got=""
    code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$URL/") || code=""
    if [ "$got" = "$want" ] && [ "$code" = 200 ]; then
      sp_log "smoke ok: $URL/api/version git_sha=$got, $URL/ $code"
      return 0
    fi
    sleep 2
  done
  sp_die "smoke failed: $URL/api/version git_sha='$got' (want $want), $URL/ answered '$code'"
}

app() {
  local tag=${TAG:-} git_sha=${GIT_SHA:-} extra=() image
  cluster_exists || sp_die "kind cluster $CLUSTER not found: run make kind-up first"
  # Without it the pods never start, and helm would sit out the whole --wait before rolling back.
  sp_k "$CTX" -n "$SP_NS_APP" get secret stockpilot-db >/dev/null 2>&1 ||
    sp_die "Secret $SP_NS_APP/stockpilot-db not found: run make kind-up first"
  if [ -z "$tag" ] && [ "$SKIP_BUILD" = 1 ]; then
    tag=$(deployed .backend.image.tag)
    [ -n "$tag" ] || sp_die "SKIP_BUILD=1 reuses the deployed tag, but release $RELEASE is not installed: pass TAG=<tag>"
    [ -n "$git_sha" ] || git_sha=$(deployed .backend.gitSha)
  fi
  [ -n "$tag" ] || tag=dev-$(git rev-parse --short=7 HEAD 2>/dev/null || echo dev)
  [ -n "$git_sha" ] || git_sha=$(git rev-parse HEAD 2>/dev/null || echo dev)

  if [ "$SKIP_BUILD" = 1 ]; then
    sp_log "SKIP_BUILD=1: reusing the images tagged $tag"
  else
    # The pod spec only changes with the tag: a rebuild under the deployed tag would reach new
    # pods (an HPA scale-up) but never roll the running ones.
    if [ "$(deployed .backend.image.tag)" = "$tag" ]; then
      sp_log "WARN: $tag is already deployed, so its pods keep their image; to roll out a rebuild" \
        "(uncommitted changes), use a new tag: make kind-deploy TAG=dev-2"
    fi
    sp_log "building stockpilot-backend:$tag and stockpilot-frontend:$tag"
    docker build --provenance=false --build-arg GIT_SHA="$git_sha" \
      --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" -t "stockpilot-backend:$tag" backend
    docker build --provenance=false --build-arg VITE_GIT_SHA="$git_sha" -t "stockpilot-frontend:$tag" frontend
  fi
  for image in "stockpilot-backend:$tag" "stockpilot-frontend:$tag"; do
    load_image "$image" # one image per kind load
  done

  read -r -a extra <<<"$HELM_EXTRA_ARGS"
  sp_log "helm upgrade --install $RELEASE (tag $tag, gitSha $git_sha)"
  sp_h "$CTX" upgrade --install "$RELEASE" "$CHART" -n "$SP_NS_APP" \
    -f "$CHART/values.yaml" -f "$CHART/values-kind.yaml" \
    --set-string backend.image.tag="$tag" --set-string frontend.image.tag="$tag" \
    --set-string backend.gitSha="$git_sha" --description "kind $tag" \
    --rollback-on-failure --wait --timeout 10m ${extra[@]+"${extra[@]}"}

  sp_log "helm test"
  # No --logs: it races the hook-succeeded deletion. A failed test pod is kept for kubectl logs.
  sp_h "$CTX" test "$RELEASE" -n "$SP_NS_APP" --timeout 3m
  sp_log "seed (idempotent)"
  sp_k "$CTX" -n "$SP_NS_APP" exec deploy/stockpilot-backend -- python -m app.seed
  smoke "$git_sha"

  cat <<EOF

StockPilot $tag is running on kind (context $CTX).
  UI        $URL/
  API docs  $URL/api/docs
Port-forwards, one terminal each:
  kubectl --context $CTX -n stockpilot port-forward svc/stockpilot-backend 18000:8000              # /metrics
  kubectl --context $CTX -n monitoring port-forward svc/kube-prometheus-stack-prometheus 19090:9090 # Prometheus
  kubectl --context $CTX -n monitoring port-forward svc/kube-prometheus-stack-grafana 13000:80      # Grafana (admin)
Grafana password:
  kubectl --context $CTX -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode
Next: make loadtest
EOF
}

case ${1:-all} in
  all)
    preflight
    cluster
    platform
    platform_summary
    ;;
  preflight) preflight ;;
  cluster) cluster ;;
  platform) platform ;;
  app) app ;;
  -h | --help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
