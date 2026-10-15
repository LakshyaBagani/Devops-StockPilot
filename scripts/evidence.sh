#!/usr/bin/env bash
# make evidence ENV=<kind|eks> MODULE=<m8|m9|all>: runs the M8/M9 terminal evidence commands, each
# echoed after a '$ ' prompt so a screenshot shows the command with its output, and holds the
# port-forwards open for the browser shots. Never prints a secret value.
#
# Usage: scripts/evidence.sh <kind|eks> <m8|m9|all>
#   kind  context kind-stockpilot, app at http://localhost:8080
#   eks   context $EKS_CONTEXT (default: the current context, never a kind-* one), app at the
#         Traefik load balancer
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "usage: scripts/evidence.sh <kind|eks> <m8|m9|all>"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[ $# -eq 2 ] || {
  usage >&2
  exit 2
}
env=$1 module=$2
case $module in
  m8 | m9 | all) ;;
  *)
    usage >&2
    exit 2
    ;;
esac
case $env in
  kind) ctx=kind-stockpilot ;;
  eks)
    ctx=${EKS_CONTEXT:-$(kubectl config current-context 2>/dev/null || true)}
    [ -n "$ctx" ] || die "no current kube context: set EKS_CONTEXT=stockpilot-eks"
    case $ctx in
      kind-*) die "refusing context $ctx for EKS evidence: set EKS_CONTEXT=stockpilot-eks" ;;
    esac
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

K="kubectl --context $ctx"
H="helm --kube-context $ctx"
failed=0
forwards=()

# Kills exactly the port-forwards this script started, never a pattern match.
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  if [ ${#forwards[@]} -gt 0 ]; then kill "${forwards[@]}" 2>/dev/null || true; fi
}
trap cleanup EXIT

section() { printf '\n==== %s ====\n' "$*"; }

# run 'COMMAND': prints it after a '$ ' prompt, then runs it. A failure is reported and the run
# goes on, so one missing item does not hide the rest; the exit status reports it at the end.
run() {
  printf '\n$ %s\n' "$1"
  eval "$1" || {
    echo "(exit $?)"
    failed=1
  }
}

base_url() {
  local lb
  if [ "$env" = kind ]; then
    echo http://localhost:8080
    return
  fi
  lb=$($K -n traefik get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
  [ -n "$lb" ] || die "the Traefik Service has no load balancer hostname yet"
  echo "http://$lb"
}

# forward NS SVC LOCAL:REMOTE PATH: starts a port-forward, then waits until LOCAL answers on PATH.
forward() {
  local port=${3%%:*} pid _
  # Another listener on the port would answer the readiness check below and get screenshotted.
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "localhost:$port is already in use: stop that process or port-forward first"
  fi
  $K -n "$1" port-forward "svc/$2" "$3" >/dev/null 2>&1 &
  pid=$!
  forwards+=("$pid")
  for _ in $(seq 30); do
    if curl -s -o /dev/null --max-time 2 "localhost:$port$4"; then return 0; fi
    kill -0 "$pid" 2>/dev/null || die "the port-forward to $1/$2 exited: does the Service have a Ready pod?"
    sleep 1
  done
  die "the port-forward to $1/$2 on localhost:$port does not answer"
}

m8() {
  local base
  base=$(base_url)
  section "m8-00 namespaces with Pod Security labels (m8-00-namespace-apply.png)"
  run "$K apply -f k8s/namespace.yaml"
  run "$K get ns stockpilot monitoring traefik --show-labels"
  section "m8-01 pods (m8-01-pods.png)"
  run "$K -n stockpilot get pods -o wide"
  section "m8-02 services (m8-02-svc.png)"
  run "$K -n stockpilot get svc"
  section "m8-03 Helm release (m8-03-helm-list.png)"
  run "$H list -n stockpilot"
  run "$H history stockpilot -n stockpilot --max 3"
  section "m8-04 the app through the Ingress (m8-04-ingress-browser.png)"
  echo "Open $base/ in a browser, with the URL bar visible."
  section "m8-05 HPA scale-out (m8-05-hpa-scaleout.png)"
  cat <<EOF
Terminal 1: kubectl --context $ctx -n stockpilot get hpa stockpilot-backend -w
Terminal 2: kubectl config use-context $ctx && make loadtest
Screenshot terminal 1 once REPLICAS goes 2 -> 5, then run make loadtest-stop.
EOF
  section "m8-06 Ingress rules and routing (m8-06-ingress-rules.png)"
  run "$K -n stockpilot describe ingress stockpilot"
  # A GET, not curl -I: FastAPI answers HEAD with 405. server: uvicorn proves /api skips nginx.
  run "curl -s -D - -o /dev/null $base/api/version | grep -iE '^(HTTP|server)'"
  run "curl -s -D - -o /dev/null $base/ | grep -iE '^(HTTP|server)'"
}

m9() {
  section "m9-00 monitoring stack (m9-00-monitoring-pods.png)"
  run "$H list -n monitoring"
  run "$K -n monitoring get pods"
  forward stockpilot stockpilot-backend 18000:8000 /metrics
  forward monitoring kube-prometheus-stack-prometheus 19090:9090 /-/ready
  forward monitoring kube-prometheus-stack-grafana 13000:80 /api/health
  section "m9-01 the backend's /metrics (m9-01-metrics-curl.png)"
  # prometheus_client adds a <name>_created gauge to every counter, summary and histogram.
  # Dropping those and the histogram buckets lets the 40 lines reach the http_* series too.
  run "curl -s localhost:18000/metrics | grep -E '^(# (HELP|TYPE) )?(http_request|stockpilot_)' | grep -vE '_(created|bucket)[ {]' | head -40"
  section "m9-02 scrape targets (m9-02-targets-up.png)"
  run "curl -s 'localhost:19090/api/v1/targets?state=active' | jq -r '.data.activeTargets[] | select(.labels.namespace==\"stockpilot\") | [.scrapePool, .health, .labels.pod] | @tsv'"
  run "curl -s localhost:19090/api/v1/query --data-urlencode 'query=up{namespace=\"stockpilot\"}' | jq -r '.data.result[] | [.metric.pod, .value[1]] | @tsv'"
  section "browser shots (m9-02-targets-up.png, m9-03-grafana.png)"
  cat <<EOF
Prometheus  http://localhost:19090/targets  (filter: stockpilot), then the Query tab with up{namespace="stockpilot"}
Grafana     http://localhost:13000/d/stockpilot-overview  (user admin), after at least 3 minutes of load
Grafana password, copied to the clipboard without displaying it:
  kubectl --context $ctx -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode | pbcopy
EOF
  printf '\nPress Enter to stop the port-forwards. '
  read -r _ || true
}

printf 'Evidence: %s, context %s\n' "$env" "$ctx"
case $module in
  m8) m8 ;;
  m9) m9 ;;
  all)
    m8
    m9
    ;;
esac
exit "$failed"
