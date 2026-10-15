# Live demo script

The M10 demo shows the whole loop in about 10 minutes: use the app, **commit a change, watch the
pipeline test, scan and push it, and see the deployment update**, while the backend autoscales under
load. Every command below exists in this repository; nothing is typed from memory on the day.

Contents: [before the slot](#before-the-slot) · [T-3h checklist](#t-3h-checklist) ·
[the demo](#the-demo-about-10-minutes) · [after the demo](#after-the-demo-same-day) ·
[fallbacks](#fallbacks) · [rehearsal record](#rehearsal-record)

## Before the slot

- **Cluster.** Up since the rehearsal only if the demo is the next calendar day; otherwise one fresh
  bring-up starting by T-4h (`make eks-up`, `make eks-bootstrap`, the CI deploy, the seed), following
  [terraform/README.md](../terraform/README.md#8-lifecycle-p9-session). Never re-apply a live cluster
  on demo day.
- **Data.** Seeded with the 40 demo products. The 30-day demand window slides every day, so re-apply
  the demo stories in the morning; this puts the Reynolds pen back just above two lead times of cover:

  ```bash
  kubectl --context stockpilot-eks -n stockpilot exec deploy/stockpilot-backend -- python -m app.seed --demo-reset
  ```

- **Screens.** Browser tabs: the app (`$APP_URL`), `$APP_URL/api/docs`, the GitHub Actions tab, the
  GHCR package pages, Grafana. Terminal 1 for `kubectl` watches, terminal 2 for `git`, `gh` and `make`.
  Grafana runs through a port-forward in its own terminal, and its password goes to the clipboard,
  never on screen:

  ```bash
  kubectl --context stockpilot-eks -n monitoring port-forward svc/kube-prometheus-stack-grafana 13000:80
  kubectl --context stockpilot-eks -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode | pbcopy
  open http://localhost:13000/d/stockpilot-overview
  ```

- **The demo change, prepared but not committed:** in `frontend/src/config.js`, add
  `{ label: 'Diwali rush +40%', pct: 40 }` to `SURGE_PRESETS` and set
  `APP_SUBTITLE = 'Diwali stock check 2026'`. It is UI-only: no migration, no API change, no test
  impact. This live-demo commit is the one change allowed on `main` after the `submission-v1` tag.
- **Backups ready:** the rehearsal video, the Compose stack on the laptop, and the evidence folder.

## T-3h checklist

Run in your own terminal three hours before the slot. Every line must match its comment.

```bash
export AWS_PROFILE=stockpilot AWS_REGION=ap-south-1
kubectl config use-context stockpilot-eks
kubectl get nodes                                    # 2 nodes, both Ready
kubectl -n stockpilot get pods                       # every pod Running: 2+ backend, 2 frontend, postgres-0
APP_URL=$(gh variable get APP_URL -R LakshyaBagani/Devops-StockPilot)
curl -fsS "$APP_URL/api/version" | jq -r .git_sha    # the same SHA as the next line
gh api repos/LakshyaBagani/Devops-StockPilot/commits/main --jq .sha
kubectl -n default get job stockpilot-loadgen        # Error from server (NotFound): no load running
kubectl get ns stockpilot-lab                        # Error from server (NotFound): no lab left over
```

Prometheus and Grafana, through port-forwards (ports that never clash with Compose):

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 19090:9090 >/dev/null & sleep 3
curl -s 'localhost:19090/api/v1/targets?state=active' | jq '[.data.activeTargets[] | select(.health != "up")] | length'   # 0: no target down
kill %1
```

Grafana at http://localhost:13000/d/stockpilot-overview loads the core panels: 1 requests/s,
2 p95 latency, 3 5xx ratio, 5 backend replicas, 6 CPU used/requested, 7 running image tag and
9 planner p95 vs replicas.

Then warm the pipeline on `main` (with the cluster up, this run also redeploys the same commit):

```bash
gh workflow run ci-cd.yml -R LakshyaBagani/Devops-StockPilot --ref main; sleep 5
RUN=$(gh run list -R LakshyaBagani/Devops-StockPilot --workflow ci-cd.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" -R LakshyaBagani/Devops-StockPilot --exit-status
```

**If the strict Trivy gate turns red** (a new CVE in a pinned base since the last run): fix it as one
pull request labelled `post-submission-security`, using the first rung of the remediation ladder in
`.trivyignore` that clears it: base-digest bump, then dependency pin bump, then a targeted
`apk add --no-cache --upgrade` in the runtime stage, and only for an unfixed CVE a dated
`.trivyignore` entry with a reason and an owner. Merge it once its run is green and note it in the
README. Never disable or weaken the gate or edit the workflow during the demo; the `submission-v1` tag
never moves.

## The demo (about 10 minutes)

### 1. The product (1.5 min)

1. Open `$APP_URL`: the Stock page with 40 products and the one-line summary.
2. On **Reynolds pen (blue)**, press Record, choose OUT, quantity 20, submit. The toast reads
   `Reynolds pen (blue) −20 → N left`, on hand drops and the days-of-cover bar turns from green to
   amber: about 15 days of cover becomes about 12, below two lead times of 7 days. Undo it from the
   toast (or Ledger → Undo → Confirm undo) and the bar is green again.
3. Record an OUT larger than the stock on hand: the sheet shows
   `Insufficient stock: on hand N, requested M` inline (HTTP 422) and nothing is written.
4. In `$APP_URL/api/docs`, create a throwaway product with the example body (SKU `DEMO-001`), update
   its name, then delete it: 201, 200, 204.
5. Point at the footer: `StockPilot v1.0.0 · ui sha7 · api sha7`, both equal to `main`.

### 2. The architecture (1 min)

The diagram in the [README](../README.md#3-architecture), then, in terminal 1:

```bash
kubectl get nodes -o wide
kubectl -n stockpilot get deploy,pods,svc,ingress,hpa
helm list -A
```

### 3. The commit (30 s)

Apply the prepared change to `frontend/src/config.js`, then in terminal 2:

```bash
git commit -am "feat(ui): Diwali rush preset for the reorder planner"
make gitleaks          # must report no leaks before any push to main
git push origin main   # as the repository admin; GitHub prints "Bypassed rule violations", as expected
```

### 4. While the pipeline runs (6–8 min)

In the Actions tab, follow the run:

- `backend` (ruff, the Alembic round-trip, pytest on a PostgreSQL 18 service), `frontend` (lint,
  `node:test`, build) and `secrets` (gitleaks) run in parallel, with `iac` and the advisory
  `config-scan`;
- the `image` matrix builds both images and runs **Trivy gate (HIGH/CRITICAL, strict)**: open its
  table to show 0 findings, then the push to GHCR with the full SHA and `sha-` tags;
- `deploy` waits for `image` and `iac`, assumes the AWS role through OIDC, runs `helm upgrade`.

Meanwhile, show the new tags on the GHCR package pages, the Terraform files and the VPC and EKS
console screenshots (`m7-02`, `m7-03`).

### 5. Scale-out, in parallel with step 4

```bash
make loadtest                                          # terminal 2: checks a seeded plan answers, then starts the load Job
kubectl -n stockpilot get hpa stockpilot-backend -w    # terminal 1: replicas go from 2 to 5
```

In Grafana: requests/s (panel 1) rising, **planner p95 falling as the replica line rises** (panel 9),
CPU used/requested crossing the 60% target (panel 6), and backend replicas (panel 5).

*Conditional (B87): only when the dashboard ships panels 8 and 10, which this build does (11 panels).*
Record and undo a few movements in the UI, and try one oversized OUT, so the Stock movements (panel 8)
and Rejected OUTs and undos (panel 10) panels move. With the 7-panel core dashboard, skip this: panels
1, 2 and 9 move from the load alone.

### 6. The deploy lands

```bash
kubectl -n stockpilot get jobs,pods -w           # the pre-upgrade migrate Job runs (no new migration), then the rolling update
helm history stockpilot -n stockpilot --max 3    # APP VERSION is the new sha7; DESCRIPTION reads "deploy sha7 run id"
```

- The Running image tag panel (7) flips to the new SHA.
- Refresh the app: the **Diwali rush +40%** chip and the subtitle "Diwali stock check 2026" appear, and
  both footer SHAs equal the new commit.
- Run the planner with the Diwali chip: the stock-out risks rise against the 0% surge plan.
- `make loadtest-stop` (the HPA settles back to 2 replicas within about a minute and a half).

### 7. Failure lab (1 min)

*Conditional (B88): the troubleshooting labs are an optional extra. They are in this repository
([troubleshooting/RUNBOOK.md](../troubleshooting/RUNBOOK.md), lab t2), so run this step when time
allows; otherwise go to step 8.* Everything stays in the throwaway namespace `stockpilot-lab`, which
must be created first:

```bash
kubectl create ns stockpilot-lab
kubectl -n stockpilot-lab apply -f troubleshooting/t2-selector-mismatch.yaml
kubectl -n stockpilot-lab rollout status deploy/lab-api-t2 --timeout=120s
kubectl -n stockpilot-lab get endpointslices -l kubernetes.io/service-name=lab-api-t2   # no endpoints
kubectl -n stockpilot-lab get svc lab-api-t2 -o jsonpath='{.spec.selector}{"\n"}'      # app=lab-api-v2
kubectl -n stockpilot-lab get pods -l scenario=t2 --show-labels                         # app=lab-api
kubectl -n stockpilot-lab patch svc lab-api-t2 --type merge -p '{"spec":{"selector":{"app":"lab-api"}}}'
kubectl -n stockpilot-lab get endpointslices -l kubernetes.io/service-name=lab-api-t2   # the pod IP appears
kubectl delete ns stockpilot-lab --wait
```

### 8. Close (30 s)

The decisions behind the build, one sentence each:

- Traefik, because the community ingress-nginx controller is retired ([ADR-0002](adr/0002-traefik-ingress.md)).
- GitHub OIDC: the pipeline holds no AWS keys ([ADR-0003](adr/0003-github-oidc-deploy.md)).
- Every action pinned by SHA after the March 2026 trivy-action compromise ([ADR-0006](adr/0006-sha-pinned-actions.md)).
- Cost: about $0.30 per hour while up, a typed APPLY gate, a $10 budget, and a destroy the same day.

## After the demo (same day)

```bash
make loadtest-stop     # if still running
make eks-down          # sets DEPLOY_ENABLED=false, ordered teardown, terraform destroy (type yes), sweep
make leftovers         # exit 0: nothing billable left in any region
```

Record the spend from the Billing console (month to date) for the README.

## Fallbacks

| If | Then |
|---|---|
| Wi-Fi or AWS fails | Play the rehearsal video. Show the app on Compose (`make up`, then `make seed`, http://localhost:3000) and the kind records in `docs/evidence/kind/terminal/` |
| The pipeline is slow | Narrate the job graph and the Trivy table; the deploy job's step summary shows the rollout |
| The HPA does not move | `kubectl -n stockpilot top pods`; `make loadtest` refuses to start without a seeded plan, so seed first |
| The pen does not turn amber on OUT 20 | Run the `--demo-reset` line from [before the slot](#before-the-slot), then repeat |
| Helm reports another operation in progress | `helm history stockpilot -n stockpilot`, then roll back to the last deployed revision as in [RUNBOOK §6](../troubleshooting/RUNBOOK.md#6-helm-recovery); never a bare `helm rollback` |
| The admin push is rejected | Check that branch protection still allows admins to bypass (`enforce_admins` false) |

## Rehearsal record

The rehearsal is the same script on the cluster the day before, with the same commit pushed as the
repository admin. It is screen-recorded as the backup video, then reverted through a `revert(ui): …`
pull request, before the `submission-v1` tag is created.

- Rehearsal date, total duration and pipeline duration (push to deploy green): added after the EKS
  rehearsal. Targets: the pipeline in at most 8 minutes with warm caches, the whole demo in at most
  10 minutes.
