# The chart's contract with CI, the platform and the docs, checked by make helm-check.
# Input: every object that
#   helm template stockpilot helm/stockpilot -n stockpilot -f values.yaml -f values-<overlay>.yaml \
#     --api-versions monitoring.coreos.com/v1/ServiceMonitor
# renders, as one JSON array (yq ea -o=json '[.]'). Prints one line per check, then fails with
# "chart contract failed" if any check failed. Run it with jq -r.

def objects(kind): map(select(.kind == kind));
def named(kind; name): objects(kind) | map(select(.metadata.name == name));
def check(name; got; want): {name: name, got: got, want: want, ok: (got == want)};

[
  check("0 Secrets (all Secrets are created out of band)"; objects("Secret") | length; 0),
  check("1 ServiceMonitor"; objects("ServiceMonitor") | length; 1),
  check("1 HPA"; objects("HorizontalPodAutoscaler") | length; 1),
  check("2 PDBs"; objects("PodDisruptionBudget") | length; 2),
  check("2 ConfigMaps (backend config, dashboard)"; objects("ConfigMap") | length; 2),
  check("Services stockpilot-backend, -frontend, -postgres";
    objects("Service") | map(.metadata.name) | sort;
    ["stockpilot-backend", "stockpilot-frontend", "stockpilot-postgres"]),
  check("1 Ingress with class traefik"; objects("Ingress") | map(.spec.ingressClassName); ["traefik"]),
  check("Ingress /api -> backend port name http, / -> frontend port 80";
    [objects("Ingress")[].spec.rules[].http.paths[]
      | "\(.path) -> \(.backend.service.name):\(.backend.service.port.name // .backend.service.port.number)"];
    ["/api -> stockpilot-backend:http", "/ -> stockpilot-frontend:80"]),
  check("1 migrate hook Job, post-install,pre-upgrade";
    [objects("Job")[] | .metadata.annotations["helm.sh/hook"]]; ["post-install,pre-upgrade"]),
  check("backend Deployment renders no replicas (the HPA owns them)";
    named("Deployment"; "stockpilot-backend") | map(.spec | has("replicas")); [false]),
  check("no image is :latest or untagged";
    [.. | objects | .image? | strings | select(test(":latest$") or (test(":[^/]+$") | not))]; []),
  check("ConfigMap: PLANNER_MAX_WORK 4000000, PLANNER_QUEUE_TIMEOUT_S 30, no APP_VERSION";
    named("ConfigMap"; "stockpilot-backend-config")
      | map(.data | [.PLANNER_MAX_WORK, .PLANNER_QUEUE_TIMEOUT_S, has("APP_VERSION")]);
    [["4000000", "30", false]])
]
| (.[] | if .ok then "ok    \(.name)" else "FAIL  \(.name): got \(.got | tojson), want \(.want | tojson)" end),
  (if all(.[]; .ok) then empty else error("chart contract failed") end)
