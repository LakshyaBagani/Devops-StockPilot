# Security policy: StockPilot

## Supported versions

Only `main` is supported: the images tagged with the latest `main` commit SHA in
`ghcr.io/lakshyabagani/stockpilot-backend` and `ghcr.io/lakshyabagani/stockpilot-frontend`.
Older tags are never patched; every fix ships as a new commit on `main`.

## Reporting a vulnerability

Report privately through GitHub private vulnerability reporting: open the **Security** tab and
choose **Report a vulnerability**, or go to
<https://github.com/LakshyaBagani/Devops-StockPilot/security/advisories/new>.
Please do not open a public issue. No personal email address is published for reports.

This is a student project maintained on a best-effort basis. I aim to acknowledge a report
within 3 days and to share a fix or a mitigation plan within 14 days.

## Scope

In scope: the backend API, the frontend image, the Helm chart, the Terraform code and the
GitHub Actions workflows.

Known limits, by design (documented, not vulnerabilities):

- **No authentication.** StockPilot is a trusted internal tool; SSO is planned for v2.
- **HTTP only, no TLS.** TLS through cert-manager is planned for v2.
- **Planner CPU is bounded.** `PLANNER_MAX_WORK` caps the work of one request, and a per-pod
  bulkhead caps concurrent runs; a request that waits too long gets `503 Planner busy, retry`.

## Controls in place

- **Image gate.** Trivy scans the OS packages and the Python/Node libraries of both images on every
  pull request and push, and any HIGH/CRITICAL, unfixed included, fails the build, so that image is
  never pushed. Findings of every severity also go to the Security tab as SARIF.
- **IaC scan.** `trivy config` checks the Dockerfiles, Helm chart and Terraform (report-only).
- **Secret scanning.** gitleaks runs on every pull request and push, and over the full history on
  manual dispatch and on a weekly schedule. The image job depends on it, so nothing is published or
  deployed without a clean scan. GitHub secret scanning with push protection and Dependabot security
  updates are enabled.
- **Supply chain.** Every GitHub Action is pinned to a full commit SHA, and repository policy enforces
  it. The reason is the March 2026 trivy-action tag hijack (CVE-2026-33634 / GHSA-69fq-xp46-6x23):
  an attacker force-pushed almost every release tag to commits that stole CI secrets, and a SHA pin
  cannot be moved that way. Base images are pinned by digest.
- **Least privilege in CI.** Each workflow job gets only the token permissions it needs. Deploys
  assume an AWS role through GitHub OIDC with short-lived credentials; no AWS keys are stored.
- **Hardened containers.** Both images run as non-root numeric users (10001 backend, 101 frontend).
  In Kubernetes the pods also get a read-only root filesystem, all capabilities dropped and seccomp
  `RuntimeDefault`, and the namespace carries Pod Security labels. Postgres is the documented
  exception: the official image starts as root to prepare its data directory, then drops to uid 70.

## Secrets handling

- Nothing secret is stored in Git.
- The database and Grafana passwords are created with `openssl rand` when the cluster is
  bootstrapped, and live only in Kubernetes Secrets.
- `.env` and `terraform.tfvars` are git-ignored; `.env.example` holds local development values only.
- If a secret leaks: rotate it first, then purge it from the Git history.

## Verify locally

```bash
make scan                      # strict Trivy gate on both images, same flags as CI
gitleaks git --redact -v .     # the same check as make gitleaks
```
