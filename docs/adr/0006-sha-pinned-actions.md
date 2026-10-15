# ADR-0006: Pin every GitHub Action to a full commit SHA

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `.github/workflows/ci-cd.yml`, `.github/workflows/whoami.yml`, `SECURITY.md`,
  [ADR-0003](0003-github-oidc-deploy.md)

## Context

A workflow step such as `uses: owner/action@v1` runs whatever commit the tag `v1` points to at the
moment the job starts. Git tags can be moved.

In March 2026 this happened to `aquasecurity/trivy-action`, the action most pipelines use for the
Trivy gate (**CVE-2026-33634 / GHSA-69fq-xp46-6x23**). With stolen credentials, an attacker
force-pushed almost every release tag of the action to commits that stole the secrets of the CI job,
and published a malicious Trivy release. Every workflow that referenced the action by tag ran the
attacker's code with its own token and secrets. During the clean-up the old unprefixed tags were
deleted, so a workflow pinned to a tag such as `0.30.0` (the one in the course reference project) no
longer resolves at all.

StockPilot's pipeline pushes images to GHCR and assumes a cluster-admin AWS role for deploys, so a
hijacked action in it would be serious.

## Decision

- **Every `uses:` is pinned to a 40-character commit SHA**, with the release as a comment, for example
  `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0`. A SHA names one
  immutable commit; nobody can move it.
- **Tools the actions download are pinned too:** Trivy `v0.75.0`, gitleaks `8.30.1`, Helm `v4.3.0`,
  kubectl `v1.36.5`, Terraform `1.16.6`.
- **The repository enforces it:** the setting "Require actions to be pinned to a full-length commit
  SHA" is part of the repository setup, done once the GitHub repository exists; from then on an
  unpinned `uses:` fails before it runs.
- **Runners are pinned:** `runs-on: ubuntu-24.04`, never `ubuntu-latest`, whose image changes under a
  running project (it moves to Ubuntu 26.04 in late 2026).
- **Least privilege around the actions:** the workflow default is `contents: read`; each job widens
  only what it needs (`packages: write` and `security-events: write` for images, `id-token: write`
  only for `deploy` and `whoami`), and checkouts use `persist-credentials: false`.
- **Checked locally:** actionlint and zizmor (which flags unpinned actions and risky patterns) run
  clean on both workflow files.
- **Container base images are pinned by digest** for the same reason, and `make digests` reports
  when a tag has moved on, so updates are deliberate.

## Alternatives considered

- **Major-version tags (`@v4`):** convenient automatic updates, and exactly the attack path above.
- **Forking each action into the account:** full control, but every fork must be kept up to date by
  hand; pinning gives the same immutability with less work.

## Consequences

- A moved or deleted tag cannot change what the pipeline runs.
- Updates are manual: to bump an action, resolve the new tag to its commit (for an annotated tag, the
  peeled `^{}` commit, not the tag object) and update the SHA and the comment together.
- Pinning does not cover what an action fetches at run time; that is why the tool versions above are
  pinned as well.
