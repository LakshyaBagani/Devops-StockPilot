#!/usr/bin/env bash
# make leftovers: "am I still paying?" A read-only sweep of every enabled region; it never deletes.
#
# One row per region, one column per kind of leftover that bills or blocks the next apply:
# '-' is none, a number is a count, ERR is a failed API call. Exits 0 with 'leftovers: none' when
# every cell is '-', otherwise lists the cells to look at and exits 1.
#
# Must run on macOS /bin/bash 3.2. No set -e: an API error in one region must not stop the sweep.
set -uo pipefail

export AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 AWS_PAGER="" AWS_DEFAULT_OUTPUT=text

# Column order of the report; count() has one query per column.
KINDS="eks ec2 nat eip elb elbv2 ebs snap vpc logs kms"

# count REGION KIND: prints how many KIND exist in REGION.
count() {
  local r=$1
  case $2 in
    eks) aws eks list-clusters --region "$r" --query 'length(clusters)' ;;
    ec2)
      aws ec2 describe-instances --region "$r" \
        --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
        --query 'length(Reservations[].Instances[])'
      ;;
    nat) aws ec2 describe-nat-gateways --region "$r" --filter Name=state,Values=pending,available --query 'length(NatGateways)' ;;
    eip) aws ec2 describe-addresses --region "$r" --query 'length(Addresses)' ;;
    elb) aws elb describe-load-balancers --region "$r" --query 'length(LoadBalancerDescriptions)' ;;
    elbv2) aws elbv2 describe-load-balancers --region "$r" --query 'length(LoadBalancers)' ;;
    ebs) aws ec2 describe-volumes --region "$r" --filters Name=status,Values=available --query 'length(Volumes)' ;;
    snap) aws ec2 describe-snapshots --region "$r" --owner-ids self --query 'length(Snapshots)' ;;
    vpc) aws ec2 describe-vpcs --region "$r" --filters Name=is-default,Values=false --query 'length(Vpcs)' ;;
    logs) aws logs describe-log-groups --region "$r" --log-group-name-prefix /aws/eks/ --query 'length(logGroups)' ;;
    kms) aws kms list-aliases --region "$r" --query "length(Aliases[?starts_with(AliasName, 'alias/eks/')])" ;;
  esac
}

# sweep_region REGION OUTDIR: writes the region's row of cells to OUTDIR/REGION.
sweep_region() {
  local r=$1 k n row=""
  for k in $KINDS; do
    n=$(count "$r" "$k" 2>/dev/null) || n=ERR
    case $n in
      0) n=- ;;
      '' | *[!0-9]*) n=ERR ;;
    esac
    row="$row $n"
  done
  printf '%s\n' "${row# }" >"$2/$r"
}

# global_info: IAM is global and free; its leftovers are expected between make eks-oidc and the
# final make eks-down, so they are INFO lines, never failures.
global_info() {
  if aws iam get-role --role-name stockpilot-gha-deploy >/dev/null 2>&1; then
    echo "INFO  IAM role stockpilot-gha-deploy exists (free; make eks-down destroys it)"
  fi
  case $(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' 2>/dev/null) in
    *token.actions.githubusercontent.com*)
      echo "INFO  the GitHub OIDC provider exists (free; destroyed with the role unless it pre-existed)"
      ;;
  esac
}

# report REGIONS OUTDIR: the table, then the verdict; fails when any cell is not '-'.
report() {
  local regions=$1 dir=$2 r k i found="" cells
  printf '%-15s' region
  for k in $KINDS; do printf ' %5s' "$k"; done
  echo
  for r in $regions; do
    cells=()
    if [ -s "$dir/$r" ]; then read -r -a cells <"$dir/$r"; fi
    printf '%-15s' "$r"
    i=0
    for k in $KINDS; do
      printf ' %5s' "${cells[$i]:-ERR}"
      [ "${cells[$i]:-ERR}" = - ] || found="$found $r:$k=${cells[$i]:-ERR}"
      i=$((i + 1))
    done
    echo
  done
  if [ -z "$found" ]; then
    echo "leftovers: none"
    return 0
  fi
  echo "leftovers:$found"
  echo "  ERR means the call failed (aws sso login --profile $AWS_PROFILE?); look at each listed cell in the console."
  return 1
}

regions=$(aws ec2 describe-regions --query 'Regions[].RegionName' 2>&1) || {
  printf 'describe-regions failed: %s\n' "$regions" >&2
  echo "fix: aws sso login --profile $AWS_PROFILE" >&2
  exit 1
}
regions=$(printf '%s' "$regions" | tr -s '[:space:]' '\n' | sort)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

echo "Sweeping $(printf '%s\n' "$regions" | wc -l | tr -d ' ') regions for profile $AWS_PROFILE (read-only)..."
for r in $regions; do
  sweep_region "$r" "$dir" &
done
wait
global_info
report "$regions" "$dir"
