# shellcheck shell=bash
# Shared platform install for kind (scripts/kind-up.sh) and EKS (scripts/eks-bootstrap.sh): both
# clusters get the same namespaces, Secrets, chart versions and install order.
#
#   sp_namespaces CTX            apply k8s/namespace.yaml
#   sp_secrets CTX               stockpilot/stockpilot-db and monitoring/grafana-admin, created only if absent
#   sp_metrics_server CTX        metrics-server chart (kind; EKS runs the metrics-server add-on)
#   sp_traefik CTX kind|eks      Traefik; on eks it also waits for the LB hostname and prints APP_URL
#   sp_monitoring CTX kind|eks   kube-prometheus-stack, then waits for the ServiceMonitor CRD and Prometheus
#   sp_lb_hostname CTX           prints the Traefik LB hostname once AWS has assigned one
#
# A sourced library for bash 3.2 (macOS /bin/bash). It sets no shell options: callers run
# set -euo pipefail. Every kubectl and helm call goes through sp_k/sp_h with an explicit context,
# never the ambient one, so a stray current context cannot receive these installs.

[ -z "${SP_PLATFORM_SH:-}" ] || return 0 # sourced twice: the readonly pins below would clash
SP_PLATFORM_SH=1

readonly SP_TRAEFIK_CHART_VERSION=41.7.1        # traefik/traefik, Traefik v3.7.14
readonly SP_KPS_CHART_VERSION=92.7.0            # kube-prometheus-stack: Prometheus 3.15, Grafana 13.2
readonly SP_METRICS_SERVER_CHART_VERSION=3.14.0 # metrics-server v0.9.0
readonly SP_NS_APP=stockpilot SP_NS_MON=monitoring SP_NS_INGRESS=traefik
# The repository root, so the manifest and values paths work from any working directory.
SP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
readonly SP_ROOT

sp_log() { printf '==> %s\n' "$*" >&2; }
sp_die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

sp_k() { # sp_k CTX ARGS...: kubectl pinned to CTX
  local ctx=$1
  shift
  kubectl --context "$ctx" "$@"
}

sp_h() { # sp_h CTX ARGS...: helm pinned to CTX
  local ctx=$1
  shift
  helm --kube-context "$ctx" "$@"
}

sp_env_ok() {
  case $1 in
    kind | eks) ;;
    *) sp_die "the platform ENV must be kind or eks, not '$1'" ;;
  esac
}

sp_namespaces() {
  sp_log "namespaces"
  sp_k "$1" apply -f "$SP_ROOT/k8s/namespace.yaml"
}

# sp_ensure_secret CTX NS NAME HEX_BYTES FORMAT: creates Secret NS/NAME from the KEY=VALUE lines of
# the printf FORMAT, whose %s is a fresh random hex password, unless the Secret already exists.
# An existing Secret is never rotated: Postgres reads its password only at initdb, and the volume
# outlives the release.
sp_ensure_secret() {
  local ctx=$1 ns=$2 name=$3 bytes=$4 format=$5 pw
  if sp_k "$ctx" -n "$ns" get secret "$name" >/dev/null 2>&1; then
    sp_log "secret $ns/$name exists, kept"
    return 0
  fi
  pw=$(openssl rand -hex "$bytes")
  # The values travel through a pipe, never argv, so ps cannot show them.
  # shellcheck disable=SC2059 # the format strings are the literals in sp_secrets
  sp_k "$ctx" -n "$ns" create secret generic "$name" --from-env-file=<(printf "$format" "$pw") >/dev/null
  sp_log "secret $ns/$name created"
}

sp_secrets() {
  # Hex passwords keep DATABASE_URL URL-safe.
  sp_ensure_secret "$1" "$SP_NS_APP" stockpilot-db 24 'username=app\npassword=%s\ndatabase=stockpilot\n'
  sp_ensure_secret "$1" "$SP_NS_MON" grafana-admin 16 'admin-user=admin\nadmin-password=%s\n'
}

sp_metrics_server() {
  sp_log "metrics-server chart $SP_METRICS_SERVER_CHART_VERSION"
  # kind's kubelets serve self-signed certificates.
  sp_h "$1" upgrade --install metrics-server metrics-server \
    --repo https://kubernetes-sigs.github.io/metrics-server/ --version "$SP_METRICS_SERVER_CHART_VERSION" \
    -n kube-system --set 'args={--kubelet-insecure-tls}' --wait --timeout 5m
}

sp_traefik() {
  local ctx=$1 env=$2 host
  sp_env_ok "$env"
  sp_log "Traefik chart $SP_TRAEFIK_CHART_VERSION ($env)"
  # --repo, not helm repo add: the install never depends on or changes the user's Helm repo list.
  sp_h "$ctx" upgrade --install traefik traefik --repo https://traefik.github.io/charts \
    --version "$SP_TRAEFIK_CHART_VERSION" -n "$SP_NS_INGRESS" \
    -f "$SP_ROOT/platform/traefik-values-$env.yaml" --wait --timeout 10m
  [ "$env" = eks ] || return 0
  host=$(sp_lb_hostname "$ctx") || return 1
  echo "APP_URL=http://$host"
}

# Polls every 10 s for up to 10 minutes: helm --wait does not wait for a LoadBalancer address.
sp_lb_hostname() {
  local ctx=$1 host _
  for _ in $(seq 60); do
    host=$(sp_k "$ctx" -n "$SP_NS_INGRESS" get svc traefik \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null) || host=""
    if [ -n "$host" ]; then
      echo "$host"
      return 0
    fi
    sleep 10
  done
  sp_k "$ctx" -n "$SP_NS_INGRESS" describe svc traefik | sed -n '/^Events:/,$p' >&2
  sp_log "no LB hostname after 10 minutes. OperationNotPermitted in the events above means the account" \
    "may not create load balancers yet (open an AWS support case); otherwise check the" \
    "kubernetes.io/role/elb subnet tags and that each node has exactly one cluster-tagged security group"
  return 1
}

sp_monitoring() {
  local ctx=$1 env=$2 extra=()
  sp_env_ok "$env"
  # kubeadm (kind) serves kube-proxy metrics on 127.0.0.1 only, so that target would be DOWN.
  if [ "$env" = kind ]; then extra=(--set kubeProxy.enabled=false); fi
  sp_log "kube-prometheus-stack chart $SP_KPS_CHART_VERSION ($env)"
  # --hide-notes: the chart's notes point at a Grafana password Secret that is never created,
  # because grafana-values.yaml reads the login from grafana-admin (existingSecret).
  sp_h "$ctx" upgrade --install kube-prometheus-stack \
    oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack --version "$SP_KPS_CHART_VERSION" \
    -n "$SP_NS_MON" -f "$SP_ROOT/monitoring/prometheus-values.yaml" -f "$SP_ROOT/monitoring/grafana-values.yaml" \
    ${extra[@]+"${extra[@]}"} --hide-notes --wait --timeout 10m
  sp_k "$ctx" wait --for condition=established crd/servicemonitors.monitoring.coreos.com --timeout=120s
  # The operator creates the Prometheus StatefulSet after helm returns.
  sp_k "$ctx" -n "$SP_NS_MON" wait --for condition=Available \
    prometheus/kube-prometheus-stack-prometheus --timeout=5m
}
