#!/usr/bin/env bash
# make eks-preflight: read-only AWS readiness checks, run before make eks-oidc, eks-plan and eks-up.
#
# Every AWS call is a get, describe or list, and all of them are free (no `aws ce`, which bills
# per request). Commands that would change something appear only in printed fix hints.
# One line per check: PASS|WARN|FAIL  <check>  <detail>, then a summary. Exits 1 if any check FAILs.
#
# Node types (B77), first source wins: node_instance_types in terraform/terraform.tfvars, then the
# env NODE_INSTANCE_TYPES (comma list, exported on the AWS Free plan), then t3a.large,t3.large.
#
# Must run on macOS /bin/bash 3.2: no associative arrays, case-changing expansions or mapfile.
set -euo pipefail

cd "$(dirname "$0")/.."
export AWS_PROFILE=${SP_AWS_PROFILE:-stockpilot} AWS_REGION=${SP_AWS_REGION:-ap-south-1} AWS_PAGER=""
export CHECKPOINT_DISABLE=1 # keeps terraform from phoning home

TFVARS=terraform/terraform.tfvars
BUDGET=stockpilot-monthly-10usd
DEFAULT_NODE_TYPES=t3a.large,t3.large
FREE_TIER_TYPES="t3.micro t3.small t4g.micro t4g.small c7i-flex.large m7i-flex.large"
ADDONS="vpc-cni coredns kube-proxy eks-pod-identity-agent aws-ebs-csi-driver metrics-server"

if [ -t 1 ]; then
  red=$'\033[31m' green=$'\033[32m' yellow=$'\033[33m' bold=$'\033[1m' off=$'\033[0m'
else
  red='' green='' yellow='' bold='' off=''
fi

n_pass=0 n_warn=0 n_fail=0
report() { printf '%s%-4s%s  %-22s  %s\n' "$2" "$1" "$off" "$3" "${4:-}"; } # STATUS COLOUR CHECK DETAIL
pass() { n_pass=$((n_pass + 1)); report PASS "$green" "$@"; }
warn() { n_warn=$((n_warn + 1)); report WARN "$yellow" "$@"; }
fail() { n_fail=$((n_fail + 1)); report FAIL "$red" "$@"; }

have() { command -v "$1" >/dev/null 2>&1; }
first_line() { printf '%s\n' "$1" | sed -n 1p; }
words() { printf '%s' "$1" | tr -s '[:space:]' ' '; } # one line, single spaces

# tfvar NAME: the value of NAME in terraform.tfvars (quotes and comment stripped), or nothing.
tfvar() {
  [ -f "$TFVARS" ] || return 0
  awk -v k="$1" '
    $0 ~ "^[[:space:]]*" k "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      if (match($0, /^"[^"]*"/)) print substr($0, 2, RLENGTH - 2)
      else { sub(/[[:space:]]*(#.*)?$/, ""); print }
      exit
    }' "$TFVARS"
}

# tfvar_list NAME: the quoted items of list NAME in terraform.tfvars, comma-joined. The list may
# span several lines.
tfvar_list() {
  [ -f "$TFVARS" ] || return 0
  awk -v k="$1" '
    !on && $0 ~ "^[[:space:]]*" k "[[:space:]]*=" { on = 1; sub(/^[^=]*=/, "") }
    on {
      line = $0
      sub(/#.*/, "", line)
      while (match(line, /"[^"]*"/)) {
        out = out (out == "" ? "" : ",") substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
      if ($0 ~ /]/) exit
    }
    END { print out }' "$TFVARS"
}

CLUSTER=$(tfvar cluster_name)
CLUSTER=${CLUSTER:-stockpilot-eks}
K8S_VERSION=$(tfvar kubernetes_version)
K8S_VERSION=${K8S_VERSION:-1.36}
ACCOUNT=""

# B77: tfvars, then NODE_INSTANCE_TYPES, then the variables.tf default.
NODE_TYPES=$(tfvar_list node_instance_types)
NODE_TYPES_FROM=terraform.tfvars
if [ -z "$NODE_TYPES" ] && [ -n "${NODE_INSTANCE_TYPES:-}" ]; then
  NODE_TYPES=$(printf '%s' "$NODE_INSTANCE_TYPES" | tr -d '[:space:]') NODE_TYPES_FROM=NODE_INSTANCE_TYPES
fi
if [ -z "$NODE_TYPES" ]; then NODE_TYPES=$DEFAULT_NODE_TYPES NODE_TYPES_FROM=default; fi
NODE_TYPE_LIST=${NODE_TYPES//,/ }

check_config() {
  local region
  if [ ! -f "$TFVARS" ]; then
    warn tfvars "$TFVARS not created yet (TF-11); checking the defaults"
    echo "      fix: cp terraform/terraform.tfvars.example $TFVARS, then fill it in (terraform/README.md section 5)"
  else
    pass tfvars "$TFVARS present"
    region=$(tfvar aws_region)
    if [ -n "$region" ] && [ "$region" != "$AWS_REGION" ]; then
      fail region "aws_region in $TFVARS is $region, but the scripts and the runbook pin $AWS_REGION"
    fi
    # Terraform never reads NODE_INSTANCE_TYPES: once tfvars exists it uses tfvars or the default.
    if [ "$NODE_TYPES_FROM" = NODE_INSTANCE_TYPES ] && [ "$NODE_TYPES" != "$DEFAULT_NODE_TYPES" ]; then
      fail "node types" "NODE_INSTANCE_TYPES=$NODE_TYPES, but $TFVARS has no node_instance_types: Terraform would launch $DEFAULT_NODE_TYPES"
      echo "      fix: add node_instance_types = [\"${NODE_TYPES//,/\", \"}\"] to $TFVARS (B77)"
    fi
  fi
  echo "      cluster $CLUSTER, Kubernetes $K8S_VERSION, node types $NODE_TYPES (from $NODE_TYPES_FROM)"
}

check_tools() {
  local v minor
  if have terraform; then
    v=$(terraform version 2>/dev/null | sed -n '1s/^Terraform v//p')
    case $v in
      1.16.6) pass terraform "$v" ;;
      1.[7-9].* | 1.[1-9][0-9].*) warn terraform "$v, the plan pins 1.16.6" ;;
      *) fail terraform "${v:-unknown}, need >= 1.7 and < 2" ;;
    esac
  else
    fail terraform "not found"
    echo "      fix: brew tap hashicorp/tap && brew install hashicorp/tap/terraform"
  fi

  v=$(aws --version 2>&1 || true)
  case $v in
    aws-cli/2.*) pass aws-cli "$(first_line "${v%% *}")" ;;
    *) fail aws-cli "$(first_line "$v"), need aws-cli v2" ;;
  esac

  if have kubectl; then
    v=$(kubectl version --client 2>/dev/null | sed -n 's/^Client Version: v//p')
    minor=$(printf '%s' "$v" | cut -d. -f2)
    case $minor in
      35 | 36 | 37) pass kubectl "$v" ;;
      *) fail kubectl "${v:-unknown}, need 1.35-1.37 (EKS $K8S_VERSION, one minor of skew)" ;;
    esac
  else
    fail kubectl "not found"
  fi

  if have helm; then
    v=$(helm version --short 2>/dev/null || true)
    case $v in
      v4.*) pass helm "$v" ;;
      *) fail helm "${v:-unknown}, need v4 (--rollback-on-failure)" ;;
    esac
  else
    fail helm "not found"
  fi

  for v in jq openssl; do
    if have "$v"; then pass "$v" "present"; else fail "$v" "not found (eks-bootstrap needs it)"; fi
  done
}

check_gh() {
  local login
  if ! have gh; then
    warn "gh login" "gh not found; eks-bootstrap and eks-down need it"
    return
  fi
  login=$(gh api user --jq .login 2>/dev/null || true)
  if [ "$login" = LakshyaBagani ]; then
    pass "gh login" "$login"
  else
    fail "gh login" "active account is ${login:-none}, want LakshyaBagani"
    echo "      fix: gh auth switch -h github.com -u LakshyaBagani"
  fi
}

# check_identity: returns 1 when there is no usable session, so main skips the AWS checks.
check_identity() {
  local out arn want
  if ! out=$(aws sts get-caller-identity --query '[Account,Arn]' --output text 2>&1); then
    fail identity "no valid session for profile $AWS_PROFILE: $(first_line "$out")"
    echo "      fix: aws sso login --profile $AWS_PROFILE"
    return 1
  fi
  ACCOUNT=${out%%[[:space:]]*}
  arn=${out##*[[:space:]]}
  # The account id is never printed: it stays in the git-ignored terraform.tfvars.
  case $arn in
    *:root)
      fail identity "signed in as the root user"
      echo "      fix: use the IAM Identity Center or IAM user from TF-01"
      return 1
      ;;
  esac
  want=$(tfvar aws_account_id)
  if [ -z "$want" ]; then
    pass identity "${arn#*:*:*:*:*:}; no aws_account_id in tfvars yet"
  elif [ "$want" = "$ACCOUNT" ]; then
    pass identity "${arn#*:*:*:*:*:}; the account matches aws_account_id"
  else
    fail identity "the signed-in account is not aws_account_id in $TFVARS"
    echo "      fix: sign in to the right account, or correct aws_account_id"
    return 1
  fi
}

check_version() {
  local out
  if ! out=$(aws eks describe-cluster-versions \
    --query "clusterVersions[?clusterVersion=='$K8S_VERSION'].[versionStatus,status]" --output text 2>&1); then
    fail "EKS $K8S_VERSION" "describe-cluster-versions failed: $(first_line "$out")"
    return
  fi
  case $out in
    *STANDARD_SUPPORT* | *standard-support*) pass "EKS $K8S_VERSION" "standard support" ;;
    *)
      fail "EKS $K8S_VERSION" "not in standard support (${out:-not listed}); extended support bills \$0.60/h"
      echo "      fix: aws eks describe-cluster-versions, then set kubernetes_version to a standard-support version"
      ;;
  esac
}

check_addons() {
  local out a missing=""
  if ! out=$(aws eks describe-addon-versions --kubernetes-version "$K8S_VERSION" \
    --query 'addons[].addonName' --output text 2>&1); then
    fail add-ons "describe-addon-versions failed: $(first_line "$out")"
    return
  fi
  out=" $(words "$out") "
  for a in $ADDONS; do
    case $out in *" $a "*) ;; *) missing="$missing $a" ;; esac
  done
  if [ -z "$missing" ]; then
    pass add-ons "all 6 available for $K8S_VERSION"
  else
    fail add-ons "not available for $K8S_VERSION:$missing"
  fi
}

check_offerings() {
  local azs az t out first offered
  if ! azs=$(aws ec2 describe-availability-zones \
    --filters Name=opt-in-status,Values=opt-in-not-required Name=state,Values=available \
    --query 'AvailabilityZones[].ZoneName' --output text 2>&1); then
    fail offerings "describe-availability-zones failed: $(first_line "$azs")"
    return
  fi
  # The same two AZs as main.tf: opt-in-not-required, available, sorted, first two.
  azs=$(printf '%s' "$azs" | tr -s '[:space:]' '\n' | sort | head -n 2)
  for az in $azs; do
    first="" offered=""
    for t in $NODE_TYPE_LIST; do
      [ -n "$first" ] || first=$t
      if ! out=$(aws ec2 describe-instance-type-offerings --location-type availability-zone \
        --filters "Name=location,Values=$az" "Name=instance-type,Values=$t" \
        --query 'InstanceTypeOfferings[].InstanceType' --output text 2>&1); then
        fail "offerings $az" "describe-instance-type-offerings failed: $(first_line "$out")"
        continue 2
      fi
      case $out in *"$t"*) offered="$offered $t" ;; esac
    done
    if [ -z "$offered" ]; then
      fail "offerings $az" "none of $NODE_TYPES is offered"
      continue
    fi
    case "$offered " in
      *" $first "*) pass "offerings $az" "offered:$offered" ;;
      *) warn "offerings $az" "$first is not offered; the node group falls back to$offered" ;;
    esac
  done
}

check_quota() {
  local q
  if ! q=$(aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A \
    --query Quota.Value --output text 2>&1); then
    fail "vCPU quota" "get-service-quota failed: $(first_line "$q")"
    return
  fi
  if awk -v q="$q" 'BEGIN { exit !(q + 0 >= 8) }'; then
    pass "vCPU quota" "$q on-demand standard vCPUs (L-1216C47A), need 8"
  else
    fail "vCPU quota" "$q on-demand standard vCPUs (L-1216C47A), need 8"
    echo "      fix: aws service-quotas request-service-quota-increase --service-code ec2 --quota-code L-1216C47A --desired-value 16"
  fi
}

check_budget() {
  local out amount unit credit n
  if ! out=$(aws budgets describe-budget --region us-east-1 --account-id "$ACCOUNT" --budget-name "$BUDGET" \
    --query 'Budget.[BudgetLimit.Amount,BudgetLimit.Unit,CostTypes.IncludeCredit]' --output text 2>&1); then
    fail budget "$BUDGET not found: $(first_line "$out")"
    echo "      fix: create it from terraform/README.md section 4 (TF-03)"
    return
  fi
  read -r amount unit credit <<<"$out"
  if ! n=$(aws budgets describe-notifications-for-budget --region us-east-1 --account-id "$ACCOUNT" \
    --budget-name "$BUDGET" --query 'Notifications[].NotificationType' --output text 2>&1); then
    fail budget "describe-notifications-for-budget failed: $(first_line "$n")"
    return
  fi
  n=$(printf '%s' "$n" | wc -w | tr -d ' ')
  if awk -v a="$amount" 'BEGIN { exit !(a + 0 == 10) }' && [ "$unit" = USD ] &&
    { [ "$credit" = False ] || [ "$credit" = false ]; } && [ "$n" = 3 ]; then
    pass budget "$BUDGET: 10 USD, IncludeCredit false, 3 notifications"
  else
    fail budget "$BUDGET: $amount $unit, IncludeCredit $credit, $n notifications; want 10 USD, false, 3"
    echo "      fix: recreate it from terraform/README.md section 4 (TF-03)"
  fi
}

check_plan_type() {
  local out t bad=""
  if ! out=$(aws freetier get-account-plan-state --region us-east-1 \
    --query '[accountPlanType,accountPlanStatus]' --output text 2>&1); then
    warn "plan type" "not available ($(first_line "$out")); check Billing > Free Tier in the console"
    return
  fi
  case $out in
    FREE*)
      for t in $NODE_TYPE_LIST; do
        case " $FREE_TIER_TYPES " in *" $t "*) ;; *) bad="$bad $t" ;; esac
      done
      if [ -n "$bad" ]; then
        fail "plan type" "Free plan rejects$bad: the node group would sit in CREATING while the control plane bills"
        echo "      fix: upgrade to the Paid plan, or export NODE_INSTANCE_TYPES=m7i-flex.large and copy it into $TFVARS (B77)"
      else
        pass "plan type" "Free plan; $NODE_TYPES is free-tier eligible"
      fi
      ;;
    PAID*) pass "plan type" "Paid plan" ;;
    *) warn "plan type" "$(words "$out"); check Billing > Free Tier in the console" ;;
  esac
}

# in_state ADDRESS: true when Terraform already manages ADDRESS (then it is ours, not a collision).
in_state() { printf '%s\n' "$TF_STATE" | grep -qxF "$1"; }

check_collisions() {
  local out
  TF_STATE=$(terraform -chdir=terraform state list 2>/dev/null) || TF_STATE=""

  if in_state 'module.eks.aws_eks_cluster.this[0]'; then
    pass "cluster name" "$CLUSTER is in the Terraform state"
  elif out=$(aws eks describe-cluster --name "$CLUSTER" --query cluster.status --output text 2>&1); then
    fail "cluster name" "EKS cluster $CLUSTER already exists ($out) but is not in the Terraform state"
  else
    case $out in
      *ResourceNotFoundException*) pass "cluster name" "$CLUSTER is free" ;;
      *) fail "cluster name" "describe-cluster failed: $(first_line "$out")" ;;
    esac
  fi

  if ! out=$(aws logs describe-log-groups --log-group-name-prefix "/aws/eks/$CLUSTER/cluster" \
    --query 'logGroups[].logGroupName' --output text 2>&1); then
    fail "log group" "describe-log-groups failed: $(first_line "$out")"
  elif [ -n "$out" ] && [ "$out" != None ]; then
    fail "log group" "/aws/eks/$CLUSTER/cluster exists, left by an earlier run"
    echo "      fix: aws logs delete-log-group --log-group-name /aws/eks/$CLUSTER/cluster"
  else
    pass "log group" "no /aws/eks/$CLUSTER/cluster"
  fi

  if in_state 'module.eks.module.kms.aws_kms_alias.this["cluster"]'; then
    pass "KMS alias" "alias/eks/$CLUSTER is in the Terraform state"
  elif ! out=$(aws kms list-aliases --query "Aliases[?AliasName=='alias/eks/$CLUSTER'].AliasName" --output text 2>&1); then
    fail "KMS alias" "list-aliases failed: $(first_line "$out")"
  elif [ -n "$out" ] && [ "$out" != None ]; then
    fail "KMS alias" "alias/eks/$CLUSTER exists, left by a partial run"
    echo "      fix: aws kms delete-alias --alias-name alias/eks/$CLUSTER"
  else
    pass "KMS alias" "no alias/eks/$CLUSTER"
  fi

  if [ "$(tfvar create_github_oidc_provider)" = false ]; then
    pass "OIDC provider" "create_github_oidc_provider = false: the existing provider is reused"
  elif in_state 'aws_iam_openid_connect_provider.github[0]'; then
    pass "OIDC provider" "in the Terraform state (make eks-oidc created it)"
  elif ! out=$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text 2>&1); then
    fail "OIDC provider" "list-open-id-connect-providers failed: $(first_line "$out")"
  else
    case $out in
      *token.actions.githubusercontent.com*)
        fail "OIDC provider" "token.actions.githubusercontent.com exists, but create_github_oidc_provider is true"
        echo "      fix: set create_github_oidc_provider = false in $TFVARS"
        ;;
      *) pass "OIDC provider" "none yet; Terraform creates it" ;;
    esac
  fi

  if ! out=$(aws guardduty list-detectors --query DetectorIds --output text 2>&1); then
    warn GuardDuty "list-detectors failed: $(first_line "$out")"
  elif [ -n "$out" ] && [ "$out" != None ]; then
    warn GuardDuty "a detector is on: runtime monitoring can add a VPC endpoint that blocks destroy (make eks-down prints the fix)"
  else
    pass GuardDuty "no detector"
  fi
}

printf '%spreflight%s for profile %s, region %s\n' "$bold" "$off" "$AWS_PROFILE" "$AWS_REGION"
check_config
check_tools
check_gh
if check_identity; then
  check_version
  check_addons
  check_offerings
  check_quota
  check_budget
  check_plan_type
  check_collisions
else
  echo "      (skipped the other AWS checks: they need a valid session)"
fi

printf '%spreflight:%s %d pass, %d warn, %d fail\n' "$bold" "$off" "$n_pass" "$n_warn" "$n_fail"
[ "$n_fail" -eq 0 ]
