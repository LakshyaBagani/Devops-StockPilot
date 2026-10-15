# Checks the planned creates of the mocked plan runs against the numbers the runbooks quote
# (B65), so a new or missing resource cannot slip past the human checks at the approval gates.
# make tf-check runs: terraform -chdir=terraform test -json -verbose | jq -rs -f terraform/tests/plan-counts.jq
# Update these numbers, the test comments and terraform/README.md together.
{
  "plan_offline": 65,               # fresh bring-up after a full destroy
  "existing_oidc_provider": 64,     # the same, when the GitHub OIDC provider already exists
  "eks_oidc": 3,                    # make eks-oidc: IAM only, no EKS, VPC or NAT address
  "eks_oidc_existing_provider": 2,  # make eks-oidc with an existing provider
  "eks_plan_after_oidc": 62         # make eks-plan / eks-up in P9, after make eks-oidc
} as $want
| (map(select(.type == "test_plan")
       | {(.["@testrun"]): ([.test_plan.resource_changes[]? | select(.change.actions == ["create"])] | length)})
   | add
   | with_entries(select(.key | in($want)))) as $got
| if $got == $want
  then "planned creates match the runbooks (B65): \($got | tojson)"
  else error("planned creates differ from the runbooks (B65): got \($got | tojson), want \($want | tojson)")
  end
