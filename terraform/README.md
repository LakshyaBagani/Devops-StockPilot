# Terraform: AWS VPC + EKS for StockPilot

This root builds the AWS side of StockPilot in `ap-south-1` (Mumbai): a VPC, the EKS cluster `stockpilot-eks` with one managed node group, and the GitHub OIDC role that the CI deploy job assumes. It is the M7 deliverable. You run every billable step yourself, in your own terminal, behind a typed confirmation.

Quick map:

| Command | What it does | AWS cost |
|---|---|---|
| `make tf-check` | fmt, init (no backend), validate, mocked tests, planned-create counts | none, offline |
| `make eks-preflight` | read-only account checks (`scripts/aws-preflight.sh`) | free |
| `make eks-oidc` | IAM-only apply: GitHub OIDC provider + deploy role (type `yes`) | $0 |
| `make eks-plan` | full plan saved to `terraform/tfplan` | free |
| `make eks-up` | plan, then apply only after you type `APPLY` | ≈ $0.30/h from then on |
| `make eks-bootstrap` | namespaces, Secrets, Traefik + its load balancer, monitoring, repo variables (`scripts/eks-bootstrap.sh`) | the Classic LB |
| `make eks-down` | ordered teardown, AWS-side gates, `terraform destroy` (type `yes`), leftover sweep (`scripts/eks-teardown.sh`) | stops billing |
| `make leftovers` | all-region read-only sweep (`scripts/aws-leftovers.sh`) | free |

## 1. What this builds

| Resource | Details |
|---|---|
| VPC | `stockpilot-vpc`, `10.0.0.0/16`, DNS hostnames on, 2 AZs (the first two `opt-in-not-required` zones) |
| Public subnets | 2 × /24: `10.0.48.0/24`, `10.0.49.0/24`; tagged `kubernetes.io/role/elb=1`; default route to the internet gateway |
| Private subnets | 2 × /20: `10.0.0.0/20`, `10.0.16.0/20`; tagged `kubernetes.io/role/internal-elb=1`; default route to the NAT gateway |
| NAT | 1 NAT gateway (`single_nat_gateway`) with its Elastic IP |
| EKS | `stockpilot-eks`, Kubernetes 1.36, upgrade policy `STANDARD`, public endpoint, access entries, Secrets envelope-encrypted with a KMS key (7-day deletion window), no control-plane log group |
| Node group | `default-*`: 2 × `t3a.large` (fallback `t3.large`), AL2023 x86_64, `ON_DEMAND`, min 2 / desired 2 / max 3, private subnets only |
| Add-ons | `vpc-cni` (prefix delegation), `eks-pod-identity-agent`, `kube-proxy`, `coredns`, `metrics-server`, `aws-ebs-csi-driver` |
| Storage | EBS CSI driver on an EKS Pod Identity role (`stockpilot-eks-ebs-csi-*`); default gp3 StorageClass `ebs-csi-default-sc` |
| Cluster access | access entries for the identity that runs the apply (cluster-admin) and for `stockpilot-gha-deploy` (`AmazonEKSClusterAdminPolicy`, cluster scope) |
| GitHub OIDC | provider `token.actions.githubusercontent.com` (unless it already exists) and role `stockpilot-gha-deploy`: trust limited to two exact `environment:production` subjects; inline policy `eks:DescribeCluster` on this cluster's ARN only |

Planned creates, pinned by `tests/plan-counts.jq` in `make tf-check` (mocked providers, no AWS call):

| Plan | Creates |
|---|---|
| Fresh bring-up after a full destroy (`make eks-up`) | 65 (64 when the GitHub OIDC provider already exists) |
| `make eks-oidc` (IAM only) | 3 (2) |
| `make eks-plan` / `make eks-up` after `make eks-oidc` (P9) | 62 |
| ALB fallback (`alb-controller.tf.example`, section 13) | +4 |

M7 rubric mapping:

| M7 item (points) | Where | Evidence |
|---|---|---|
| Valid HCL (2), init (1), plan (2) | `*.tf`, `.terraform.lock.hcl`, `make tf-check`, `make eks-plan` | m7-00, m7-01 |
| VPC with ≥ 2 public subnets (3) | `module "vpc"` in `main.tf` | m7-02 |
| EKS + node group (4) | `module "eks"` in `main.tf` | m7-03, m7-03b |
| Clean destroy (2) | `make eks-down`, then `make leftovers` | m7-04 |
| tfvars.example, no credentials (1) | `terraform.tfvars.example`, OIDC instead of keys, gitleaks | the file, m7-05 |

## 2. Versions and why

| Component | Pin | Why |
|---|---|---|
| Terraform | 1.16.6 (`required_version = ">= 1.7.0, < 2.0.0"`) | 1.7 is the first release with `mock_provider`, which `tests/` uses |
| hashicorp/aws | 6.68.0 (`~> 6.68`, locked) | eks 21.29.0 needs ≥ 6.59; vpc 6.7.3 needs ≥ 6.28 |
| terraform-aws-modules/vpc | 6.7.3 | current v6 line on aws provider 6 |
| terraform-aws-modules/eks | 21.29.0 | v21 inputs (`name`, `kubernetes_version`, `addons`, access entries) |
| terraform-aws-modules/eks-pod-identity | 2.9.0 | EBS CSI (and the ALB fallback) without IRSA plumbing |
| `.terraform.lock.hcl` | aws 6.68.0, tls 4.4.1, time 0.14.2, cloudinit 2.4.1, null 3.3.2 | `h1:` hashes for darwin_arm64 (laptop) and linux_amd64 (CI); CI fails if init changes it |

Regenerate the lock only when a provider or module pin changes:

```bash
terraform -chdir=terraform providers lock -platform=darwin_arm64 -platform=linux_amd64
```

Defects in the course reference project's Terraform that this root fixes:

- **Multi-argument one-line blocks.** `terraform init` fails with "Invalid single-argument block definition", and `terraform fmt` cannot repair them. Everything here is multi-line HCL.
- **eks v20 on aws provider 5.** eks v20 caps the provider below 6.0, so it cannot be combined with the v6-era vpc and eks-pod-identity modules.
- **EKS 1.31.** It is in extended support ($0.60/h instead of $0.10/h), and no new 1.31 cluster can be created after 2026-11-26.
- **No add-ons.** eks v21 bootstraps none, so nodes never become Ready without the CNI, and since 1.30 there is no default StorageClass for the Postgres PVC.
- **No tfvars example**, a rubric item.
- **Wildcard trust.** `ref:refs/heads/main` subjects with a `coalesce(…, "*")` fallback, and a role policy that referenced the cluster module (so an IAM-only apply would have created the cluster).

## 3. Prerequisites

```bash
brew tap hashicorp/tap && brew install hashicorp/tap/terraform   # Homebrew core has no terraform formula
terraform version                                                # Terraform v1.16.6
aws --version                                                    # aws-cli/2.x
aws configure sso --profile stockpilot                           # or: aws configure --profile stockpilot (IAM-user path)
aws configure set region ap-south-1 --profile stockpilot && aws configure set output json --profile stockpilot
aws sso login --profile stockpilot                               # SSO path, at the start of every session
gh auth switch -h github.com -u LakshyaBagani && gh api user --jq .login   # LakshyaBagani
```

Also needed: `kubectl` 1.35–1.37, `helm` v4, `jq`, `openssl` and `shellcheck`. Every script pins `AWS_PROFILE=stockpilot` and `AWS_REGION=ap-south-1` itself, and so does every AWS target in `mk/eks.mk`.

## 4. Day-0 account readiness

Do this once, before anything is applied. `make eks-preflight` checks all of it afterwards.

**Identity.** Enable root MFA and check that the root user has no access keys. Create an IAM Identity Center user with the `AdministratorAccess` permission set (session of at least 4 h), or an IAM user `stockpilot-admin` with MFA. Use this one identity for every plan, apply, destroy, `kubectl` call and console screenshot: the creator access entry and the KMS key admin are bound to it.

```bash
aws sts get-caller-identity --profile stockpilot --query '[Account,Arn]' --output text   # the Arn must not end in :root
aws iam get-account-summary --profile stockpilot --query 'SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]' --output text   # 1 0
```

**Plan type.** Accounts created on or after 2025-07-15 start on the Free plan, which rejects `t3`/`t3a` launches: the node group sits in `CREATING` while the control plane bills.

```bash
export AWS_PROFILE=stockpilot AWS_REGION=ap-south-1; ACCT=$(aws sts get-caller-identity --query Account --output text)
aws freetier get-account-plan-state --region us-east-1 --query '[accountPlanType,accountPlanStatus]' --output text
export NODE_INSTANCE_TYPES=m7i-flex.large   # FREE plan only (B77); section 5 copies it into terraform.tfvars
```

If the command is unavailable, check **Billing and Cost Management > Free Tier** in the console. On `FREE`, either upgrade to the Paid plan (credits carry over) or use `m7i-flex.large` nodes (≈ $0.40/h in total).

**Budget: $10 a month, credits excluded.** By default a budget counts credits, which hides real spend. The JSON files go to a temporary directory and are never committed; the email comes from `BUDGET_EMAIL` at run time.

```bash
export BUDGET_EMAIL=you@example.com   # your address, never committed
T=$(mktemp -d)
cat >"$T/budget.json" <<'EOF'
{"BudgetName": "stockpilot-monthly-10usd", "BudgetType": "COST", "TimeUnit": "MONTHLY",
 "BudgetLimit": {"Amount": "10", "Unit": "USD"}, "CostTypes": {"IncludeCredit": false}}
EOF
n() { printf '{"Notification": {"NotificationType": "%s", "ComparisonOperator": "GREATER_THAN", "Threshold": %s, "ThresholdType": "PERCENTAGE"}, "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "%s"}]}' "$1" "$2" "$BUDGET_EMAIL"; }
printf '[%s,\n %s,\n %s]\n' "$(n ACTUAL 50)" "$(n ACTUAL 100)" "$(n FORECASTED 100)" >"$T/notify.json"
aws budgets create-budget --region us-east-1 --account-id "$ACCT" --budget file://$T/budget.json --notifications-with-subscribers file://$T/notify.json
aws budgets describe-budget --region us-east-1 --account-id "$ACCT" --budget-name stockpilot-monthly-10usd --query 'Budget.[BudgetLimit.Amount,BudgetLimit.Unit,CostTypes.IncludeCredit]' --output text   # 10.0 USD False
aws budgets describe-notifications-for-budget --region us-east-1 --account-id "$ACCT" --budget-name stockpilot-monthly-10usd --query 'length(Notifications)'   # 3
```

The budget lives outside this Terraform root on purpose: `terraform destroy` must never delete it.

**Cost Anomaly Detection** (console only; scripts never call `aws ce`, which bills $0.01 per request): **Billing and Cost Management > Cost Anomaly Detection > Create monitor**, monitor type **AWS services**, name `stockpilot-services`, then an alert subscription with your email (individual alerts, threshold $5).

**vCPU quota.** Two `t3a.large` nodes, scaling to 3, need at least 8 on-demand standard vCPUs:

```bash
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --query Quota.Value --output text
# only if < 8:
aws service-quotas request-service-quota-increase --service-code ec2 --quota-code L-1216C47A --desired-value 16
```

**ELB probe (≈ $0.03, approval gate CP0b).** New accounts can be blocked from creating load balancers for 20–72 h, and no fallback helps (an ALB uses the same API). Create and delete one tiny Classic LB in the default VPC on Day 0:

```bash
DEF_VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
# DEF_VPC is None: aws ec2 create-default-vpc (free), then repeat the line above
SUBNET=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$DEF_VPC Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)
aws elb create-load-balancer --load-balancer-name stockpilot-elb-probe --listeners Protocol=HTTP,LoadBalancerPort=80,InstanceProtocol=HTTP,InstancePort=80 --subnets "$SUBNET"
aws elb delete-load-balancer --load-balancer-name stockpilot-elb-probe
aws elb describe-load-balancers --query "length(LoadBalancerDescriptions[?LoadBalancerName=='stockpilot-elb-probe'])"   # 0
```

A DNSName from the create call means the account can create load balancers. `OperationNotPermitted` means it cannot yet: open an AWS Support case the same day and record its id here: `support case: none`.

Finally, `make eks-preflight` must show PASS for identity, version, add-ons, offerings, quota and budget (WARN lines are allowed) and exit 0.

## 5. Configure

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars && git check-ignore -v terraform/terraform.tfvars
aws sts get-caller-identity --profile stockpilot --query Account --output text              # -> aws_account_id
gh api repos/LakshyaBagani/Devops-StockPilot --jq '.owner.login, .name, .owner.id, .id'            # -> github_owner, github_repo, github_owner_id, github_repo_id
aws iam list-open-id-connect-providers --profile stockpilot --output text | grep token.actions.githubusercontent.com   # any output -> create_github_oidc_provider = false
```

- Paste the five values; never retype them. The trust policy compares the owner and repo case-sensitively (`LakshyaBagani`, never the lowercase GHCR spelling).
- If you exported `NODE_INSTANCE_TYPES` in section 4 (Free plan), set the same value: `node_instance_types = ["m7i-flex.large"]`.
- The example's `REPLACE_WITH_*` placeholders fail validation, so an unedited copy can never plan.
- `terraform.tfvars` holds no credentials and stays git-ignored, like `tfplan` and the state.

## 6. Offline checks

```bash
make tf-check
```

It runs `terraform fmt -check -recursive terraform`, `terraform -chdir=terraform init -backend=false -input=false`, `validate`, then `terraform test` with mocked `aws` and `tls` providers (no credentials, no AWS call):

- `tests/validation.tftest.hcl`: every variable guard fires (bad account id, extended-support version, Graviton type, lowercase owner, empty owner id, non-/16 CIDR, 29-character cluster name).
- `tests/plan.tftest.hcl`: the exact subnet CIDRs, one node group, both access entries, the exact OIDC subjects with no wildcard, the DescribeCluster ARN built from variables, the provider toggle.
- `tests/eks-oidc.tftest.hcl`: the IAM-only targeted plan and apply of `make eks-oidc`, then the full plan after it.
- `tests/plan-counts.jq`: the planned creates match section 1 (65, 64, 3, 2, 62).

Expect `Success! 13 passed, 0 failed.` and `planned creates match the runbooks (B65)`. CI's `iac` job runs the same fmt, init, lock-file drift check, validate and test.

## 7. Early OIDC check (P8, $0)

This proves GitHub can assume the deploy role before any cluster exists.

1. `make eks-oidc` (you, in your terminal). Review `Plan: 3 to add, 0 to change, 0 to destroy.` (2 with an existing provider): only `aws_iam_openid_connect_provider.github`, `aws_iam_role.github_actions` and `aws_iam_role_policy.github_actions_eks`, no `aws_eks`, `aws_vpc` or NAT address. Then type `yes`. If the preflight fails only on a pending quota increase, run its apply line directly: `AWS_PROFILE=stockpilot terraform -chdir=terraform apply -input=false -target=aws_iam_openid_connect_provider.github -target=aws_iam_role.github_actions -target=aws_iam_role_policy.github_actions_eks`.
2. Verify the trust and the inline policy. The condition must show `StringEquals` `aud = sts.amazonaws.com` and `StringLike` `sub` = exactly the two strings with `LakshyaBagani`, `stockpilot`, both numeric ids and `:environment:production`; the resource must be `arn:aws:eks:ap-south-1:<account>:cluster/stockpilot-eks`.

   ```bash
   aws iam get-role --profile stockpilot --role-name stockpilot-gha-deploy --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
   aws iam get-role-policy --profile stockpilot --role-name stockpilot-gha-deploy --policy-name eks-describe-cluster --query 'PolicyDocument.Statement[0].Resource' --output text
   ```

3. Repository variables. Take the role ARN from IAM: after a targeted apply, `terraform output` may be incomplete.

   ```bash
   gh variable set AWS_REGION --body ap-south-1 -R LakshyaBagani/Devops-StockPilot
   gh variable set EKS_CLUSTER_NAME --body stockpilot-eks -R LakshyaBagani/Devops-StockPilot
   gh variable set DEPLOY_ENABLED --body false -R LakshyaBagani/Devops-StockPilot
   gh variable set AWS_DEPLOY_ROLE_ARN --body "$(aws iam get-role --profile stockpilot --role-name stockpilot-gha-deploy --query Role.Arn --output text)" -R LakshyaBagani/Devops-StockPilot
   ```

4. Environment branch policy. The repo settings task (CI-03) owns it; here it is only read:

   ```bash
   gh api repos/LakshyaBagani/Devops-StockPilot/environments/production --jq '.deployment_branch_policy'   # custom_branch_policies: true
   gh api repos/LakshyaBagani/Devops-StockPilot/environments/production/deployment-branch-policies --jq '.branch_policies[].name'   # main
   ```

5. Run whoami:

   ```bash
   gh workflow run whoami.yml -R LakshyaBagani/Devops-StockPilot --ref main; sleep 5
   gh run watch "$(gh run list -R LakshyaBagani/Devops-StockPilot --workflow whoami.yml --limit 1 --json databaseId --jq '.[0].databaseId')" -R LakshyaBagani/Devops-StockPilot --exit-status
   aws eks list-clusters --profile stockpilot --region ap-south-1 --query clusters --output text   # still empty
   ```

   Reading the log: the **Print OIDC claims** step shows `sub: repo:LakshyaBagani@<owner-id>/Devops-StockPilot@<repo-id>:environment:production` (repos created after 2026-07-15 send this immutable form) or the legacy `repo:LakshyaBagani/Devops-StockPilot:environment:production`. It must equal one of the two strings from step 2, character for character. **Caller identity** shows an ARN containing `assumed-role/stockpilot-gha-deploy/gha-whoami-`, and **Permission probe** shows `ResourceNotFoundException`: the call was authorised and no cluster exists yet. On `AccessDenied`, compare the printed `sub` with the trust policy, fix `terraform.tfvars`, and run `make eks-oidc` again.

6. Full plan for the evidence: `make eks-plan` shows `Plan: 62 to add, 0 to change, 0 to destroy.` (the graded run in a no-OIDC project: 59 to add) and `Changes other than create: 0` (m7-00, m7-01). Then `rm -f terraform/tfplan`: a saved plan goes stale.

## 8. Lifecycle (P9 session)

Every `aws` line below carries the profile and region (B65); `kubectl` uses the context `stockpilot-eks`.

1. **Gate check, free, within 24 h before `make eks-up` (B84).** Never bring up a cluster with a red strict gate.

   ```bash
   make digests && make scan   # strict Trivy on a fresh DB: exit 0
   gh variable get DEPLOY_ENABLED -R LakshyaBagani/Devops-StockPilot   # false: the dispatch builds, scans and pushes; deploy is skipped
   gh workflow run ci-cd.yml -R LakshyaBagani/Devops-StockPilot --ref main; sleep 5
   RUN=$(gh run list -R LakshyaBagani/Devops-StockPilot --workflow ci-cd.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'); gh run watch "$RUN" -R LakshyaBagani/Devops-StockPilot --exit-status
   gh run view "$RUN" -R LakshyaBagani/Devops-StockPilot --json jobs --jq '.jobs[] | select(.name | startswith("image")) | .name + " " + .conclusion'   # both success; red -> the B84 ladder first
   ```

2. `make eks-preflight`: all PASS.
3. **`make eks-up` (you; billing starts).** It runs the preflight, init, fmt, validate and `plan -out tfplan`, prints the `Plan:` line and the count of changes other than create, then asks `Type APPLY:`. Review `Plan: 62 to add, 0 to change, 0 to destroy.` (the graded run in a no-OIDC project: 59 to add) (65, or 64, on a fresh bring-up after a full destroy) and type `APPLY`. Anything else deletes the saved plan and creates nothing. The apply takes 15–22 minutes, then the target writes the kube context and lists the nodes. If the node group is still `CREATING` after about 10 minutes, check its health (section 14) before waiting longer.
4. **Verify:**

   ```bash
   $(terraform -chdir=terraform output -raw configure_kubectl)
   kubectl --context stockpilot-eks get nodes -o wide -L node.kubernetes.io/instance-type   # 2 Ready, v1.36, private IPs, a type from node_instance_types
   kubectl --context stockpilot-eks get nodes -o custom-columns=NAME:.metadata.name,PODS:.status.allocatable.pods   # >= 35 (110 with prefix delegation)
   kubectl --context stockpilot-eks get sc && kubectl --context stockpilot-eks -n kube-system get pods && kubectl --context stockpilot-eks top nodes   # ebs-csi-default-sc (default); all Running
   AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws eks describe-cluster --name stockpilot-eks --query 'cluster.[version,status,upgradePolicy.supportType]' --output text   # 1.36 ACTIVE STANDARD
   AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws eks list-access-entries --cluster-name stockpilot-eks --output text   # the creator and role/stockpilot-gha-deploy
   VPC=$(terraform -chdir=terraform output -raw vpc_id); AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC Name=tag:kubernetes.io/role/elb,Values=1 --query 'length(Subnets)'   # 2
   AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws ec2 describe-instances --filters Name=tag:eks:cluster-name,Values=stockpilot-eks Name=instance-state-name,Values=running --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text | tr '\t' '\n' | sort -u   # exactly 1, = node_security_group_id
   ```

5. Console screenshots with the region (Mumbai) visible: m7-02, m7-03, plus m7-03b from the first `kubectl get nodes` line above.
6. **`make eks-bootstrap`.** Health checks, `k8s/namespace.yaml` (screenshot the `created` lines: m8-00), the `stockpilot-db` and `grafana-admin` Secrets (created only if absent, never rotated), Traefik and its Classic LB, kube-prometheus-stack, then the repo variables `APP_URL` (no trailing slash; the LB name changes on every bring-up) and `AWS_DEPLOY_ROLE_ARN`. Before the app exists, the LB answers `/` with 404. It never sets `DEPLOY_ENABLED`.
7. **Deploy gate (CP5b, you).** Then merge the evidence PR: its push run is the first deploy (`gh workflow run ci-cd.yml -R LakshyaBagani/Devops-StockPilot --ref main` is the fallback).

   ```bash
   [ "$(gh api user --jq .login)" = LakshyaBagani ] && gh variable set DEPLOY_ENABLED --body true -R LakshyaBagani/Devops-StockPilot
   ```

8. **Seed (B52)**, then the backend calibration:

   ```bash
   kubectl --context stockpilot-eks -n stockpilot exec deploy/stockpilot-backend -- python -m app.seed
   curl -fsS "$(gh variable get APP_URL -R LakshyaBagani/Devops-StockPilot)/api/products?limit=100" | jq length   # 40
   ```

9. **Bootstrap rerun check (G.2 step 6d, B76).** A second run must change nothing:

   ```bash
   H0=$(kubectl --context stockpilot-eks -n stockpilot get secret stockpilot-db -o jsonpath='{.data.password}' | shasum -a 256)
   make eks-bootstrap; echo "exit=$?"   # exit=0
   [ "$(kubectl --context stockpilot-eks -n stockpilot get secret stockpilot-db -o jsonpath='{.data.password}' | shasum -a 256)" = "$H0" ] && echo 'stockpilot-db password hash unchanged'
   APP_URL=$(gh variable get APP_URL -R LakshyaBagani/Devops-StockPilot); curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL/"   # 200
   [ "$(curl -fsS "$APP_URL/api/version" | jq -r .git_sha)" = "$(gh api repos/LakshyaBagani/Devops-StockPilot/commits/main --jq .sha)" ] && echo 'git_sha = main'
   ```

10. The M8/M9 evidence (K8-15). Never run `make eks-up` again on a live cluster: the add-on versions and the node AMI float, so a re-apply can roll the nodes and re-attach the Postgres volume.
11. **`make eks-down` (you), then `make leftovers`** (section 10). Check Cost Explorer the next day.

## 9. Cost

ap-south-1 list prices, USD, checked 2026-10-14:

| Item | $/h |
|---|---|
| EKS control plane, standard support | 0.10 |
| 2 × t3a.large on-demand | 0.0986 |
| NAT gateway (+ $0.056/GB processed) | 0.056 |
| Classic LB (Traefik) | 0.0266 |
| 3 public IPv4 addresses (NAT EIP + CLB) | 0.015 |
| ≈ 45 GiB gp3 (node roots + Postgres) | ≈ 0.006 |
| KMS key ($1/month; free while pending deletion) | ≈ 0.0014 |
| **Total** | **≈ $0.30/h** |

That is ≈ $1.8 per 6-hour session, ≈ $7.2 a day and **≈ $50 a week if forgotten**, plus 18% GST. With Free-plan `m7i-flex.large` nodes it is ≈ $0.40/h. NAT and CLB bill partial hours as full hours, so avoid several up/down cycles within one hour.

Session plan:

| Session | Uptime | Expected |
|---|---|---|
| P8 early OIDC check | IAM only | $0 |
| P9 evidence session | 4–6 h | ≈ $1.2–1.8 |
| P11 rehearsal | ≈ 4–5 h | ≈ $1.5 |
| Overnight keep before the demo, only when the demo is the next calendar day (B83) | ≈ 16 h | ≈ $5–7 |
| P12 demo, same-day destroy (or a fresh bring-up starting by T-4h) | ≈ 3–5 h | ≈ $1–2 |
| **Total** | | **$8–13 incl. GST** with one overnight keep; ≈ $6 without |
| **Actual spend** (Billing console, month to date; filled in before the `submission-v1` tag, TF-18) | | _to be filled_ |

Guardrails: the $10 budget with credits excluded and three alerts; Cost Anomaly Detection; `DEPLOY_ENABLED` stays false outside sessions; a phone reminder for teardown; `make leftovers` after every destroy. Budgets refresh only every 8–12 hours, so alerts lag.

## 10. Teardown and DependencyViolation recovery

`make eks-down` runs `scripts/eks-teardown.sh` in this order:

1. Checks the AWS account against `aws_account_id` and the `gh` login, then sets `DEPLOY_ENABLED=false` (its first change) and waits until no `ci-cd.yml` run is queued or in progress, so no deploy recreates what it removes.
2. Uninstalls inside the cluster: the `stockpilot-lab` namespace, the load generator, the `stockpilot` release, the `stockpilot` PVCs (StatefulSet volumes outlive the release; it waits until their PVs are gone, so the CSI driver deletes the EBS volumes), kube-prometheus-stack, the ALB controller if present (only after its load balancers are gone), and Traefik (its Service owns the Classic LB). It stops if any LoadBalancer Service or PVC remains.
3. Waits (up to 10 minutes) until the AWS-side gates are empty: Classic LBs, elbv2 LBs and target groups in the VPC, `k8s-*` security groups in the VPC, and volumes tagged `ebs.csi.aws.com/cluster=true`. Kubernetes created all of these, and Terraform does not know them.
4. `terraform destroy`: review it and type `yes`. Expect `Destroy complete! Resources: 65 destroyed.` (the graded run: 59 destroyed) (64 when the GitHub OIDC provider pre-existed); screenshot it (m7-04).
5. Runs the leftover sweep (`scripts/aws-leftovers.sh`, the same as `make leftovers`), offers to delete the kube context, and reminds you to check Cost Explorer.

Flags, for `scripts/eks-teardown.sh` directly:

| Flag | Use |
|---|---|
| `--check-only` | the AWS-side gates once, read-only: exit 0 when all are empty |
| `--skip-k8s` | the API is unreachable or the cluster is gone: no uninstalls; leftover EBS volumes are reported, not blocking (delete them after destroy) |
| `--clean-orphans` | deletes this VPC's leftover load balancers, target groups, `available` ENIs and `k8s-*` security groups after you type `CLEAN`, then destroys again |

When `terraform destroy` stops on `DependencyViolation` (a subnet, security group or the VPC), the script prints what is still in the VPC. The usual blockers and fixes:

```bash
VPC=$(terraform -chdir=terraform output -raw vpc_id)
AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws ec2 describe-network-interfaces --filters Name=vpc-id,Values=$VPC --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,InterfaceType,Description]' --output table
AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC --query "SecurityGroups[?GroupName!='default'].[GroupId,GroupName]" --output table
AWS_PROFILE=stockpilot AWS_REGION=ap-south-1 aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=$VPC --query 'VpcEndpoints[].[VpcEndpointId,ServiceName,State]' --output table
scripts/eks-teardown.sh --skip-k8s --clean-orphans   # type CLEAN
```

- **`available` ENIs** left by a deleted load balancer: `--clean-orphans` deletes them.
- **`k8s-elb-*` security group** of the Classic LB: the node security group still has an ingress rule that references it. `--clean-orphans` revokes that rule (`describe-security-group-rules`, then `revoke-security-group-ingress --security-group-rule-ids`) and deletes the group.
- **GuardDuty VPC endpoint** (`com.amazonaws.ap-south-1.guardduty-data`, with a `GuardDutyManagedSecurityGroup-*` group): GuardDuty Runtime Monitoring's automated agent adds it, and `make eks-preflight` warns when a detector is on. Turn off the automated agent configuration for EKS in the GuardDuty console first, or it comes back. Then `aws ec2 delete-vpc-endpoints --vpc-endpoint-ids <vpce-id>` and delete its security group.
- Then run `make eks-down` again. Once the cluster itself is gone, use `scripts/eks-teardown.sh --skip-k8s`.

## 11. Security notes

- **Exact, environment-scoped OIDC subjects.** The trust accepts only `repo:LakshyaBagani@<owner-id>/Devops-StockPilot@<repo-id>:environment:production` and the legacy `repo:LakshyaBagani/Devops-StockPilot:environment:production`: case-sensitive, numeric ids required, no wildcard. The `production` environment allows only `main` (branch policy owned by CI-03), so only main's deploy and whoami jobs can assume the role.
- **Why cluster-admin.** The deploy job applies `k8s/namespace.yaml` (cluster-scoped Namespaces) and upgrades the release, including its ServiceMonitor, with rollback; the namespaced EKS access policies cannot create namespaces. The exposure is bounded by the exact subject, the main-only environment, `DEPLOY_ENABLED` and a cluster that lives for hours. In IAM the role can only call `eks:DescribeCluster` on this one cluster.
- **Public API endpoint, an accepted risk.** GitHub-hosted runners have no fixed IPs, and every call is IAM-authenticated. The advisory `config-scan` job's `trivy config` reports it as AVD-AWS-0040 and AVD-AWS-0041 (and AVD-AWS-0104 for the node group's egress to the internet, which image pulls through the NAT need). They are reported, not ignored.
- **Secrets encryption on.** The module's KMS key envelope-encrypts Kubernetes Secrets (7-day deletion window).
- **Wrong-account guard.** `allowed_account_ids = [var.aws_account_id]`: a wrong `AWS_PROFILE` cannot plan, apply or destroy anything.
- **No keys anywhere.** The laptop uses `AWS_PROFILE=stockpilot`; CI uses OIDC; the provider block has no credentials. gitleaks runs in the required `secrets` job.
- **Private nodes.** No public IPs; IMDSv2 with a hop limit of 1, so pods cannot use the node role; the EBS CSI driver gets its own role through Pod Identity.
- **Generated in-cluster.** `make eks-bootstrap` creates the database and Grafana passwords with `openssl rand`; they never pass through Git, CI logs or arguments, and are never rotated while the Postgres volume exists.

## 12. State

- State is local (`terraform/terraform.tfstate`) and git-ignored, like `terraform.tfvars`, `tfplan` and `.terraform/`. It is the only record of what exists: keep it on this Mac until `Destroy complete!`.
- Before a destroy, keep a dated copy outside the repo:

  ```bash
  mkdir -p "$HOME/stockpilot-state-backups" && cp terraform/terraform.tfstate "$HOME/stockpilot-state-backups/$(date +%F-%H%M).tfstate"
  ```

- The state holds the account id and resource ids, never credentials; it still never goes into Git.
- Remote state is optional: `backend.tf.example` (S3 with the native lock file, Terraform ≥ 1.11).

## 13. ALB fallback

If the Traefik Service gets no load balancer address although the subnet tags and the node security group are correct, switch the Ingress to the AWS Load Balancer Controller: follow `alb-controller.tf.example` (a Pod Identity role, +4 resources, then the controller chart 3.6.0 with `region` and `vpcId` set). It does not help with an account-level ELB block (section 4). `make eks-down` waits for the controller's load balancers before uninstalling it.

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| whoami or deploy: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | the token's `sub` matches neither trusted subject: case, ids, repo name, or a job without `environment: production` | compare whoami's printed `sub` with section 7 step 2; fix `terraform.tfvars` from `gh api`; run `make eks-oidc` again |
| `EntityAlreadyExists` for `token.actions.githubusercontent.com` | the account already has GitHub's OIDC provider (one per URL) | set `create_github_oidc_provider = false`; the preflight catches it |
| node group stuck in `CREATING` | Free plan rejects `t3`/`t3a` ("not eligible for Free Tier"), or no capacity in an AZ | `aws eks list-nodegroups --cluster-name stockpilot-eks`, then `aws eks describe-nodegroup --cluster-name stockpilot-eks --nodegroup-name <name> --query nodegroup.health`; Free plan: `m7i-flex.large` (B77) or upgrade |
| nodes `NotReady` | the `vpc-cni` add-on is missing or not ACTIVE (eks v21 bootstraps no add-ons) | `aws eks describe-addon --cluster-name stockpilot-eks --addon-name vpc-cni --query addon.status`; `kubectl --context stockpilot-eks -n kube-system get pods -l k8s-app=aws-node` |
| PVC `Pending` | no default StorageClass, or the EBS CSI add-on or its Pod Identity association is missing | `kubectl --context stockpilot-eks get sc` shows `ebs-csi-default-sc (default)`; `aws eks list-pod-identity-associations --cluster-name stockpilot-eks` |
| Traefik `EXTERNAL-IP` stays `<pending>` | `OperationNotPermitted` in the Service events (account ELB block), missing `kubernetes.io/role/elb` subnet tags, or more than one cluster-tagged security group per node | `kubectl --context stockpilot-eks -n traefik describe svc traefik`; support case for a block; otherwise section 13 |
| `kubectl`: `You must be logged in to the server (Unauthorized)` | another identity than the one that applied (the creator access entry), an expired SSO session, or a kubeconfig written without the profile | `aws sts get-caller-identity --profile stockpilot`; `aws sso login --profile stockpilot`; `$(terraform -chdir=terraform output -raw configure_kubectl)` |
| apply: `ResourceAlreadyExistsException` for log group `/aws/eks/stockpilot-eks/cluster` | left by an earlier cluster | `aws logs delete-log-group --log-group-name /aws/eks/stockpilot-eks/cluster` (the preflight FAILs on it) |
| apply: `alias/eks/stockpilot-eks` already exists | a partial run left the KMS alias | `aws kms delete-alias --alias-name alias/eks/stockpilot-eks` (the key itself waits out its deletion window for free) |
| `Saved plan is stale` | the state changed after the plan was saved | run `make eks-up` again: it always re-plans |
| SSO token expired mid-apply | the session ended during the 15–22 minute apply; the state is partial | `aws sso login --profile stockpilot`, then `make eks-up` again, which plans only what is missing; use a permission set of at least 4 h |
| a later plan shows in-place updates to the node group or add-ons | the AMI release (`use_latest_ami_release_version`) and add-on versions (`most_recent`) float | never re-apply a live cluster (B64); fine on a fresh bring-up |
| whoami: `AccessDeniedException` from describe-cluster | the inline policy's ARN does not match the region, account or cluster name | `aws iam get-role-policy --profile stockpilot --role-name stockpilot-gha-deploy --policy-name eks-describe-cluster` |
| plan: `AWS account ID not allowed` | `AWS_PROFILE` points at another account than `aws_account_id` | sign in with the `stockpilot` profile; the provider's `allowed_account_ids` refuses everything else |
| destroy: `DependencyViolation` | ENIs, `k8s-*` security groups or a GuardDuty endpoint left in the VPC | section 10 |

## 15. M7 evidence index

| File | Shows |
|---|---|
| [`m7-00-init-fmt-validate.png`](../docs/evidence/m7-00-init-fmt-validate.png) | `terraform init`, `fmt -check`, `validate` and the mocked tests |
| [`m7-01-plan.png`](../docs/evidence/m7-01-plan.png) | `terraform plan` in the graded project: `Plan: 59 to add, 0 to change, 0 to destroy` |
| [`m7-02c-console-vpc-resource-map.png`](../docs/evidence/m7-02c-console-vpc-resource-map.png) | VPC console resource map: `spilot-vpc`, 2 public + 2 private subnets, route tables, IGW, NAT |
| [`m7-02-vpc-public-subnets.png`](../docs/evidence/m7-02-vpc-public-subnets.png) | The same VPC from the AWS CLI |
| [`m7-03c-console-eks-cluster.png`](../docs/evidence/m7-03c-console-eks-cluster.png) | EKS console: `spilot-eks`, Kubernetes 1.36, Active |
| [`m7-03b-console-eks.png`](../docs/evidence/m7-03b-console-eks.png) | EKS console: the managed node group, Active, 2 × `m7i-flex.large` |
| [`m7-03-eks-cluster-nodegroup.png`](../docs/evidence/m7-03-eks-cluster-nodegroup.png) | Terraform outputs, cluster and node group from the CLI, `kubectl get nodes` (2 Ready) |
| [`m7-04-destroy.png`](../docs/evidence/m7-04-destroy.png) | `terraform destroy`: `Destroy complete! Resources: 59 destroyed.` |
| [`m7-04b-no-leftovers.png`](../docs/evidence/m7-04b-no-leftovers.png) | After destroy: no cluster, VPC, NAT, nodes or load balancer left, empty state |
| [`m7-05-gitleaks-full-history.png`](../docs/evidence/m7-05-gitleaks-full-history.png) | CI `secrets` job on `workflow_dispatch`: gitleaks over the full history, no leaks |
| [`m7-06-gitleaks-local.png`](../docs/evidence/m7-06-gitleaks-local.png) | The local gitleaks run before the first push |

## 16. Why each setting (viva sheet)

| Setting | Why |
|---|---|
| `kubernetes_version = "1.36"`, `upgrade_policy = STANDARD` | standard support costs $0.10/h; extended support $0.60/h. 1.36 is one minor from the local kubectl 1.37 |
| 2 AZs, 2 public /24 + 2 private /20 subnets | EKS needs subnets in two AZs; the Classic LB lands in the `elb`-tagged public subnets; the /20s leave room for prefix delegation's /28 blocks |
| one NAT gateway | private nodes need egress for image pulls; a second NAT doubles $0.056/h for no benefit here |
| nodes in private subnets | nothing on the nodes is reachable from the internet; traffic enters only through the load balancer |
| `endpoint_public_access = true` | the laptop and GitHub-hosted runners reach the API; it stays IAM-authenticated (accepted risk, section 11) |
| `enabled_log_types = []`, no log group | no $0.67/GB log ingest, and no `ResourceAlreadyExists` on the next apply after a destroy |
| KMS key kept, 7-day deletion window | Secrets stay envelope-encrypted; the key's free PendingDeletion tail is short |
| add-ons listed, `vpc-cni` and `eks-pod-identity-agent` before compute | eks v21 bootstraps none; without the CNI the nodes never become Ready |
| prefix delegation | more pods per node (110 instead of 35), harmless headroom |
| EBS CSI via Pod Identity + `defaultStorageClass` | the Postgres PVC needs a default class (none since 1.30); the IMDS hop limit of 1 keeps pods off the node role |
| `metrics-server` add-on | the HPA reads CPU from the metrics API |
| 2 × `t3a.large` on-demand, min 2 / desired 2 / max 3 | 2 vCPU and 8 GiB each; t3a is ≈ 45% cheaper than t3 in Mumbai, with `t3.large` as the fallback; spot interruptions are not worth it for a live demo |
| AL2023 x86_64 | the managed node group default from 1.30; the CI images are amd64 |
| `enable_cluster_creator_admin_permissions` | the identity that applies gets cluster-admin through an access entry, with no `aws-auth` ConfigMap |
| access entry for `stockpilot-gha-deploy` | the deploy job's Kubernetes rights come from EKS, not from IAM |
| `allowed_account_ids` | the wrong profile can never touch another account |
| exact OIDC subjects, no wildcard | only main's `production` jobs of this exact repository can assume a cluster-admin role |
| DescribeCluster ARN built from variables | the role exists before the cluster (P8 whoami), and `make eks-oidc` can never pull in billable resources |
| budget outside Terraform | `terraform destroy` cannot delete the cost alarm |
