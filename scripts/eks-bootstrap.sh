#!/usr/bin/env bash
# make eks-bootstrap: platform setup on the EKS cluster after make eks-up. Safe to re-run at any
# point, before or after the app is deployed (B76).
#
#   identity checks -> kube context stockpilot-eks -> cluster health -> namespaces -> Secrets
#   -> Traefik and its Classic LB -> kube-prometheus-stack -> repo variables APP_URL, AWS_DEPLOY_ROLE_ARN
#
# The installs are the shared ones in scripts/lib/platform.sh: the same charts, versions and order
# as kind. Re-runs change nothing: Secrets are created only when absent (never rotated) and every
# chart is helm upgrade --install. It never enables CI deploys; that flag is your approval gate.
# Never turn on xtrace: it would print the generated passwords.
#
# Must run on macOS /bin/bash 3.2.
set -euo pipefail

cd "$(dirname "$0")/.."
export AWS_PROFILE=${SP_AWS_PROFILE:-stockpilot} AWS_REGION=${SP_AWS_REGION:-ap-south-1} AWS_PAGER=""
export CHECKPOINT_DISABLE=1 # keeps terraform from phoning home
# shellcheck source=scripts/lib/platform.sh
. scripts/lib/platform.sh

REPO=LakshyaBagani/Devops-StockPilot
ADDONS="vpc-cni eks-pod-identity-agent kube-proxy coredns metrics-server aws-ebs-csi-driver"
CLUSTER=$(terraform -chdir=terraform output -raw cluster_name 2>/dev/null || true)
CLUSTER=${CLUSTER:-stockpilot-eks}
KCTX=$CLUSTER # the --alias that configure_kubectl gives the context
LB=""

# retry TRIES SECONDS CMD...: runs CMD until it succeeds, at most TRIES times, SECONDS apart.
retry() {
  local tries=$1 pause=$2 i
  shift 2
  for i in $(seq "$tries"); do
    if "$@"; then return 0; fi
    if [ "$i" -lt "$tries" ]; then sleep "$pause"; fi
  done
  return 1
}

guard_identity() {
  local account want login
  account=$(aws sts get-caller-identity --query Account --output text) ||
    sp_die "no AWS session for profile $AWS_PROFILE: aws sso login --profile $AWS_PROFILE"
  [ -f terraform/terraform.tfvars ] || sp_die "terraform/terraform.tfvars not found (terraform/README.md section 5)"
  want=$(sed -nE 's/^[[:space:]]*aws_account_id[[:space:]]*=[[:space:]]*"([0-9]{12})".*/\1/p' \
    terraform/terraform.tfvars | sed -n 1p)
  [ -n "$want" ] || sp_die "terraform/terraform.tfvars has no aws_account_id"
  [ "$account" = "$want" ] || sp_die "the signed-in AWS account is not aws_account_id in terraform/terraform.tfvars"
  login=$(gh api user --jq .login 2>/dev/null || true)
  [ "$login" = LakshyaBagani ] ||
    sp_die "gh is logged in as '${login:-nobody}', want LakshyaBagani: gh auth switch -h github.com -u LakshyaBagani"
}

kubeconfig() {
  sp_log "kube context $KCTX (fails here when the cluster does not exist)"
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER" --alias "$KCTX"
  case $(sp_h "$KCTX" version --short 2>/dev/null) in
    v4.*) ;;
    *) sp_die "Helm 4 is required (--rollback-on-failure)" ;;
  esac
}

two_nodes() { [ "$(sp_k "$KCTX" get nodes --no-headers 2>/dev/null | wc -l)" -ge 2 ]; }
addon_active() {
  [ "$(aws eks describe-addon --cluster-name "$CLUSTER" --addon-name "$1" --query addon.status --output text 2>/dev/null)" = ACTIVE ]
}

wait_cluster_healthy() {
  local a d
  sp_log "waiting for 2 Ready nodes"
  retry 60 10 two_nodes ||
    sp_die "fewer than 2 nodes after 10 minutes: aws eks list-nodegroups --cluster-name $CLUSTER, then describe-nodegroup --query nodegroup.health"
  sp_k "$KCTX" wait --for=condition=Ready nodes --all --timeout=10m
  [ "$(sp_k "$KCTX" auth can-i '*' '*' --all-namespaces 2>/dev/null)" = yes ] ||
    sp_die "this identity is not cluster-admin: is it the one that ran terraform apply?"
  sp_log "waiting for the 6 add-ons to be ACTIVE"
  for a in $ADDONS; do
    retry 60 10 addon_active "$a" ||
      sp_die "add-on $a is not ACTIVE after 10 minutes: aws eks describe-addon --cluster-name $CLUSTER --addon-name $a"
  done
  for d in coredns ebs-csi-controller metrics-server; do
    sp_k "$KCTX" -n kube-system rollout status "deploy/$d" --timeout=5m
  done
  [ "$(sp_k "$KCTX" get storageclass ebs-csi-default-sc \
    -o jsonpath='{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}' 2>/dev/null)" = true ] ||
    sp_die "ebs-csi-default-sc is not the default StorageClass (aws-ebs-csi-driver configuration)"
  sp_k "$KCTX" wait --for=condition=Available apiservice/v1beta1.metrics.k8s.io --timeout=5m
}

# wait_for_lb: sets LB once the Traefik load balancer answers HTTP the way the cluster's state
# predicts, so it is rerun-safe (B76). Without the stockpilot release, Traefik itself answers /
# with 404; once CI has deployed the app, / is 200 and /api/version returns JSON with git_sha.
wait_for_lb() {
  local host want code _
  host=$(sp_lb_hostname "$KCTX") || exit 1
  if sp_h "$KCTX" -n "$SP_NS_APP" status stockpilot >/dev/null 2>&1; then want="200 and /api/version"; else want=404; fi
  sp_log "waiting for http://$host/ to answer $want (a new Classic LB name takes minutes to resolve)"
  for _ in $(seq 30); do
    code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://$host/" 2>/dev/null) || code=""
    if [ "$want" = 404 ] && [ "$code" = 404 ]; then
      LB=$host
    elif [ "$want" != 404 ] && [ "$code" = 200 ] &&
      curl -fsS --max-time 5 "http://$host/api/version" 2>/dev/null | jq -e '.git_sha | length > 0' >/dev/null 2>&1; then
      LB=$host
    fi
    if [ -n "$LB" ]; then
      sp_log "http://$LB/ answers $want"
      return 0
    fi
    sleep 10
  done
  sp_die "http://$host/ did not answer $want within 5 minutes (last status '${code:-none}')"
}

set_repo_vars() {
  local role
  role=$(terraform -chdir=terraform output -json github_actions_role_arn 2>/dev/null | jq -r '. // empty' || true)
  sp_log "repo variables on $REPO (the LB name changes on every bring-up)"
  gh variable set APP_URL --body "http://$LB" -R "$REPO"
  gh variable set AWS_REGION --body "$AWS_REGION" -R "$REPO"
  gh variable set EKS_CLUSTER_NAME --body "$CLUSTER" -R "$REPO"
  if [ -n "$role" ]; then
    gh variable set AWS_DEPLOY_ROLE_ARN --body "$role" -R "$REPO"
  else
    # enable_github_oidc = false: CI falls back to the AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY secrets.
    sp_log "no GitHub OIDC role in this project: CI deploys with the AWS access-key secrets"
    gh variable delete AWS_DEPLOY_ROLE_ARN -R "$REPO" 2>/dev/null || true
  fi
}

summary() {
  sp_k "$KCTX" get nodes -o wide
  sp_k "$KCTX" get storageclass
  sp_k "$KCTX" get pods -A
  sp_h "$KCTX" list -A
  printf '\n%s\n' "EKS platform ready on context $KCTX. Traefik LB: http://$LB (repo variable APP_URL)"
  printf '%s\n' "Grafana:  kubectl --context $KCTX -n monitoring port-forward svc/kube-prometheus-stack-grafana 13000:80"
  printf '%s\n' "  password: kubectl --context $KCTX -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode"
  printf '%s\n' "Next, your approval gate (CP5b): enable the CI deploy, then merge or dispatch on main:"
  printf '  %s\n' "[ \"\$(gh api user --jq .login)\" = LakshyaBagani ] && gh variable set DEPLOY_ENABLED --body true -R $REPO"
}

guard_identity
kubeconfig
wait_cluster_healthy
sp_namespaces "$KCTX"
sp_secrets "$KCTX"
sp_traefik "$KCTX" eks
wait_for_lb
sp_monitoring "$KCTX" eks
set_repo_vars
summary
