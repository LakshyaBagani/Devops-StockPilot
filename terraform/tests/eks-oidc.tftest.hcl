# The early OIDC check (make eks-oidc) and the first full plan after it, offline. Providers are
# mocked, so the apply below only fills the test's in-memory state.
#
# make tf-check also counts the planned creates (B65): eks_oidc_existing_provider 2,
# eks_oidc 3 (the IAM-only apply has no EKS, VPC or NAT address), eks_plan_after_oidc 62.
# The runs share one state, so their order matters.

mock_provider "aws" {
  source = "./tests/mocks"
}

mock_provider "tls" {}

variables {
  aws_account_id              = "123456789012"
  aws_region                  = "ap-south-1"
  project_name                = "stockpilot"
  cluster_name                = "stockpilot-eks"
  kubernetes_version          = "1.36"
  vpc_cidr                    = "10.0.0.0/16"
  node_instance_types         = ["t3a.large", "t3.large"]
  node_min_size               = 2
  node_desired_size           = 2
  node_max_size               = 3
  github_owner                = "LakshyaBagani"
  github_repo                 = "Devops-StockPilot"
  github_owner_id             = "11111111"
  github_repo_id              = "222222222"
  create_github_oidc_provider = true
  enable_github_oidc          = true
  enable_irsa                 = true
}

# The same three -target addresses as make eks-oidc.
run "eks_oidc_existing_provider" {
  command = plan

  variables {
    create_github_oidc_provider = false
  }

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github,
      aws_iam_role.github_actions,
      aws_iam_role_policy.github_actions_eks,
    ]
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "With an existing provider, the targeted apply must not create one."
  }
}

run "eks_oidc" {
  command = plan

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github,
      aws_iam_role.github_actions,
      aws_iam_role_policy.github_actions_eks,
    ]
  }

  assert {
    condition     = aws_iam_role.github_actions[0].name == "stockpilot-gha-deploy"
    error_message = "The targeted apply must create the role stockpilot-gha-deploy."
  }
}

run "eks_oidc_apply" {
  command = apply

  plan_options {
    target = [
      aws_iam_openid_connect_provider.github,
      aws_iam_role.github_actions,
      aws_iam_role_policy.github_actions_eks,
    ]
  }
}

# make eks-plan in P9, once the IAM resources exist.
run "eks_plan_after_oidc" {
  command = plan

  assert {
    condition     = length(module.eks.eks_managed_node_groups) == 1
    error_message = "The full plan must add the cluster and its node group."
  }
}
