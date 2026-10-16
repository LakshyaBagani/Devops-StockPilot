# ADR-0003: Deploy to EKS through GitHub OIDC, with no stored AWS keys

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `terraform/github-oidc.tf`, the `deploy` job in `.github/workflows/ci-cd.yml`,
  `.github/workflows/whoami.yml`, [ADR-0006](0006-sha-pinned-actions.md)

## Context

The `deploy` job runs `helm upgrade --install` against EKS after every green push to `main`. It needs
AWS credentials, because an EKS kubeconfig calls `aws eks get-token` to authenticate. The options:

1. An IAM user's access key and secret stored as GitHub secrets.
2. A base64 kubeconfig stored as a secret. This does not work on its own: the kubeconfig still needs
   AWS credentials on the runner to mint a token.
3. GitHub's OIDC token exchanged for short-lived credentials of an IAM role
   (`sts:AssumeRoleWithWebIdentity`).

Long-lived keys are the classic way CI pipelines leak cloud accounts, and the rubric rejects any
submission with credentials in the history.

## Decision

Use **GitHub OIDC** (option 3), defined in Terraform:

- **Provider:** `token.actions.githubusercontent.com` with audience `sts.amazonaws.com`, created by
  Terraform unless the account already has it (`create_github_oidc_provider = false`).
- **Role `stockpilot-gha-deploy`:** the trust policy requires `aud = sts.amazonaws.com` and a `sub`
  equal to one of exactly two strings, both scoped to the `production` environment: the immutable
  form `repo:LakshyaBagani@OWNER_ID/Devops-StockPilot@REPO_ID:environment:production` (sent by repositories
  created after 2026-07-15) and the legacy `repo:LakshyaBagani/Devops-StockPilot:environment:production`.
  No wildcards; the numeric ids are required variables and come from `gh api`, never typed by hand,
  because IAM compares them case-sensitively.
- **AWS permissions:** one inline statement, `eks:DescribeCluster` on this cluster's ARN, built from
  variables so the role can exist before the cluster.
- **Kubernetes permissions:** an EKS access entry binds the role to `AmazonEKSClusterAdminPolicy`. The
  deploy applies cluster-scoped Namespaces, which the namespaced access policies cannot do.
- **Workflow side:** only the `deploy` and `whoami` jobs get `id-token: write`, both declare
  `environment: production`, and that environment's branch policy allows only `main`. A repository
  variable `DEPLOY_ENABLED` gates the deploy job, so the pipeline stays green while no cluster exists.
- **Early check:** `make eks-oidc` applies only the three IAM resources (free), and the `whoami`
  workflow proves the trust before any cluster exists: it prints the token's claims, asserts the
  assumed-role ARN, and expects `ResourceNotFoundException` from `aws eks describe-cluster`.

## Alternatives considered

- **Access keys in GitHub secrets:** rejected; long-lived and the main leak path.
- **A wildcard subject such as `repo:LakshyaBagani/Devops-StockPilot:*`:** rejected; any branch, tag or pull
  request workflow could then assume a cluster-admin role.
- **IRSA or Pod Identity for an in-cluster deployer (GitOps pull):** a good production direction
  (Argo CD), but it adds a controller to install and explain; listed as future work.

## Consequences

- No AWS secret exists anywhere in GitHub; credentials live for at most one hour and only inside the
  job that requested them.
- The role is cluster-admin inside Kubernetes. The exposure is bounded by the exact subject, the
  `main`-only environment, the `DEPLOY_ENABLED` switch and a cluster that exists only for a few hours
  per session.
- A mistyped owner, repository or id makes the deploy fail with `Not authorized to perform
  sts:AssumeRoleWithWebIdentity`. The `whoami` run shows the exact `sub` to compare with the trust
  policy (troubleshooting in `terraform/README.md`).
- Status: the role is written and its trust is unit-tested offline (`make tf-check`, mocked
  providers). The `make eks-oidc` apply and the first `whoami` run happen after the GitHub repository
  and the AWS account are set up.
- Exception: an AWS project whose SCP denies `iam:CreateOpenIDConnectProvider` cannot host the role.
  For that case `enable_github_oidc = false` skips the provider, role and access entry,
  `enable_irsa = false` skips the cluster's IRSA provider (Pod Identity covers EBS CSI), and the deploy
  job authenticates with access keys from `production` environment secrets. Those keys belong to the
  identity that ran `terraform apply`, so the cluster-creator access entry is their Kubernetes
  permission. Keys are long-lived, so this mode is temporary: the keys are deleted at teardown.
