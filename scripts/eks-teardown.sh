#!/usr/bin/env bash
# make eks-down: the ordered EKS teardown. You run it in your own terminal: terraform destroy asks
# you to type yes, and --clean-orphans asks you to type CLEAN.
#
#   identity checks -> DEPLOY_ENABLED=false (the first change it makes) -> wait until CI is idle
#   -> uninstall in order: lab namespace, load generator, app + its PVCs, monitoring, the ALB
#      controller (only once its load balancers are gone), Traefik (which owns the Classic LB)
#   -> wait until the AWS-side gates are empty: load balancers, target groups, k8s-* security
#      groups and EBS CSI volumes, which Kubernetes created and Terraform does not know about
#   -> terraform destroy -> the all-region leftover sweep
#
# Usage: scripts/eks-teardown.sh [--skip-k8s] [--check-only] [--clean-orphans]
#   --skip-k8s       the Kubernetes API is unreachable or the cluster is gone: no uninstalls, and
#                    leftover EBS volumes are reported instead of blocking (delete them after destroy)
#   --check-only     the AWS-side gates once, read-only: exit 0 when all are empty, else 1
#   --clean-orphans  when a gate stays non-empty or destroy fails, delete this VPC's leftover load
#                    balancers, target groups, available ENIs and k8s-* security groups (after you
#                    type CLEAN), then destroy again
#
# Must run on macOS /bin/bash 3.2.
set -euo pipefail

cd "$(dirname "$0")/.."
export AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 AWS_PAGER=""
export CHECKPOINT_DISABLE=1 # keeps terraform from phoning home
# shellcheck source=scripts/lib/platform.sh
. scripts/lib/platform.sh

REPO=LakshyaBagani/Devops-StockPilot
RELEASE=stockpilot
TFVARS=terraform/terraform.tfvars
SKIP_K8S=0 CHECK_ONLY=0 CLEAN_ORPHANS=0

usage() { sed -n '/^# Usage:/,/^# Must/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

for arg in "$@"; do
  case $arg in
    --skip-k8s) SKIP_K8S=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    --clean-orphans) CLEAN_ORPHANS=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

# tfvar NAME: the quoted value of NAME in terraform.tfvars, or nothing.
tfvar() {
  [ -f "$TFVARS" ] || return 0
  sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"([^\"]*)\".*/\1/p" "$TFVARS" | sed -n 1p
}

tf_out() { terraform -chdir=terraform output -raw "$1" 2>/dev/null || true; }

CLUSTER=$(tf_out cluster_name)
CLUSTER=${CLUSTER:-$(tfvar cluster_name)}
CLUSTER=${CLUSTER:-stockpilot-eks}
KCTX=$CLUSTER # the --alias that configure_kubectl gives the context
VPC=$(tf_out vpc_id)

guard_account() {
  local account want
  account=$(aws sts get-caller-identity --query Account --output text) ||
    sp_die "no AWS session for profile $AWS_PROFILE: aws sso login --profile $AWS_PROFILE"
  want=$(tfvar aws_account_id)
  if [ -n "$want" ]; then
    [ "$account" = "$want" ] || sp_die "the signed-in AWS account is not aws_account_id in $TFVARS"
  elif [ "$CHECK_ONLY" = 1 ]; then
    sp_log "no aws_account_id in $TFVARS: checking the account that profile $AWS_PROFILE signs in to"
  else
    sp_die "$TFVARS has no aws_account_id, and terraform destroy needs it (terraform/README.md section 5)"
  fi
}

guard_gh() {
  local login
  login=$(gh api user --jq .login 2>/dev/null || true)
  [ "$login" = LakshyaBagani ] ||
    sp_die "gh is logged in as '${login:-nobody}', but CI deploys must be switched off first: gh auth switch -h github.com -u LakshyaBagani"
}

# resolve_vpc: the VPC id from the state, else by its Name tag (a partial destroy can drop the
# output). Empty when no VPC exists: the gates then cover the whole region.
resolve_vpc() {
  local project
  if [ -z "$VPC" ]; then
    project=$(tfvar project_name)
    VPC=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=${project:-stockpilot}-vpc" \
      --query 'Vpcs[0].VpcId' --output text) || sp_die "describe-vpcs failed"
  fi
  case $VPC in
    vpc-*) sp_log "VPC $VPC" ;;
    *)
      VPC=""
      sp_log "no stockpilot VPC found: the gates cover the whole region $AWS_REGION"
      ;;
  esac
}

disable_deploys() {
  sp_log "DEPLOY_ENABLED=false on $REPO: no CI deploy may recreate what this teardown removes"
  gh variable set DEPLOY_ENABLED --body false -R "$REPO"
}

ci_busy() {
  gh run list -R "$REPO" --workflow ci-cd.yml --json status --jq '[.[] | select(.status != "completed")] | length'
}

wait_ci_idle() {
  local i n
  for i in $(seq 80); do # 80 x 15 s = 20 min
    n=$(ci_busy) || sp_die "gh run list failed"
    if [ "$n" = 0 ]; then
      sp_log "no ci-cd.yml run is queued or in progress"
      return 0
    fi
    [ "$i" -gt 1 ] || sp_log "$n ci-cd.yml run(s) not finished; waiting up to 20 minutes, since a deploy would recreate the app"
    sleep 15
  done
  sp_die "ci-cd.yml runs still not finished after 20 minutes: gh run list -R $REPO --workflow ci-cd.yml"
}

# Names of the PVs still bound to a claim in the app namespace.
app_pvs() {
  sp_k "$KCTX" get pv -o json | jq -r --arg ns "$SP_NS_APP" '.items[] | select(.spec.claimRef.namespace == $ns) | .metadata.name'
}

wait_pvs_released() {
  local pvs _
  for _ in $(seq 30); do # 30 x 10 s = 5 min
    pvs=$(app_pvs)
    if [ -z "$pvs" ]; then
      sp_log "no PV is left for $SP_NS_APP: the EBS CSI driver deleted the volumes"
      return 0
    fi
    sleep 10
  done
  sp_die "PVs of $SP_NS_APP still present after 5 minutes: $(printf '%s' "$pvs" | tr '\n' ' ')"
}

elbv2_in_vpc() {
  aws elbv2 describe-load-balancers --query "LoadBalancers[?VpcId=='$VPC'].LoadBalancerName" --output text
}

wait_albs_gone() {
  local albs _
  [ -n "$VPC" ] || sp_die "the ALB controller is installed but the VPC id is unknown; cannot wait for its load balancers"
  for _ in $(seq 40); do # 40 x 15 s = 10 min
    albs=$(elbv2_in_vpc)
    [ -n "$albs" ] || return 0
    sleep 15
  done
  sp_die "elbv2 load balancers still in $VPC after 10 minutes: $albs"
}

uninstall_k8s() {
  local svcs pvcs
  sp_log "kube context $KCTX"
  aws eks update-kubeconfig --region "$AWS_REGION" --name "$CLUSTER" --alias "$KCTX" >/dev/null ||
    sp_die "cannot reach cluster $CLUSTER; if it is already gone, re-run with --skip-k8s"

  sp_log "lab namespace and load generator"
  sp_k "$KCTX" delete namespace stockpilot-lab --ignore-not-found --wait
  if [ -f k8s/loadgen.yaml ]; then sp_k "$KCTX" delete -f k8s/loadgen.yaml --ignore-not-found --wait; fi

  sp_log "release $RELEASE: its Ingress, Services and pods"
  sp_h "$KCTX" uninstall "$RELEASE" -n "$SP_NS_APP" --ignore-not-found --wait --cascade foreground --timeout 10m
  # StatefulSet PVCs outlive the release, and their EBS volumes bill until deleted. The CSI driver
  # deletes the volumes only while the cluster still runs it.
  sp_log "PVCs in $SP_NS_APP"
  sp_k "$KCTX" -n "$SP_NS_APP" delete pvc --all --wait --timeout=5m
  wait_pvs_released

  sp_log "kube-prometheus-stack"
  sp_h "$KCTX" uninstall kube-prometheus-stack -n "$SP_NS_MON" --ignore-not-found --wait --cascade foreground --timeout 10m

  # The controller deletes the ALBs it created only while it runs.
  if sp_h "$KCTX" -n kube-system status aws-load-balancer-controller >/dev/null 2>&1; then
    sp_log "ALB controller: waiting until its load balancers are gone, then uninstalling it"
    wait_albs_gone
    sp_h "$KCTX" uninstall aws-load-balancer-controller -n kube-system --wait --timeout 5m
  fi

  sp_log "Traefik: its LoadBalancer Service owns the Classic LB"
  sp_h "$KCTX" uninstall traefik -n "$SP_NS_INGRESS" --ignore-not-found --wait --cascade foreground --timeout 10m

  svcs=$(sp_k "$KCTX" get svc -A -o json |
    jq -r '.items[] | select(.spec.type == "LoadBalancer") | "  service \(.metadata.namespace)/\(.metadata.name)"') ||
    sp_die "cannot list the Services"
  pvcs=$(sp_k "$KCTX" get pvc -A -o json | jq -r '.items[] | "  pvc \(.metadata.namespace)/\(.metadata.name)"') ||
    sp_die "cannot list the PVCs"
  if [ -n "$svcs$pvcs" ]; then
    printf '%s\n' "$svcs" "$pvcs" | sed '/^$/d' >&2
    sp_die "these are still in the cluster, and AWS would keep billing for them"
  fi
}

# The AWS-side gates. Each prints what is left (nothing when the gate is empty) and fails on an API
# error. They look only inside the VPC when its id is known, else across the region.
in_vpc() { if [ -n "$VPC" ]; then printf "[?%s=='%s']" "$1" "$VPC"; else printf '[]'; fi; }

gate_label() {
  case $1 in
    clb) echo "Classic load balancers" ;;
    elbv2) echo "elbv2 load balancers" ;;
    tg) echo "elbv2 target groups" ;;
    sg) echo "k8s-* security groups" ;;
    ebs) echo "EBS CSI volumes" ;;
  esac
}

gate() {
  case $1 in
    clb) aws elb describe-load-balancers --query "LoadBalancerDescriptions$(in_vpc VPCId).LoadBalancerName" --output text ;;
    elbv2) aws elbv2 describe-load-balancers --query "LoadBalancers$(in_vpc VpcId).LoadBalancerName" --output text ;;
    tg) aws elbv2 describe-target-groups --query "TargetGroups$(in_vpc VpcId).TargetGroupName" --output text ;;
    sg)
      aws ec2 describe-security-groups --filters ${VPC:+"Name=vpc-id,Values=$VPC"} 'Name=group-name,Values=k8s-*' \
        --query 'SecurityGroups[].GroupName' --output text
      ;;
    ebs)
      aws ec2 describe-volumes --filters Name=tag:ebs.csi.aws.com/cluster,Values=true \
        --query 'Volumes[].[VolumeId,State]' --output text
      ;;
  esac
}

# aws_gates_empty: one line per gate; true only when every blocking gate is empty. With --skip-k8s,
# leftover volumes are reported but do not block: they are still attached to the nodes.
aws_gates_empty() {
  local g out busy=0
  for g in clb elbv2 tg sg ebs; do
    if ! out=$(gate "$g" 2>/dev/null); then
      printf '  %-24s ERROR %s\n' "$(gate_label "$g")" "$(gate "$g" 2>&1 >/dev/null | sed -n 1p)"
      busy=1
    elif [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
      printf '  %-24s empty\n' "$(gate_label "$g")"
    elif [ "$g" = ebs ] && [ "$SKIP_K8S" = 1 ]; then
      printf '  %-24s %s (not blocking with --skip-k8s; delete them after destroy)\n' "$(gate_label "$g")" "$(printf '%s' "$out" | tr -s '[:space:]' ' ')"
    else
      printf '  %-24s %s\n' "$(gate_label "$g")" "$(printf '%s' "$out" | tr -s '[:space:]' ' ')"
      busy=1
    fi
  done
  return "$busy"
}

# wait_aws_gates: polls every 15 s for up to 10 minutes; prints the gates whenever they change.
wait_aws_gates() {
  local i out last=""
  sp_log "waiting for the AWS-side gates to empty (${VPC:-the whole region})"
  for i in $(seq 40); do
    if out=$(aws_gates_empty); then
      printf '%s\n' "$out"
      return 0
    fi
    if [ "$out" != "$last" ]; then
      printf '%s\n' "$out"
      last=$out
    fi
    [ "$i" -eq 40 ] || sleep 15
  done
  sp_log "the AWS-side gates are still not empty after 10 minutes"
  return 1
}

destroy() {
  terraform -chdir=terraform init -input=false >/dev/null || sp_die "terraform init failed"
  sp_log "terraform destroy: review the plan, then type yes."
  sp_log "Expect 'Destroy complete! Resources: 65 destroyed.' (64 when the GitHub OIDC provider pre-existed); screenshot it as docs/evidence/m7-04-destroy.png"
  terraform -chdir=terraform destroy -input=false
}

diagnose_vpc() {
  [ -n "$VPC" ] || return 0
  printf '\n%s\n' "terraform destroy did not finish. Unless you cancelled it, one of these blocks VPC $VPC:"
  echo "ENIs (an 'available' one blocks its subnet and security groups):"
  aws ec2 describe-network-interfaces --filters "Name=vpc-id,Values=$VPC" \
    --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,InterfaceType,Description]' --output table || true
  echo "Security groups other than default (k8s-* ones come from Kubernetes load balancers):"
  aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" \
    --query "SecurityGroups[?GroupName!='default'].[GroupId,GroupName]" --output table || true
  echo "VPC endpoints (GuardDuty runtime monitoring adds a guardduty-data one that blocks deletion):"
  aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$VPC" \
    --query 'VpcEndpoints[].[VpcEndpointId,ServiceName,State]' --output table || true
  cat <<EOF
Fix, then run make eks-down again:
  scripts/eks-teardown.sh --skip-k8s --clean-orphans
      deletes this VPC's load balancers, target groups, available ENIs and k8s-* security groups,
      after you type CLEAN, then destroys again
  aws ec2 delete-vpc-endpoints --vpc-endpoint-ids <vpce-id>
      a GuardDuty endpoint; first turn off GuardDuty's automated agent for EKS, or it comes back
  aws ec2 describe-security-group-rules --filters Name=group-id,Values=<sg-referencing-it> --query 'SecurityGroupRules[?ReferencedGroupInfo.GroupId==\`<sg>\`].SecurityGroupRuleId'
  aws ec2 revoke-security-group-ingress --group-id <sg-referencing-it> --security-group-rule-ids <sgr-id>
  aws ec2 delete-security-group --group-id <sg>
EOF
}

# revoke_refs SG: revokes the rules of this VPC's security groups that reference SG, which would
# otherwise block deleting it.
revoke_refs() {
  local sg=$1 groups group rule egress
  groups=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" --query 'SecurityGroups[].GroupId' --output text)
  aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$(printf '%s' "$groups" | tr -s '[:space:]' ',')" \
    --query "SecurityGroupRules[?ReferencedGroupInfo.GroupId=='$sg'].[GroupId,SecurityGroupRuleId,IsEgress]" --output text |
    while read -r group rule egress; do
      [ -n "$rule" ] || continue
      if [ "$egress" = True ]; then
        try aws ec2 revoke-security-group-egress --group-id "$group" --security-group-rule-ids "$rule"
      else
        try aws ec2 revoke-security-group-ingress --group-id "$group" --security-group-rule-ids "$rule"
      fi
    done
}

# try CMD...: runs CMD quietly and logs the outcome; a failure is reported, never fatal.
try() {
  if "$@" >/dev/null; then sp_log "done: ${*:2}"; else sp_log "WARN: failed: $*"; fi
}

# clean_orphans: deletes only what Kubernetes left inside this VPC; Terraform creates none of it.
clean_orphans() {
  local clbs albs tgs enis sgs x a _
  [ -n "$VPC" ] || sp_die "--clean-orphans works only inside the stockpilot VPC, and none was found"
  clbs=$(aws elb describe-load-balancers --query "LoadBalancerDescriptions[?VPCId=='$VPC'].LoadBalancerName" --output text)
  albs=$(aws elbv2 describe-load-balancers --query "LoadBalancers[?VpcId=='$VPC'].LoadBalancerArn" --output text)
  tgs=$(aws elbv2 describe-target-groups --query "TargetGroups[?VpcId=='$VPC'].TargetGroupArn" --output text)
  enis=$(aws ec2 describe-network-interfaces --filters "Name=vpc-id,Values=$VPC" Name=status,Values=available \
    --query 'NetworkInterfaces[].NetworkInterfaceId' --output text)
  sgs=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC" 'Name=group-name,Values=k8s-*' \
    --query 'SecurityGroups[].GroupId' --output text)
  if [ -z "$(printf '%s' "$clbs$albs$tgs$enis$sgs" | tr -d '[:space:]')" ]; then
    sp_log "no orphaned load balancer, target group, available ENI or k8s-* security group in $VPC"
    return 0
  fi
  printf '%s\n' "Orphans in $VPC:"
  for x in $clbs; do echo "  Classic LB      $x"; done
  for x in $albs; do echo "  elbv2 LB        $x"; done
  for x in $tgs; do echo "  target group    $x"; done
  for x in $enis; do echo "  available ENI   $x"; done
  for x in $sgs; do echo "  security group  $x"; done
  read -r -p 'Type CLEAN to delete all of them: ' a || a=""
  [ "$a" = CLEAN ] || sp_die "nothing deleted"

  for x in $clbs; do try aws elb delete-load-balancer --load-balancer-name "$x"; done
  for x in $albs; do try aws elbv2 delete-load-balancer --load-balancer-arn "$x"; done
  # shellcheck disable=SC2086 # one argument per ARN
  [ -z "$albs" ] || try aws elbv2 wait load-balancers-deleted --load-balancer-arns $albs
  for x in $tgs; do try aws elbv2 delete-target-group --target-group-arn "$x"; done
  for x in $enis; do try aws ec2 delete-network-interface --network-interface-id "$x"; done
  for x in $sgs; do
    revoke_refs "$x"
    # A deleted load balancer releases its ENIs, and with them the group, a minute or two later.
    for _ in $(seq 12); do
      if aws ec2 delete-security-group --group-id "$x" >/dev/null 2>&1; then
        sp_log "deleted security group $x"
        continue 2
      fi
      sleep 10
    done
    sp_log "WARN: could not delete security group $x: aws ec2 delete-security-group --group-id $x"
  done
}

offer_delete_context() {
  local a
  kubectl config get-contexts "$KCTX" >/dev/null 2>&1 || return 0
  read -r -p "Delete the kube context $KCTX as well? [y/N] " a || a=""
  case $a in y | Y) kubectl config delete-context "$KCTX" ;; esac
}

if [ "$CHECK_ONLY" = 1 ]; then
  guard_account
  resolve_vpc
  if aws_gates_empty; then
    echo "gates: all empty"
    exit 0
  fi
  echo "gates: not empty"
  exit 1
fi

[ -t 0 ] || sp_die "make eks-down must be run by a human in a terminal: terraform destroy asks you to type yes"
guard_account
guard_gh
resolve_vpc
disable_deploys
wait_ci_idle
if [ "$SKIP_K8S" = 1 ]; then sp_log "--skip-k8s: no Kubernetes uninstalls"; else uninstall_k8s; fi

if [ "$CLEAN_ORPHANS" = 1 ]; then
  # You asked for the cleanup: check once, clean what is left, then wait for the deletions.
  sp_log "AWS-side gates (${VPC:-the whole region})"
  if ! aws_gates_empty; then
    clean_orphans
    wait_aws_gates || sp_die "the AWS-side gates are still not empty; see terraform/README.md section 10"
  fi
else
  wait_aws_gates ||
    sp_die "fix the leftovers above, or clean them: scripts/eks-teardown.sh --skip-k8s --clean-orphans"
fi

if ! destroy; then
  diagnose_vpc
  [ "$CLEAN_ORPHANS" = 1 ] || exit 1
  clean_orphans
  destroy || {
    diagnose_vpc
    exit 1
  }
fi

sp_log "all-region leftover sweep"
status=0
scripts/aws-leftovers.sh || status=$?
offer_delete_context
echo "Tomorrow: check Cost Explorer by service and the budget; the session should cost about its uptime x \$0.30/h."
exit "$status"
