#!/usr/bin/env bash
# make loadtest and make loadtest-stop: drive the HPA demo with the in-cluster load generator,
# Job default/stockpilot-loadgen (k8s/loadgen.yaml), after one planner call proves the catalogue
# is seeded. A 422 or an empty catalogue burns no CPU, so without that check the HPA would
# never move.
#
# Usage: scripts/load-test.sh [start|stop|status|precheck [URL]]
#   start (default)  precheck, then restart the Job and wait for its pod
#   stop             delete the Job and wait until its pod is gone
#   status           the Job's active pod count, its pods and the backend HPA
#   precheck [URL]   GET URL (default: the manifest's TARGET_URL) from a busybox pod in default;
#                    exits 1 unless the answer is JSON with at least one plan item
#
# Works on kind and EKS: kubectl uses the current context, or KUBE_CONTEXT when it is set, and the
# context is printed first.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=k8s/loadgen.yaml
JOB=stockpilot-loadgen
CHECK_POD=stockpilot-loadcheck
# One source of truth: the target URL and the image come from the manifest.
TARGET_URL=$(grep -m 1 -o 'http://stockpilot-backend[^"]*' "$MANIFEST")
IMAGE=$(awk '$1 == "image:" { print $2; exit }' "$MANIFEST")

usage() { echo "usage: scripts/load-test.sh [start|stop|status|precheck [URL]]"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
k() {
  if [ -n "${KUBE_CONTEXT:-}" ]; then kubectl --context "$KUBE_CONTEXT" "$@"; else kubectl "$@"; fi
}

precheck() {
  local url=${1:-$TARGET_URL} out json
  k -n default delete pod "$CHECK_POD" --ignore-not-found --wait >/dev/null
  echo "precheck: GET $url"
  # kubectl's own notes go to stderr; the pod's output (wget errors too) arrives on stdout, at
  # times twice when a fast pod makes kubectl fall back from attach to logs. The echo puts the
  # body on a line of its own. "$1" is expanded by the pod's shell, not this one.
  # shellcheck disable=SC2016
  out=$(k -n default run "$CHECK_POD" --rm -i --quiet --restart=Never --image="$IMAGE" \
    --command -- sh -c 'wget -qO- -T 60 "$1" && echo' sh "$url" 2>/dev/null) || true
  json=$(grep -m 1 '^[{]' <<<"$out" || true)
  if [ -n "$json" ] && jq -e '.items | length > 0' <<<"$json" >/dev/null 2>&1; then
    echo "precheck: ok, a plan with $(jq '.items | length' <<<"$json") items"
    return 0
  fi
  awk '!seen[$0]++ && n++ < 5' <<<"$out"
  echo "precheck: the planner did not return a plan with items; not starting load." >&2
  echo "  Seed first: kubectl --context $ctx -n stockpilot exec deploy/stockpilot-backend -- python -m app.seed" >&2
  return 1
}

start() {
  k get --raw /apis/metrics.k8s.io/v1beta1 >/dev/null 2>&1 ||
    die "the metrics API is not served, so the HPA cannot scale (make kind-up installs metrics-server)"
  k -n stockpilot get hpa stockpilot-backend >/dev/null 2>&1 ||
    die "hpa/stockpilot-backend not found in namespace stockpilot: deploy the app first"
  k -n stockpilot rollout status deploy/stockpilot-backend --timeout=120s >/dev/null ||
    die "deploy/stockpilot-backend did not finish rolling out"
  precheck
  # A finished Job cannot be restarted, so start from a clean slate.
  k delete -f "$MANIFEST" --ignore-not-found --wait --cascade=foreground
  k apply -f "$MANIFEST"
  k -n default wait --for=condition=Ready pod -l "app.kubernetes.io/name=$JOB" --timeout=120s
  cat <<EOF

Load is running: Job default/$JOB calls the planner until make loadtest-stop, or for at most
10 minutes. The HPA should reach 5 backend replicas within about 3 minutes.
  kubectl --context $ctx -n stockpilot get hpa stockpilot-backend -w
  kubectl --context $ctx -n stockpilot top pods
  Grafana: kubectl --context $ctx -n monitoring port-forward svc/kube-prometheus-stack-grafana 13000:80,
           then http://localhost:13000/d/stockpilot-overview
Stop: make loadtest-stop
EOF
}

# Foreground deletion returns only once the pod is gone, so the load has really stopped.
stop() { k delete -f "$MANIFEST" --ignore-not-found --wait --cascade=foreground; }

status() {
  local active
  active=$(k -n default get job "$JOB" -o jsonpath='{.status.active}' 2>/dev/null || true)
  if [ -n "$active" ]; then echo "loadgen: running ($active active pod)"; else echo "loadgen: not running"; fi
  k -n default get job,pods -l "app.kubernetes.io/name=$JOB"
  k -n stockpilot get hpa stockpilot-backend
}

mode=${1:-start}
case $mode in
  start | stop | status | precheck) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

command -v jq >/dev/null 2>&1 || die "jq not found (brew install jq)"
ctx=${KUBE_CONTEXT:-$(kubectl config current-context 2>/dev/null || true)}
[ -n "$ctx" ] || die "no current kube context: kubectl config use-context kind-stockpilot, or set KUBE_CONTEXT"
kubectl config get-contexts "$ctx" >/dev/null 2>&1 || die "kube context $ctx not found (kubectl config get-contexts)"
echo "load-test: context $ctx"

if [ "$mode" = precheck ]; then precheck "${2:-}"; else "$mode"; fi
