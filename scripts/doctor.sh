#!/usr/bin/env bash
# make doctor: tool versions, GitHub/AWS identity, ignore rules and port hygiene.
# make digests: pinned image digests against their registry tags.
#
# Usage: scripts/doctor.sh [all|tools|identity|repo|ports|digests] [--offline]
#   all (the default) runs tools, identity, repo and ports; digests runs on its own.
#   --offline turns the network checks (gh, ssh, aws, registry) into SKIP.
# One line per check: PASS|WARN|FAIL|SKIP  <check>  <detail>  [fix: <command>], then a summary.
# INFO lines are notes that are never counted. Exits 1 if, and only if, a check FAILs.
#
# Must run on macOS /bin/bash 3.2, so no bash 4 features: no associative arrays, case-changing
# expansions, array-loading builtins or the stderr pipe/append shorthands.
set -euo pipefail

cd "$(dirname "$0")/.."
export CHECKPOINT_DISABLE=1 # keeps `terraform version` from phoning home

GH_OWNER=LakshyaBagani
GH_REPO=Devops-StockPilot
AWS_PROFILE_NAME=stockpilot
AWS_REGION_WANT=ap-south-1
PORTS="3000 8000 8080 5173 55432 55433 18000 19090 13000"
# Sample paths that must be ignored (secrets, state, build output) ...
MUST_IGNORE="terraform/tfplan terraform/terraform.tfvars terraform/.terraform/x .env .env.local
  backend/.venv/x backend/app/__pycache__/x.pyc frontend/node_modules/x frontend/dist/x
  backend/.pytest_cache/x backend/.coverage terraform/terraform.tfstate
  terraform/terraform.tfstate.backup terraform/crash.log x.tfplan
  .DS_Store backend/pytest-report.xml trivy-backend.sarif backend/htmlcov/x backend/dev.db"
# ... and paths that must stay committable.
MUST_KEEP="terraform/.terraform.lock.hcl .env.example terraform/terraform.tfvars.example"
# Files whose image pins the digests mode checks: the Dockerfile bases, the Postgres image that
# compose, the Makefile, CI and Helm must all pin to the same digest, and the load generator's
# busybox. k8s/kind-config.yaml stays out: its kindest/node pin follows the installed kind release,
# whose release notes say only the digest, never the tag, guarantees a node image built for it.
DIGEST_FILES="backend/Dockerfile frontend/Dockerfile docker-compose.yml Makefile
  .github/workflows/ci-cd.yml helm/stockpilot/values.yaml k8s/loadgen.yaml"
PIN_RE='[[:alnum:]][[:alnum:]._/-]*:[[:alnum:]._-]+@sha256:[0-9a-f]{64}'

usage() { echo "usage: scripts/doctor.sh [all|tools|identity|repo|ports|digests] [--offline]"; }

mode=all
offline=0
for arg in "$@"; do
  case $arg in
    all | tools | identity | repo | ports | digests) mode=$arg ;;
    --offline) offline=1 ;;
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

if [ -t 1 ]; then
  red=$'\033[31m' green=$'\033[32m' yellow=$'\033[33m' dim=$'\033[2m' bold=$'\033[1m' off=$'\033[0m'
else
  red='' green='' yellow='' dim='' bold='' off=''
fi

n_pass=0 n_warn=0 n_fail=0 n_skip=0

report() { # report STATUS COLOUR CHECK [DETAIL] [FIX]
  printf '%s%-4s%s  %-21s  %s' "$2" "$1" "$off" "$3" "${4:-}"
  if [ -n "${5:-}" ]; then printf '  %sfix:%s %s' "$bold" "$off" "$5"; fi
  printf '\n'
}
pass() { n_pass=$((n_pass + 1)); report PASS "$green" "$@"; }
warn() { n_warn=$((n_warn + 1)); report WARN "$yellow" "$@"; }
fail() { n_fail=$((n_fail + 1)); report FAIL "$red" "$@"; }
skip() { n_skip=$((n_skip + 1)); report SKIP "$dim" "$@"; }
info() { report INFO "$dim" "$@"; }
section() { printf '\n%s== %s%s\n' "$bold" "$1" "$off"; }

have() { command -v "$1" >/dev/null 2>&1; }

# need CMD FIX: true when CMD exists, otherwise a FAIL line.
need() {
  if have "$1"; then return 0; fi
  fail "$1" "not found" "$2"
  return 1
}

# semver TEXT: the first x.y or x.y.z in TEXT.
semver() {
  printf '%s\n' "$1" | awk '!found && match($0, /[0-9]+\.[0-9]+(\.[0-9]+)?/) { print substr($0, RSTART, RLENGTH); found = 1 }'
}

# ver_ge HAVE NEED: true when HAVE >= NEED, part by part (macOS has no sort -V).
ver_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    na = split(a, x, "."); nb = split(b, y, "."); n = na > nb ? na : nb
    for (i = 1; i <= n; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0
  }'
}

# present CMD VERSION_FLAG FIX: PASS with the version, or FAIL when CMD is missing.
present() {
  if need "$1" "$3"; then pass "$1" "$(semver "$("$1" "$2" 2>&1 || true)")"; fi
}

first_line() { printf '%s\n' "$1" | sed -n 1p; }

docker_state=unknown
docker_up() {
  if [ "$docker_state" = unknown ]; then
    if have docker && docker info >/dev/null 2>&1; then docker_state=up; else docker_state=down; fi
  fi
  [ "$docker_state" = up ]
}

noreply_email() {
  local id=""
  if [ "$offline" = 0 ] && have gh; then id=$(gh api "users/$GH_OWNER" --jq .id 2>/dev/null || true); fi
  echo "${id:-<id>}+$GH_OWNER@users.noreply.github.com"
}

check_tools() {
  section tools
  local v mem

  present git --version "xcode-select --install"

  if need docker "install Docker Desktop"; then
    v=$(semver "$(docker version --format '{{.Client.Version}}' 2>/dev/null || true)")
    if [ -n "$v" ] && ver_ge "$v" 29; then
      pass "docker client" "$v"
    else
      fail "docker client" "${v:-unknown}, need >= 29" "update Docker Desktop"
    fi
    v=$(semver "$(docker compose version --short 2>/dev/null || true)")
    if [ -n "$v" ] && ver_ge "$v" 2.17; then
      pass "docker compose" "$v"
    else
      fail "docker compose" "${v:-missing}, need >= 2.17 for up --wait" "update Docker Desktop"
    fi
    if docker_up; then
      pass "docker daemon" "running"
      mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
      v=$(awk -v b="$mem" 'BEGIN { printf "%.1f", b / 1073741824 }')
      # The VM keeps some memory for itself: Docker Desktop's "8 GB" shows as about 7.7 GiB here.
      if ver_ge "$v" 7.5; then
        pass "docker memory" "$v GiB"
      else
        warn "docker memory" "$v GiB, want 8 GB or more" "Docker Desktop > Settings > Resources > Memory"
      fi
    else
      fail "docker daemon" "not reachable" "open -a Docker"
    fi
  fi

  if need kind "brew install kind"; then
    v=$(semver "$(kind version 2>/dev/null || true)")
    case $v in
      0.33.*) pass kind "$v" ;;
      *) warn kind "${v:-unknown}, the plan pins 0.33.x" ;;
    esac
  fi

  if need kubectl "brew install kubectl"; then
    v=$(semver "$(kubectl version --client 2>/dev/null || true)")
    case $v in
      1.35.* | 1.36.* | 1.37.*) pass kubectl "$v" ;;
      *) warn kubectl "${v:-unknown}, want 1.35-1.37 (EKS 1.36 +/- one minor)" ;;
    esac
  fi

  if need helm "brew install helm"; then
    v=$(semver "$(helm version --short 2>/dev/null || true)")
    if [ -n "$v" ] && ver_ge "$v" 4.3.0; then
      pass helm "$v"
    else
      fail helm "${v:-unknown}, need >= 4.3.0 (--rollback-on-failure is Helm 4 only)" "brew upgrade helm"
    fi
  fi

  if need trivy "brew install trivy"; then
    v=$(semver "$(trivy --version 2>/dev/null || true)")
    case $v in
      0.69.4 | 0.69.5 | 0.69.6) fail trivy "$v is a compromised release (CVE-2026-33634)" "brew upgrade trivy" ;;
      0.75.*) pass trivy "$v" ;;
      *) warn trivy "${v:-unknown}, CI runs 0.75.x" ;;
    esac
  fi

  if need terraform "brew install hashicorp/tap/terraform"; then
    v=$(semver "$(terraform version 2>/dev/null || true)")
    if [ -z "$v" ] || ! ver_ge "$v" 1.7 || ver_ge "$v" 2; then
      fail terraform "${v:-unknown}, need >= 1.7 and < 2" "brew install hashicorp/tap/terraform"
    else
      case $v in
        1.16.*) pass terraform "$v" ;;
        *) warn terraform "$v, the plan pins 1.16.x" ;;
      esac
    fi
  fi

  if need node "install Node 24 and put its bin directory first in PATH"; then
    v=$(semver "$(node -v 2>/dev/null || true)")
    if [ "${v%%.*}" = 24 ]; then
      pass node "$v ($(command -v node))"
    else
      fail node "${v:-unknown} at $(command -v node), need major 24" "put a Node 24 bin directory first in PATH"
    fi
  fi
  present npm -v "install Node 24"

  if need python3 "brew install python@3.14"; then
    v=$(semver "$(python3 --version 2>&1 || true)")
    if [ -n "$v" ] && ver_ge "$v" 3.11; then
      pass python3 "$v"
    else
      fail python3 "${v:-unknown}, need >= 3.11" "brew install python@3.14"
    fi
  fi
  if have python3.14; then
    pass python3.14 "$(semver "$(python3.14 --version 2>&1 || true)")"
  else
    warn python3.14 "not found; the backend venv and image use 3.14" "brew install python@3.14"
  fi

  present gh --version "brew install gh"
  if need aws "brew install awscli"; then
    v=$(semver "$(aws --version 2>&1 || true)")
    case $v in
      2.*) pass aws "$v" ;;
      *) fail aws "${v:-unknown}, need aws-cli v2" "brew install awscli" ;;
    esac
  fi
  present gitleaks version "brew install gitleaks"
  present jq --version "brew install jq"
  present curl --version "brew install curl"
  present openssl version "brew install openssl@3"
  if have shellcheck; then
    pass shellcheck "$(semver "$(shellcheck --version 2>/dev/null || true)")"
  else
    warn shellcheck "not found; lint-infra skips shell linting" "brew install shellcheck"
  fi
}

check_github() {
  local login="" out origin repo_found=0
  local origin_re="^(https://github\\.com/|git@github\\.com:)$GH_OWNER/$GH_REPO(\\.git)?$"

  if ! have gh; then
    skip "gh login" "gh not installed"
  elif [ "$offline" = 1 ]; then
    skip "gh login" "offline"
  else
    login=$(gh api user --jq .login 2>/dev/null || true)
    if [ "$login" = "$GH_OWNER" ]; then
      pass "gh login" "$login"
    else
      fail "gh login" "active account is ${login:-none}, want $GH_OWNER" "gh auth switch -h github.com -u $GH_OWNER"
    fi
  fi

  # The workflow scope is needed to push .github/workflows.
  if [ "$offline" = 1 ]; then
    skip "gh workflow scope" "offline"
  elif [ "$login" = "$GH_OWNER" ]; then
    out=$(gh auth status --active -h github.com 2>&1 || true)
    case $out in
      *"'workflow'"*) pass "gh workflow scope" "present" ;;
      *) fail "gh workflow scope" "missing for $GH_OWNER" "gh auth refresh -h github.com -s workflow" ;;
    esac
  else
    skip "gh workflow scope" "needs the $GH_OWNER login"
  fi

  origin=$(git remote get-url origin 2>/dev/null || true)
  if [ -z "$origin" ]; then
    fail "git origin" "no origin remote" "git remote add origin https://github.com/$GH_OWNER/$GH_REPO.git"
  elif [[ $origin =~ $origin_re ]]; then
    pass "git origin" "$origin"
    if [[ $origin == git@* ]]; then
      if [ "$offline" = 1 ]; then
        skip "ssh identity" "offline"
      else
        out=$(ssh -T -o BatchMode=yes -o ConnectTimeout=10 git@github.com 2>&1 || true)
        case $out in
          *"Hi $GH_OWNER!"*) pass "ssh identity" "$GH_OWNER" ;;
          *) fail "ssh identity" "$(first_line "$out")" "load the SSH key of $GH_OWNER (ssh-add)" ;;
        esac
      fi
    fi
  else
    fail "git origin" "$origin, want $GH_OWNER/$GH_REPO" "git remote set-url origin https://github.com/$GH_OWNER/$GH_REPO.git"
  fi

  if ! have gh; then
    skip "github repo" "gh not installed"
  elif [ "$offline" = 1 ]; then
    skip "github repo" "offline"
  elif out=$(gh repo view "$GH_OWNER/$GH_REPO" --json visibility --jq .visibility 2>&1); then
    repo_found=1
    if [ "$out" = PUBLIC ]; then
      pass "github repo" "$GH_OWNER/$GH_REPO is public"
    else
      fail "github repo" "$GH_OWNER/$GH_REPO is $out, want PUBLIC" "gh repo edit $GH_OWNER/$GH_REPO --visibility public --accept-visibility-change-consequences"
    fi
  else
    case $out in
      *"Could not resolve to a Repository"*) fail "github repo" "$GH_OWNER/$GH_REPO does not exist yet" "gh repo create $GH_OWNER/$GH_REPO --public" ;;
      *) fail "github repo" "lookup failed: $(first_line "$out")" ;;
    esac
  fi

  # GitHub attributes a commit to an account only when the author email belongs to it.
  if [ "$offline" = 1 ]; then
    skip "commit author" "offline"
  elif [ "$repo_found" = 0 ]; then
    skip "commit author" "needs the GitHub repo"
  elif out=$(gh api "repos/$GH_OWNER/$GH_REPO/commits?per_page=1" --jq '.[0].author.login // ""' 2>&1); then
    if [ "$out" = "$GH_OWNER" ]; then
      pass "commit author" "latest commit is attributed to $GH_OWNER"
    else
      fail "commit author" "latest commit is attributed to ${out:-no GitHub account}" "git config user.email $(noreply_email)"
    fi
  else
    case $out in
      *"Git Repository is empty"*) skip "commit author" "no commits on GitHub yet" ;;
      *) fail "commit author" "lookup failed: $(first_line "$out")" ;;
    esac
  fi
}

check_git_user() {
  local name email
  name=$(git config user.name || true)
  email=$(git config user.email || true)
  if [ -n "$name" ] && [ -n "$email" ]; then
    pass "git user" "$name"
  else
    fail "git user" "user.name or user.email is not set" "git config user.name 'Your Name' && git config user.email $(noreply_email)"
  fi
  case $email in
    *"+$GH_OWNER@users.noreply.github.com") pass "git author email" "the $GH_OWNER noreply address" ;;
    *) warn "git author email" "not the $GH_OWNER noreply address; commits may not count for $GH_OWNER" "git config user.email $(noreply_email)" ;;
  esac
}

check_aws() {
  local profiles region ident="" account tf_account

  if ! have aws; then
    skip "aws profile" "aws CLI not installed"
    return
  fi
  profiles=$(aws configure list-profiles 2>/dev/null || true)
  if ! grep -qx "$AWS_PROFILE_NAME" <<<"$profiles"; then
    fail "aws profile" "profile $AWS_PROFILE_NAME is not configured" "aws configure sso --profile $AWS_PROFILE_NAME"
    skip "aws region" "needs the $AWS_PROFILE_NAME profile"
    skip "aws identity" "needs the $AWS_PROFILE_NAME profile"
    skip "tfvars account" "needs the $AWS_PROFILE_NAME profile"
    return
  fi
  pass "aws profile" "$AWS_PROFILE_NAME"

  region=$(aws configure get region --profile "$AWS_PROFILE_NAME" 2>/dev/null || true)
  if [ "$region" = "$AWS_REGION_WANT" ]; then
    pass "aws region" "$region"
  else
    warn "aws region" "${region:-unset}, want $AWS_REGION_WANT" "aws configure set region $AWS_REGION_WANT --profile $AWS_PROFILE_NAME"
  fi

  if [ "$offline" = 1 ]; then
    skip "aws identity" "offline"
    skip "tfvars account" "offline"
    return
  fi
  # The account id is never printed: it stays local (terraform.tfvars is git-ignored).
  if ident=$(aws sts get-caller-identity --profile "$AWS_PROFILE_NAME" --query '[Account,Arn]' --output text 2>/dev/null); then
    case $ident in
      *:root) fail "aws identity" "signed in as the root user" "use an IAM Identity Center or IAM user with MFA" ;;
      *) pass "aws identity" "signed in, not root" ;;
    esac
  else
    fail "aws identity" "no valid session for $AWS_PROFILE_NAME" "aws sso login --profile $AWS_PROFILE_NAME"
    ident=""
  fi

  if [ ! -f terraform/terraform.tfvars ]; then
    skip "tfvars account" "terraform/terraform.tfvars not created yet"
  elif [ -z "$ident" ]; then
    skip "tfvars account" "needs a valid AWS session"
  else
    account=${ident%%[[:space:]]*}
    tf_account=$(sed -nE 's/^[[:space:]]*aws_account_id[[:space:]]*=[[:space:]]*"?([0-9]{12})"?.*/\1/p' terraform/terraform.tfvars | sed -n 1p)
    if [ "$tf_account" = "$account" ]; then
      pass "tfvars account" "aws_account_id matches the signed-in account"
    else
      fail "tfvars account" "aws_account_id in terraform/terraform.tfvars is not the signed-in account" "fix aws_account_id or sign in to the right account"
    fi
  fi
}

check_identity() {
  section identity
  check_github
  check_git_user
  check_aws
}

check_repo() {
  section repo
  local p missed="" wrongly_ignored="" tracked hits rc n=0

  # -q --no-index tests the rules themselves; never -v, which also reports negated (kept) paths.
  for p in $MUST_IGNORE; do
    n=$((n + 1))
    git check-ignore -q --no-index "$p" || missed="$missed $p"
  done
  if [ -z "$missed" ]; then
    pass "ignore rules" "$n sample paths ignored"
  else
    fail "ignore rules" "not ignored:$missed" "add a matching line to .gitignore"
  fi

  for p in $MUST_KEEP; do
    if git check-ignore -q --no-index "$p"; then wrongly_ignored="$wrongly_ignored $p"; fi
  done
  if [ -z "$wrongly_ignored" ]; then
    pass "kept files" "lock file and *.example files stay committable"
  else
    fail "kept files" "ignored by mistake:$wrongly_ignored" "un-ignore them in .gitignore (a !pattern line)"
  fi

  tracked=$(git ls-files -ci --exclude-standard)
  if [ -z "$tracked" ]; then
    pass "tracked ignored files" "none"
  else
    fail "tracked ignored files" "${tracked//$'\n'/ }" "git rm --cached <file> (rotate it first if it holds a secret)"
  fi

  for p in .trivyignore .env.example; do
    if [ -f "$p" ]; then pass "$p" "present"; else fail "$p" "missing" "restore $p from main"; fi
  done

  if compgen -G 'terraform/*.tf' >/dev/null; then
    if git ls-files --error-unmatch terraform/.terraform.lock.hcl >/dev/null 2>&1; then
      pass "terraform lock" "terraform/.terraform.lock.hcl is tracked"
    else
      fail "terraform lock" "terraform/.terraform.lock.hcl is not tracked" "terraform -chdir=terraform providers lock -platform=darwin_arm64 -platform=linux_amd64, then commit it"
    fi
  else
    skip "terraform lock" "no terraform/*.tf yet"
  fi

  # grep exits 1 for "no match" and 2 for an error, which must not pass as clean.
  rc=0
  hits=$(grep -rIilE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist 'task[b]oard' . 2>/dev/null) || rc=$?
  case $rc in
    1) pass "reference name" "not found" ;;
    0) fail "reference name" "found in ${hits//$'\n'/ }" "say 'the course reference project' instead" ;;
    *) fail "reference name" "grep could not scan the tree (exit $rc)" "use GNU or BSD grep" ;;
  esac
}

# listener PORT: "<command> (pid <pid>)" of the process listening on PORT, or nothing.
listener() {
  lsof +c 0 -nP -iTCP:"$1" -sTCP:LISTEN -Fpc 2>/dev/null |
    awk '/^p/ && !pid { pid = substr($0, 2) } /^c/ && !cmd { cmd = substr($0, 2) } END { if (pid != "") print cmd " (pid " pid ")" }' || true
}

# published_by PORT: names of the running containers that publish host port PORT.
published_by() { docker ps --filter "publish=$1" --format '{{.Names}}' 2>/dev/null || true; }

check_ports() {
  section ports
  local port who names sf c policy restarting=""

  if ! have lsof; then
    skip ports "lsof not found"
    return
  fi
  for port in $PORTS; do
    who=$(listener "$port")
    if [ -z "$who" ]; then
      pass "port $port" "free"
      continue
    fi
    names=""
    if docker_up; then names=$(published_by "$port" | tr '\n' ' '); fi
    names=${names% }
    case $names in
      *sail-forge*) fail "port $port" "held by $names" "docker update --restart=no $names && docker stop $names" ;;
      stockpilot-*) pass "port $port" "in use by $names (ours)" ;;
      '') warn "port $port" "in use by $who" ;;
      *) warn "port $port" "in use by container $names" ;;
    esac
  done

  who=$(listener 5432)
  if [ -n "$who" ]; then info "port 5432" "in use by $who; expected (brew Postgres), compose never publishes 5432"; fi

  if ! docker_up; then
    skip "sail-forge restarts" "docker is not running"
    return
  fi
  sf=$(docker ps -a --filter name=sail-forge --format '{{.Names}}' 2>/dev/null || true)
  for c in $sf; do
    policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c" 2>/dev/null || true)
    case $policy in
      '' | no) ;;
      *) restarting="$restarting $c" ;;
    esac
  done
  if [ -z "$sf" ]; then
    pass "sail-forge restarts" "no sail-forge containers"
  elif [ -z "$restarting" ]; then
    pass "sail-forge restarts" "every sail-forge container has restart=no"
  else
    fail "sail-forge restarts" "would restart and grab ports:$restarting" "docker update --restart=no$restarting"
  fi
}

# from_pins DOCKERFILE: every FROM pins a digest, except a FROM that names an earlier stage.
from_pins() {
  local image alias stages=" " n=0 unpinned=""
  while read -r image alias; do
    n=$((n + 1))
    case $image in
      *@sha256:*) ;;
      *) case $stages in *" $image "*) ;; *) unpinned="$unpinned $image" ;; esac ;;
    esac
    if [ -n "$alias" ]; then stages="$stages$alias "; fi
  done < <(awk 'toupper($1) == "FROM" { i = 2; while ($i ~ /^--/) i++; print $i, (toupper($(i + 1)) == "AS" ? $(i + 2) : "") }' "$1")
  if [ -n "$unpinned" ]; then
    fail "$1" "FROM without a digest:$unpinned" "pin the index digest (the Digest line of docker buildx imagetools inspect <image>)"
  else
    pass "$1" "$n FROM lines, each pinned by digest"
  fi
}

# manifest REF: the registry's manifest of REF as JSON (an index lists its platforms), or the error
# text and status 1. Each call is one manifest GET, which Docker Hub counts as a pull, so every
# image costs one call unless its pin has drifted.
manifest() {
  local err
  err=$(mktemp)
  if docker buildx imagetools inspect --format '{{json .Manifest}}' "$1" </dev/null 2>"$err"; then
    rm -f "$err"
    return 0
  fi
  cat "$err"
  rm -f "$err"
  return 1
}

# The linux platforms of an index manifest; empty for a single-platform manifest.
INDEX_PLATFORMS_JQ='if (.mediaType // "" | test("index|manifest.list"))
  then [.manifests[]?.platform | select(.os == "linux") | .os + "/" + .architecture] | unique | join(" ")
  else "" end'

# multi_arch JSON: true when the manifest is an index with both linux/amd64 and linux/arm64.
multi_arch() {
  local platforms
  platforms=" $(printf '%s' "$1" | jq -r "$INDEX_PLATFORMS_JQ" 2>/dev/null) "
  [[ $platforms == *" linux/amd64 "* && $platforms == *" linux/arm64 "* ]]
}

# registry_error TEXT: a short reason for a failed lookup.
registry_error() {
  case $1 in
    *"429 Too Many Requests"* | *toomanyrequests*) echo "registry rate limit (429)" ;;
    *) first_line "$1" ;;
  esac
}

# Drift in a pin is a WARN: bumping a base image is a deliberate change (rung 1 of the ladder in
# .trivyignore), and this mode never edits files.
check_digests() {
  section digests
  local f pins="" names name mine where count pinned upstream json network=1

  for f in backend/Dockerfile frontend/Dockerfile; do
    if [ -f "$f" ]; then from_pins "$f"; else fail "$f" "missing"; fi
  done

  for f in $DIGEST_FILES; do
    if [ -f "$f" ]; then pins="$pins$(grep -HnoE "$PIN_RE" "$f" || true)"$'\n'; fi
  done
  # file:line:name:tag@sha256:hex  ->  name:tag file:line sha256:hex
  pins=$(printf '%s' "$pins" | awk -F@ 'NF == 2 {
    i = index($1, ":"); rest = substr($1, i + 1); j = index(rest, ":")
    print substr(rest, j + 1), substr($1, 1, i) substr(rest, 1, j - 1), $2 }')
  names=$(printf '%s\n' "$pins" | awk 'NF { print $1 }' | sort -u)
  if [ -z "$names" ]; then
    fail "pinned images" "no name:tag@sha256 pins in the Dockerfiles, compose, Makefile, CI, Helm or loadgen"
    return
  fi

  if [ "$offline" = 1 ]; then
    network=0
  elif ! have docker || ! docker buildx version >/dev/null 2>&1; then
    network=0
    skip "registry" "docker buildx not available" "install Docker Desktop"
  elif ! need jq "brew install jq"; then
    network=0
  fi

  while read -r name; do
    mine=$(printf '%s\n' "$pins" | awk -v n="$name" '$1 == n')
    where=$(printf '%s\n' "$mine" | awk '{ printf "%s%s", (NR > 1 ? ", " : ""), $2 }')
    count=$(printf '%s\n' "$mine" | awk '{ print $3 }' | sort -u | grep -c .)
    pinned=$(printf '%s\n' "$mine" | awk 'NR == 1 { print $3 }')
    if [ "$count" -gt 1 ]; then
      fail "$name" "$count different digests in $where" "pin the same index digest in every file"
      continue
    fi
    if [ "$network" = 0 ]; then
      skip "$name" "$pinned in $where; registry not checked"
      continue
    fi
    if ! json=$(manifest "$name"); then
      warn "$name" "tag lookup failed: $(registry_error "$json"); pinned $pinned in $where" "retry later, or docker login"
      continue
    fi
    upstream=$(printf '%s' "$json" | jq -r '.digest // empty' 2>/dev/null || true)
    if [ -z "$upstream" ]; then
      warn "$name" "unexpected registry reply for the tag; pinned $pinned in $where" "retry later"
      continue
    fi
    if [ "$upstream" != "$pinned" ]; then
      # Drift: the pinned digest itself must still be a multi-arch index.
      if ! json=$(manifest "$name@$pinned"); then
        case $json in
          *"not found"* | *"manifest unknown"* | *" 404 "*)
            fail "$name" "pinned $pinned in $where is not in the registry" "pin the current index digest $upstream" ;;
          *) warn "$name" "pin lookup failed: $(registry_error "$json"); upstream is now $upstream" "retry later, or docker login" ;;
        esac
        continue
      fi
    fi
    if ! multi_arch "$json"; then
      fail "$name" "pinned $pinned in $where is not a multi-arch index with linux/amd64 and linux/arm64" "pin the index digest $upstream"
    elif [ "$upstream" = "$pinned" ]; then
      pass "$name" "$pinned = upstream, an index with linux/amd64 + linux/arm64 ($where)"
    else
      warn "$name" "upstream is now $upstream; pinned ${pinned:0:19}... in $where" "update every pin above, then make scan"
    fi
  done <<<"$names"
}

case $mode in
  all)
    check_tools
    check_identity
    check_repo
    check_ports
    ;;
  tools) check_tools ;;
  identity) check_identity ;;
  repo) check_repo ;;
  ports) check_ports ;;
  digests) check_digests ;;
esac

printf '\n%sdoctor:%s %d pass, %d warn, %d fail, %d skip\n' "$bold" "$off" "$n_pass" "$n_warn" "$n_fail" "$n_skip"
[ "$n_fail" -eq 0 ]
