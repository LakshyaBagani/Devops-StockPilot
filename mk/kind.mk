# kind cluster, Helm chart checks and evidence (K8 layer). The scripts pin every kubectl and helm
# call to context kind-stockpilot (evidence.sh ENV=eks uses the EKS context instead).

SKIP_BUILD      ?= 0
HELM_EXTRA_ARGS ?=
ENV             ?= kind
MODULE          ?= all

CHART     := helm/stockpilot
DASHBOARD := $(CHART)/dashboards/stockpilot.json
SM_API    := monitoring.coreos.com/v1/ServiceMonitor

# The core panels (1,2,3,5,6,7,9) are present, ids are unique, the panel/target counts are those
# of the MSP core (7/10) or the full set (11/17), and $datasource is the only datasource.
# A variable, not recipe text: make joins these lines, but keeps backslash-newlines in a recipe's quotes.
DASHBOARD_CHECK = ([.panels[].id] | ([1,2,3,5,6,7,9] - . == []) and ((unique | length) == length)) \
  and ([(.panels | length), ([.panels[].targets[]] | length)] | . == [7,10] or . == [11,17]) \
  and .uid == "stockpilot-overview" and (has("__inputs") | not) \
  and ([.. | objects | select(has("datasource")) | .datasource.uid] | unique == ["$${datasource}"])

# kind-deploy hands TAG (default dev-<sha7>) to the script, except with SKIP_BUILD=1 and no TAG of
# your own: the script then reuses the deployed release's tag and gitSha.
KIND_TAG = $(if $(and $(filter 1,$(SKIP_BUILD)),$(filter file,$(origin TAG))),,$(TAG))

.PHONY: kind-up kind-deploy kind-down helm-check evidence

kind-up: ## kind cluster + namespaces, Secrets, metrics-server, Traefik, monitoring (no app)
	scripts/kind-up.sh all

kind-deploy: ## Build, kind load, helm upgrade, test, seed, smoke (TAG= SKIP_BUILD=1 HELM_EXTRA_ARGS=)
	TAG='$(KIND_TAG)' SKIP_BUILD='$(SKIP_BUILD)' HELM_EXTRA_ARGS='$(HELM_EXTRA_ARGS)' scripts/kind-up.sh app

kind-down: ## Delete the kind cluster and its kube context
	scripts/kind-down.sh

helm-check: ## Lint the chart, assert its contract for kind and EKS, and check the dashboard JSON
	@for overlay in kind eks; do \
	  helm lint --strict $(CHART) -f $(CHART)/values.yaml -f $(CHART)/values-$$overlay.yaml; \
	done
	@for overlay in kind eks; do \
	  echo "== chart contract: $$overlay overlay, with the ServiceMonitor CRD"; \
	  helm template stockpilot $(CHART) -n stockpilot -f $(CHART)/values.yaml -f $(CHART)/values-$$overlay.yaml \
	    --api-versions $(SM_API) | yq ea -o=json -I=0 '[.]' | jq -r -f helm/chart-contract.jq; \
	done
	@echo "== without the CRD"; \
	n=$$(helm template stockpilot $(CHART) -n stockpilot -f $(CHART)/values.yaml -f $(CHART)/values-eks.yaml \
	  | yq ea '[.] | map(select(.kind == "ServiceMonitor")) | length'); \
	if [ "$$n" = 0 ]; then echo "ok    0 ServiceMonitors"; else echo "FAIL  $$n ServiceMonitor(s)"; exit 1; fi
	@echo "== dashboard $(DASHBOARD): [uid, schemaVersion, panels, targets]"; \
	jq -c '[.uid, .schemaVersion, (.panels | length), ([.panels[].targets[]] | length)]' $(DASHBOARD); \
	if jq -e '$(DASHBOARD_CHECK)' $(DASHBOARD) >/dev/null; then \
	  echo "ok    core panels present, unique ids, counts as shipped, one datasource variable"; \
	else echo "FAIL  dashboard structure"; exit 1; fi

evidence: ## Run the M8/M9 evidence commands with their output (ENV=kind|eks MODULE=m8|m9|all)
	scripts/evidence.sh $(ENV) $(MODULE)
