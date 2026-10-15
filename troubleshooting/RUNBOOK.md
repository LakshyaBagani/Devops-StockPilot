# StockPilot operations runbook

Three failure labs, a diagnosis toolkit, Helm recovery and the known failure modes of this stack.
It works the same on kind (context `kind-stockpilot`) and EKS (context `stockpilot-eks`).

| Section | What it covers |
|---|---|
| [0. Safety](#0-safety) | Rules to read before typing anything |
| [1. Setup](#1-setup) | The lab namespace |
| [2. Toolkit](#2-toolkit) | Diagnosis commands |
| [3. Lab t1](#3-lab-t1-wrong-image-tag) | Wrong image tag: `ImagePullBackOff` |
| [4. Lab t2](#4-lab-t2-service-selector-mismatch) | Service selector mismatch: no endpoints |
| [5. Lab t3](#5-lab-t3-readiness-probe-on-the-wrong-path) | Readiness probe on the wrong path: `0/1 Ready` |
| [6. Helm recovery](#6-helm-recovery) | Stuck or failed releases |
| [7. Known failure modes](#7-known-failure-modes) | Symptom, check, fix |
| [8. Cleanup](#8-cleanup) | Removing the labs |

## 0. Safety

- **Check the context first.** `kubectl config current-context` must print `kind-stockpilot` for a
  rehearsal or `stockpilot-eks` for the cloud. A stray EKS context means paid side effects. Switch
  with `kubectl config use-context kind-stockpilot`.
- **Labs run only in `stockpilot-lab`.** Every lab object pins that namespace, and every lab command
  below carries `-n stockpilot-lab`. A lab in `stockpilot` would break the graded "all pods
  Running" view.
- **Never `kubectl edit`, `patch`, `scale` or `set image` a Helm-owned object in `stockpilot`.** The
  next `helm upgrade` then hits server-side-apply field conflicts, and the HPA owns the backend
  replica count. Change the chart or its values and redeploy (`make kind-deploy` on kind, a merge to
  `main` on EKS).
- **Never show a password** in a screenshot, chat or log. To log in to Grafana, copy the password
  to the clipboard without displaying it (macOS):
  `kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 --decode | pbcopy`.
- The load generator is the Job `stockpilot-loadgen` in namespace `default`. Stop it with
  `make loadtest-stop`.

## 1. Setup

The labs need their own namespace. Create it once, before section 3:

```bash
kubectl create ns stockpilot-lab
```

## 2. Toolkit

Replace `<ns>`, `<pod>`, `<deploy>` and `<svc>`. The graded namespace is `stockpilot`.

```bash
kubectl -n <ns> get pods -o wide                                   # status, restarts, node, pod IP
kubectl -n <ns> describe pod <pod>                                 # events at the bottom: pulls, probes, scheduling
kubectl -n <ns> get events --sort-by=.lastTimestamp                # the namespace's recent history
kubectl -n <ns> get endpointslices -l kubernetes.io/service-name=<svc>   # which pod IPs a Service routes to
kubectl -n <ns> get pods --show-labels                             # compare with the Service selector
kubectl -n <ns> logs <pod> --previous                              # the crashed container's last words
kubectl -n <ns> rollout status deploy/<deploy> --timeout=120s
kubectl -n <ns> rollout history deploy/<deploy>
kubectl -n <ns> top pods                                           # needs metrics-server (the HPA does too)
```

`kubectl get endpoints` still works, but Kubernetes 1.33+ prints a deprecation warning; use
EndpointSlices.

A one-shot probe from inside the cluster. It runs in `stockpilot-lab`, so it never adds a pod to
`stockpilot`; use the Service FQDN to reach another namespace
(`http://stockpilot-backend.stockpilot.svc.cluster.local:8000/health`):

```bash
kubectl -n stockpilot-lab run probe --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 3 http://<svc>
```

## 3. Lab t1: wrong image tag

```bash
kubectl -n stockpilot-lab apply -f troubleshooting/t1-imagepull-wrong-tag.yaml
kubectl -n stockpilot-lab get pods -l scenario=t1 -w        # Ctrl+C once you see ImagePullBackOff
```

**Symptom (within 60 s):** STATUS `ErrImagePull`, then `ImagePullBackOff`; READY `0/1`.

**Diagnose:**

```bash
kubectl -n stockpilot-lab describe pod -l scenario=t1 | grep -E 'Failed|Back-off'
kubectl -n stockpilot-lab get events --sort-by=.lastTimestamp | grep -i pull
```

Key line: `Failed to pull image "nginxinc/nginx-unprivileged:1.30-alpne-slim": ... not found`.
The tag has a typo.

**Fix and verify:**

```bash
kubectl -n stockpilot-lab set image deploy/lab-api-t1 api=nginxinc/nginx-unprivileged:1.30-alpine-slim
kubectl -n stockpilot-lab rollout status deploy/lab-api-t1 --timeout=120s
kubectl -n stockpilot-lab get pods -l scenario=t1            # 1/1 Running
```

**How StockPilot prevents this:** CI deploys only the commit SHA it has just pushed, after the Trivy
gate, so the tag always exists in GHCR. `helm upgrade --rollback-on-failure` returns a release that
cannot become ready to its previous revision.

## 4. Lab t2: Service selector mismatch

```bash
kubectl -n stockpilot-lab apply -f troubleshooting/t2-selector-mismatch.yaml
kubectl -n stockpilot-lab rollout status deploy/lab-api-t2 --timeout=120s
kubectl -n stockpilot-lab get pods -l scenario=t2            # 1/1 Running: the pod itself is fine
```

**Symptom:** the Service has no endpoints, so connections are refused.

```bash
kubectl -n stockpilot-lab get endpointslices -l kubernetes.io/service-name=lab-api-t2   # ENDPOINTS <unset>
kubectl -n stockpilot-lab run probe --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 3 http://lab-api-t2
```

The probe prints `wget: can't connect to remote host (...): Connection refused`.

**Diagnose:** compare the Service selector with the pod labels.

```bash
kubectl -n stockpilot-lab get svc lab-api-t2 -o jsonpath='{.spec.selector}{"\n"}'   # {"app":"lab-api-v2","scenario":"t2"}
kubectl -n stockpilot-lab get pods -l scenario=t2 --show-labels                      # app=lab-api,scenario=t2
```

**Fix and verify:**

```bash
kubectl -n stockpilot-lab patch svc lab-api-t2 --type merge -p '{"spec":{"selector":{"app":"lab-api"}}}'
kubectl -n stockpilot-lab get endpointslices -l kubernetes.io/service-name=lab-api-t2   # now lists the pod IP
kubectl -n stockpilot-lab run probe --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 3 http://lab-api-t2   # nginx HTML
```

**How StockPilot prevents this:** every name and selector in the chart comes from one helper
(`stockpilot.selectorLabels` in `helm/stockpilot/templates/_helpers.tpl`), and `make helm-check`
asserts that the Ingress backends are the Services the chart renders.

## 5. Lab t3: readiness probe on the wrong path

```bash
kubectl -n stockpilot-lab apply -f troubleshooting/t3-readiness-wrong-path.yaml
kubectl -n stockpilot-lab get pods -l scenario=t3            # Running, but READY 0/1
```

**Symptom (within 60 s):** the pod runs but never becomes Ready, so its Service never routes to it.

**Diagnose:**

```bash
kubectl -n stockpilot-lab describe pod -l scenario=t3 | grep -i 'readiness probe failed'
```

Key line: `Readiness probe failed: HTTP probe failed with statuscode: 404`. The probe asks for
`/healthz`, copied from the StockPilot frontend, but stock nginx does not serve that path. A first
`connect: connection refused` failure, from the second before nginx listens, is normal.

**Fix and verify:**

```bash
kubectl -n stockpilot-lab patch deploy lab-api-t3 --type json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n stockpilot-lab rollout status deploy/lab-api-t3 --timeout=120s
kubectl -n stockpilot-lab get pods -l scenario=t3            # 1/1 Running
```

**How StockPilot prevents this:** probes only use paths each image really serves: `/health` and
`/ready` on the backend, `/healthz` on the frontend. `helm test` requests those paths after every
kind deploy, and a release whose pods never become Ready is rolled back.

## 6. Helm recovery

### "another operation (install/upgrade/rollback) is in progress"

A deploy was interrupted (a cancelled CI run, a killed terminal) and left the release in
`pending-install`, `pending-upgrade` or `pending-rollback`. Roll back to the last good revision,
found by status. Never run a bare `helm rollback`: it targets the previous revision, which may be
the broken one.

```bash
helm -n stockpilot history stockpilot
REV=$(helm -n stockpilot history stockpilot -o json | jq -r '[.[] | select(.status=="deployed" or .status=="superseded")] | last | .revision')
echo "rolling back to revision $REV"
helm -n stockpilot rollback stockpilot "$REV" --wait --timeout 5m
helm -n stockpilot status stockpilot | grep STATUS          # STATUS: deployed
```

Then deploy again: `make kind-deploy SKIP_BUILD=1` on kind, or re-run the CI deploy on EKS.

### `pending-install` with no good revision

The first install never finished, so there is nothing to roll back to. Uninstall and deploy again;
the Postgres PVC and the `stockpilot-db` Secret survive an uninstall, so no data is lost:

```bash
helm -n stockpilot uninstall stockpilot --wait
```

### A failed migrate hook

`helm upgrade` fails on the `stockpilot-migrate` hook Job (pre-upgrade). The Job keeps its pod for
10 minutes (`ttlSecondsAfterFinished: 600`):

```bash
kubectl -n stockpilot get jobs
kubectl -n stockpilot logs job/stockpilot-migrate
```

Fix the migration or the database connection, then deploy again. The next deploy deletes the old
hook Job first (`before-hook-creation`).

### The ServiceMonitor is missing

The chart renders it only when the cluster serves the CRD (NOTES prints
`WARNING: ServiceMonitor NOT rendered`). Install monitoring, then deploy again:

```bash
kubectl get crd servicemonitors.monitoring.coreos.com
kubectl -n stockpilot get servicemonitor stockpilot-backend
```

### Drill (kind only)

Practise the recovery: start an upgrade that can never finish, kill the Helm client, and confirm
the stuck state before applying the recipe above.

```bash
kubectl config use-context kind-stockpilot
helm upgrade stockpilot helm/stockpilot -n stockpilot -f helm/stockpilot/values.yaml -f helm/stockpilot/values-kind.yaml --set-string backend.image.tag=does-not-exist --wait --timeout 10m & sleep 15; kill -9 $!
helm -n stockpilot status stockpilot | grep STATUS          # STATUS: pending-upgrade
```

## 7. Known failure modes

| Symptom | Check | Fix |
|---|---|---|
| Pods stuck in `CreateContainerConfigError` | `kubectl -n stockpilot describe pod <pod>` shows `secret "stockpilot-db" not found` | Run `make kind-up` (kind) or `make eks-bootstrap` (EKS): both create the Secret only if it is absent. Then deploy again. |
| `stockpilot-postgres-0` stays `Pending` | `kubectl -n stockpilot get pvc,sc` | The PVC needs a StorageClass: `standard` on kind, the default `ebs-csi-default-sc` (gp3, EBS CSI add-on) on EKS. `values-eks.yaml` leaves the class empty so the default applies. |
| HPA TARGETS shows `<unknown>/60%` | `kubectl -n stockpilot top pods`; `kubectl get apiservice v1beta1.metrics.k8s.io` | metrics-server must be Available (kind installs it with `--kubelet-insecure-tls`; EKS runs the add-on), and every container needs a CPU request. Allow about 2 minutes after a deploy. |
| Target missing in Prometheus | `kubectl -n stockpilot get servicemonitor stockpilot-backend`; Prometheus Status > Target health, filter `stockpilot` | Without the CRD at deploy time the chart skips the ServiceMonitor: deploy again after monitoring is installed. The selector must match the backend Service labels, and the endpoint uses the port name `http`. |
| Frontend returns 502 on `/api` (for example through a port-forward) | `kubectl -n stockpilot get deploy stockpilot-frontend -o jsonpath='{.spec.template.spec.containers[0].env}'` | `API_UPSTREAM` must be the FQDN `stockpilot-backend.stockpilot.svc.cluster.local:8000`: nginx's resolver ignores the search domains. The chart sets it; check for a hand edit. |
| Traefik Service `EXTERNAL-IP` stays `<pending>` on EKS | `kubectl -n traefik describe svc traefik` (events) | `OperationNotPermitted` means the AWS account may not create load balancers yet: open a support case. Otherwise check the `kubernetes.io/role/elb` tags on the public subnets and that each node has exactly one cluster-tagged security group. |
| The backend logs `password authentication failed` after a Secret change | `kubectl -n stockpilot logs deploy/stockpilot-backend` | Postgres reads the password only when it initialises the volume, so never rotate `stockpilot-db` while the PVC exists. Restore the old value, or change it inside Postgres with `ALTER ROLE`. On kind only: uninstall the release and delete the PVC. |
| `ImagePullBackOff` with `toomanyrequests` | `kubectl -n <ns> describe pod <pod>` | Docker Hub's anonymous pull limit (Traefik, Grafana, postgres, busybox and nginx-unprivileged come from Docker Hub). Wait, and avoid repeated cluster rebuilds within an hour. |
| Every deploy warns `would violate PodSecurity "restricted:latest"` for `postgres` | The warning names only the `postgres` container | Expected and documented: the official image starts as root, prepares its data directory, then drops to uid 70. The namespace enforces `baseline`, which allows it. A warning that names any other container is a bug. |

## 8. Cleanup

Delete the lab namespace when you are done. This removes every lab object and leaves `stockpilot`
untouched:

```bash
kubectl delete ns stockpilot-lab --wait
```
