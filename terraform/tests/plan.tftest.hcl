# Offline structural proof of the plan: the aws and tls providers are mocked, so no AWS API
# is ever called. terraform test also loads a local terraform.tfvars, so every variable is set
# here explicitly.
#
# make tf-check also counts the planned creates (B65): 65 in plan_offline (a fresh bring-up),
# 64 in existing_oidc_provider (the GitHub OIDC provider already exists in the account).

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

run "plan_offline" {
  command = plan

  # TF-05: VPC
  assert {
    condition     = module.vpc.public_subnets_cidr_blocks == tolist(["10.0.48.0/24", "10.0.49.0/24"])
    error_message = "Expected public subnets 10.0.48.0/24 and 10.0.49.0/24."
  }

  assert {
    condition     = module.vpc.private_subnets_cidr_blocks == tolist(["10.0.0.0/20", "10.0.16.0/20"])
    error_message = "Expected private subnets 10.0.0.0/20 and 10.0.16.0/20."
  }

  # TF-07: EKS
  assert {
    condition     = length(module.eks.eks_managed_node_groups) == 1
    error_message = "Expected exactly one managed node group."
  }

  assert {
    condition     = contains(keys(module.eks.access_entries), "github_actions") && contains(keys(module.eks.access_entries), "cluster_creator")
    error_message = "Expected access entries for the GitHub Actions role and the cluster creator."
  }

  # TF-06: GitHub OIDC
  assert {
    condition = local.github_subjects == [
      "repo:LakshyaBagani@11111111/Devops-StockPilot@222222222:environment:production",
      "repo:LakshyaBagani/Devops-StockPilot:environment:production",
    ]
    error_message = "The trusted OIDC subjects must be exactly the immutable and legacy environment:production forms."
  }

  assert {
    condition     = alltrue([for s in local.github_subjects : !strcontains(s, "*")])
    error_message = "No trusted OIDC subject may contain a wildcard."
  }

  assert {
    condition     = local.eks_cluster_arn == "arn:aws:eks:ap-south-1:123456789012:cluster/stockpilot-eks"
    error_message = "The DescribeCluster ARN must be built from the variables."
  }

  assert {
    condition     = aws_iam_role.github_actions[0].name == "stockpilot-gha-deploy"
    error_message = "The deploy role must be named stockpilot-gha-deploy."
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 1
    error_message = "The OIDC provider is created by default."
  }
}

run "existing_oidc_provider" {
  command = plan

  # The ids are still required: there is no wildcard fallback.
  variables {
    create_github_oidc_provider = false
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "The OIDC provider must not be created when it already exists."
  }

  assert {
    condition     = length(data.aws_iam_openid_connect_provider.github) == 1
    error_message = "The existing OIDC provider must be looked up instead."
  }
}

# An account whose SCP denies IAM OIDC providers: no GitHub role, no IRSA provider, and the
# only access entry is the cluster creator's.
run "no_oidc_account" {
  command = plan

  variables {
    enable_github_oidc = false
    enable_irsa        = false
  }

  assert {
    condition     = length(aws_iam_role.github_actions) == 0 && length(aws_iam_openid_connect_provider.github) == 0 && length(data.aws_iam_openid_connect_provider.github) == 0
    error_message = "enable_github_oidc = false must skip the GitHub OIDC provider and deploy role."
  }

  assert {
    condition     = keys(module.eks.access_entries) == ["cluster_creator"]
    error_message = "Without the GitHub role, the cluster creator must be the only access entry."
  }

  assert {
    condition     = module.eks.oidc_provider_arn == null
    error_message = "enable_irsa = false must not create the cluster OIDC provider."
  }
}
