# Evidence screenshots, mapped to the grading rubric

Every "What to Submit" item of GRADING.md and the file that proves it. Files named `m7-*` to `m9-*`
were captured on the real AWS EKS cluster `spilot-eks` (ap-southeast-2); the `kind/terminal/`
transcripts are the local kind rehearsal. The narrated walkthrough video is
[`demo/presentation.mp4`](../../demo/presentation.mp4) ([watch in the browser](https://lakshyabagani.github.io/Devops-StockPilot/demo/)), and
[`00-video-thumbnail.png`](00-video-thumbnail.png) is its poster frame.

| Module | What to Submit (../../GRADING.md) | Evidence | Status |
|---|---|---|---|
| M1 | `backend/app/`: Python sources | [`backend/app/`](../../backend/app/) (models, schemas, routers, services, database config) | In repo |
| M1 | `backend/alembic/versions/`: a migration | [`0001_initial.py`](../../backend/alembic/versions/0001_initial.py) | In repo |
| M1 | `backend/requirements.txt` | [`backend/requirements.txt`](../../backend/requirements.txt) | In repo |
| M1 | `frontend/`: frontend sources | [`frontend/`](../../frontend/) | In repo |
| M1 | `docker-compose.yml` | [`docker-compose.yml`](../../docker-compose.yml) | In repo |
| M1 | Screenshot of the running app in the browser | [`m1-03-ui-desktop-3000.png`](m1-03-ui-desktop-3000.png), [`m1-04-ui-mobile-3000.png`](m1-04-ui-mobile-3000.png) | Captured |
| M1 | (../../supporting) Swagger UI with every endpoint | [`m1-01-swagger-api-docs.png`](m1-01-swagger-api-docs.png) | Captured |
| M1 | (../../supporting) `/health` answers | [transcript](terminal/m1-02-health-curl.txt); [`m1-02-health-curl.png`](m1-02-health-curl.png) | Captured |
| M1 | (../../supporting) Alembic history and the tables | [transcript](terminal/m1-05-alembic-history-psql-dt.txt); [`m1-05-alembic-history-psql-dt.png`](m1-05-alembic-history-psql-dt.png) | Captured |
| M2 | `backend/tests/` | [`backend/tests/`](../../backend/tests/) | In repo |
| M2 | `backend/pytest.ini` or `backend/conftest.py` | [`pytest.ini`](../../backend/pytest.ini), [`conftest.py`](../../backend/conftest.py) | In repo |
| M2 | Terminal screenshot of `pytest -v` passing | [`m2-01-pytest-v.png`](m2-01-pytest-v.png), from `make test-pg` on the final `main` | Captured |
| M3 | GitHub repository URL | <https://github.com/LakshyaBagani/Devops-StockPilot> | Done |
| M3 | Commit history screenshot (at least 10 commits) | [`m3-01-commits.png`](m3-01-commits.png) (12 conventional commits) | Captured |
| M3 | (../../supporting) `.gitignore` covers `.env`, `__pycache__`, `node_modules`, `.venv` | [transcript](terminal/m3-02-gitignore.txt); [`m3-02-gitignore.png`](m3-02-gitignore.png) | Captured |
| M4 | `backend/Dockerfile` | [`backend/Dockerfile`](../../backend/Dockerfile) | In repo |
| M4 | `frontend/Dockerfile` | [`frontend/Dockerfile`](../../frontend/Dockerfile) | In repo |
| M4 | `docker-compose.yml` | [`docker-compose.yml`](../../docker-compose.yml) | In repo |
| M4 | Terminal screenshot of `docker compose up --build` | [transcript](terminal/m4-01-compose-up-build.txt) and [`compose ps`](terminal/m4-02-compose-ps.txt); [`m4-01-compose-up-build.png`](m4-01-compose-up-build.png), [`m4-02-compose-ps.png`](m4-02-compose-ps.png) | Captured |
| M4 | Browser at http://localhost:3000 | [`m4-03-browser-localhost-3000.png`](m4-03-browser-localhost-3000.png) | Captured |
| M4 | (../../supporting) Both images run as non-root | [transcript](terminal/m4-04-nonroot-id.txt); [`m4-04-nonroot-id.png`](m4-04-nonroot-id.png) | Captured |
| M4 | (../../supporting) The backend image builds | [transcript](terminal/m4-05-docker-build-backend.txt); [`m4-05-docker-build-backend.png`](m4-05-docker-build-backend.png) | Captured |
| M5 | `.github/workflows/` | [`ci-cd.yml`](../../.github/workflows/ci-cd.yml), [`whoami.yml`](../../.github/workflows/whoami.yml) | In repo |
| M5 | Actions run URL of a green pipeline | Run URL and [`m5-01-green-run.png`](m5-01-green-run.png) (the push run whose deploy is green) | Captured |
| M5 | GHCR package pages with SHA tags | [`m5-03-ghcr-backend-tags.png`](m5-03-ghcr-backend-tags.png), [`m5-04-ghcr-frontend-tags.png`](m5-04-ghcr-frontend-tags.png) | Captured |
| M5 | (../../supporting) A failing test blocks the images (../../PR-A) | [`m5-02-pr-a-red.png`](m5-02-pr-a-red.png) and the PR-A link | Captured |
| M6 | Trivy scan step in the workflow | Step "Trivy gate (HIGH/CRITICAL, strict)" in [`ci-cd.yml`](../../.github/workflows/ci-cd.yml) | In repo |
| M6 | Screenshot of the Trivy output from a pipeline run | [`m6-01-trivy-backend.png`](m6-01-trivy-backend.png), [`m6-02-trivy-frontend.png`](m6-02-trivy-frontend.png); the red gate [`m6-03-pr-b-red.png`](m6-03-pr-b-red.png) | Captured |
| M6 | 2–3 sentences on what Trivy scanned and the result | [Security scan explained](../../README.md#security-scan-explained) | In repo |
| M7 | `terraform/`: all `.tf` files | [`terraform/`](../../terraform/) | In repo |
| M7 | `terraform plan` output screenshot | [`m7-00-init-fmt-validate.png`](m7-00-init-fmt-validate.png), [`m7-01-plan.png`](m7-01-plan.png) (Plan: 59 to add) | Done |
| M7 | AWS Console with the VPC and the EKS cluster | Console: [`m7-02c-console-vpc-resource-map.png`](m7-02c-console-vpc-resource-map.png) (VPC resource map: 4 subnets, route tables, IGW, NAT), [`m7-03c-console-eks-cluster.png`](m7-03c-console-eks-cluster.png) (EKS 1.36 Active), [`m7-03d-console-eks-networking.png`](m7-03d-console-eks-networking.png) (cluster in our VPC), [`m7-02b-console-vpc.png`](m7-02b-console-vpc.png), [`m7-03b-console-eks.png`](m7-03b-console-eks.png) (node group); CLI: [`m7-02-vpc-public-subnets.png`](m7-02-vpc-public-subnets.png), [`m7-03-eks-cluster-nodegroup.png`](m7-03-eks-cluster-nodegroup.png) | Done (EKS `spilot-eks`, ap-southeast-2) |
| M7 | `terraform destroy` completion | [`m7-04-destroy.png`](m7-04-destroy.png) (Destroy complete! Resources: 59 destroyed), [`m7-04b-no-leftovers.png`](m7-04b-no-leftovers.png) | Done |
| M7 | (../../supporting) `terraform.tfvars.example`, no credentials in Git | [`terraform.tfvars.example`](../../terraform/terraform.tfvars.example); [`m7-05-gitleaks-full-history.png`](m7-05-gitleaks-full-history.png); [`m7-06-gitleaks-local.png`](m7-06-gitleaks-local.png) | Done |
| M8 | `k8s/`: namespace and bootstrap manifests | [`k8s/`](../../k8s/) | In repo |
| M8 | `helm/`: the chart | [`helm/stockpilot/`](../../helm/stockpilot/) | In repo |
| M8 | `kubectl get pods` with every pod Running | kind: [transcript](kind/terminal/m8-01-pods.txt); EKS: [`m8-01-pods.png`](m8-01-pods.png) | Done |
| M8 | `kubectl get svc` | kind: [transcript](kind/terminal/m8-02-svc.txt); EKS: [`m8-02-svc.png`](m8-02-svc.png) | Done |
| M8 | `helm list` | kind: [transcript](kind/terminal/m8-03-helm-list.txt); EKS: [`m8-03-helm-list.png`](m8-03-helm-list.png) | Done |
| M8 | Browser through the Ingress or load balancer | [`m8-04b-app-eks-sidebar.png`](m8-04b-app-eks-sidebar.png), [`m8-04-ingress-browser.png`](m8-04-ingress-browser.png) | Done |
| M8 | (../../supporting) `k8s/namespace.yaml` applies cleanly | [`m8-00-namespace-apply.png`](m8-00-namespace-apply.png) | Done |
| M8 | (../../supporting) HPA scale-out 2 → 5 → 2 | kind: [transcript](kind/terminal/m8-05-hpa-scaleout.txt); EKS: [`m8-05-hpa-scaleout.png`](m8-05-hpa-scaleout.png) (2 → 3 → 5 under planner load) | Done |
| M8 | (../../supporting) Ingress rules, `/api` answered by uvicorn | kind: [transcript](kind/terminal/m8-06-ingress-rules.txt); EKS: [`m8-06-ingress-rules.png`](m8-06-ingress-rules.png) | Done |
| M8 | (../../supporting) The CI deploy job's `helm upgrade` and smoke test | [`m8-07-deploy-job-log.png`](m8-07-deploy-job-log.png) | Done |
| M9 | `monitoring/`: Prometheus and Grafana values | [`monitoring/`](../../monitoring/) | In repo |
| M9 | `curl` of the backend's `/metrics` | kind: [transcript](kind/terminal/m9-01-metrics-curl.txt); EKS: [`m9-01-metrics-curl.png`](m9-01-metrics-curl.png) | Done |
| M9 | Prometheus Targets page with the app UP | kind: [transcript](kind/terminal/m9-02-targets-up.txt); EKS: [`m9-02-targets-up.png`](m9-02-targets-up.png) (5/5 UP), [`m9-02b-up-query.png`](m9-02b-up-query.png) | Done |
| M9 | Grafana dashboard with a populated panel | [`m9-03-grafana.png`](m9-03-grafana.png) | Done |
| M9 | (../../supporting) The monitoring release and its pods | kind: [transcript](kind/terminal/m9-00-monitoring-pods.txt); EKS: [`m9-00-monitoring-pods.png`](m9-00-monitoring-pods.png) | Done |
| M10 | `README.md` in the repository root | This file | In repo |
| M10 | Live demo, or a recorded walkthrough | **[Walkthrough video](https://lakshyabagani.github.io/Devops-StockPilot/demo/)** ([`demo/presentation.mp4`](../../demo/presentation.mp4), 11 min 10 s, ending with a live commit `85a8df9` pushed through the pipeline to EKS), [`m10-01-live-change-diwali.png`](m10-01-live-change-diwali.png), [docs/demo-script.md](../../docs/demo-script.md) | Done |
