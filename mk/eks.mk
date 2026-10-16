# Terraform and the EKS lifecycle.
#
# You run eks-oidc, eks-up and eks-down yourself, in your own terminal: each refuses to start
# without a TTY and stops at an answer you type (yes, APPLY, yes). Nothing can pass that answer
# from a variable or a pipe. tf-check, eks-preflight, eks-plan and leftovers change nothing in
# AWS; eks-bootstrap is idempotent.

TF := terraform -chdir=terraform

AWS_TARGETS := eks-preflight eks-oidc eks-plan eks-up eks-bootstrap eks-down leftovers

# These targets use the stockpilot profile and region, whatever the shell exports. Only the
# deliberate SP_AWS_PROFILE / SP_AWS_REGION pair points them at another project.
SP_AWS_PROFILE ?= stockpilot
SP_AWS_REGION ?= ap-south-1
$(AWS_TARGETS): export AWS_PROFILE := $(SP_AWS_PROFILE)
$(AWS_TARGETS): export AWS_REGION := $(SP_AWS_REGION)
$(AWS_TARGETS): export SP_AWS_PROFILE := $(SP_AWS_PROFILE)
$(AWS_TARGETS): export SP_AWS_REGION := $(SP_AWS_REGION)

.PHONY: tf-check $(AWS_TARGETS)

tf-check: ## Offline Terraform gate: fmt, init (no backend), validate, mocked tests, plan counts
	terraform fmt -check -recursive terraform
	$(TF) init -backend=false -input=false
	$(TF) validate
	$(TF) test
	$(TF) test -json -verbose | jq -rs -f terraform/tests/plan-counts.jq

eks-preflight: ## Read-only AWS readiness checks before eks-oidc, eks-plan and eks-up
	scripts/aws-preflight.sh

eks-oidc: ## P8 early OIDC check: IAM-only apply of the GitHub OIDC provider + deploy role (type yes)
	@[ -t 0 ] || { echo 'eks-oidc must be run by a human in a terminal'; exit 1; }
	@$(MAKE) --no-print-directory eks-preflight
	$(TF) init -input=false
	$(TF) apply -input=false -target=aws_iam_openid_connect_provider.github -target=aws_iam_role.github_actions -target=aws_iam_role_policy.github_actions_eks

eks-plan: eks-preflight ## Read-only full plan saved to terraform/tfplan (evidence m7-00, m7-01)
	$(TF) init -input=false
	terraform fmt -check -recursive terraform
	$(TF) validate
	$(TF) plan -input=false -out tfplan
	@$(TF) show -no-color tfplan | grep -E '^(Plan:|No changes)'
	@$(TF) show -json tfplan | jq -r '"Changes other than create: \([.resource_changes[] | select(.change.actions != ["create"] and .change.actions != ["no-op"] and .change.actions != ["read"])] | length)"'

# A saved plan applies without asking, hence the typed APPLY between plan and apply.
eks-up: ## Billing gate: plan, then apply only after you type APPLY (~$0.30/h from then on)
	@[ -t 0 ] || { echo 'eks-up must be run by a human in a terminal'; exit 1; }
	@$(MAKE) --no-print-directory eks-plan
	@read -r -p 'Creates billable resources (~$$0.30/h). Type APPLY: ' a && [ "$$a" = APPLY ] || { rm -f terraform/tfplan; echo 'Not applied: nothing was created.'; exit 1; }
	$(TF) apply -input=false tfplan
	@rm -f terraform/tfplan
	$$($(TF) output -raw configure_kubectl)
	kubectl --context "$$($(TF) output -raw cluster_name)" get nodes -o wide
	@echo 'Next: make eks-bootstrap'

eks-bootstrap: ## Namespaces, secrets, Traefik + its load balancer, monitoring, repo variables (re-runnable)
	scripts/eks-bootstrap.sh

eks-down: ## Ordered teardown, AWS-side gates, terraform destroy (type yes), leftover sweep
	scripts/eks-teardown.sh

leftovers: ## All-region read-only sweep for anything still billing; exit 1 if something is left
	scripts/aws-leftovers.sh
