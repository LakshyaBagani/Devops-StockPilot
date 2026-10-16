# Proves offline that every variable guard fires: each run overrides one valid base value with
# a bad one and expects exactly that variable's validation to fail. Providers are mocked.

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

run "bad_account_id" {
  command = plan

  variables {
    aws_account_id = "12345"
  }

  expect_failures = [var.aws_account_id]
}

run "extended_support_version" {
  command = plan

  variables {
    kubernetes_version = "1.31"
  }

  expect_failures = [var.kubernetes_version]
}

run "graviton_nodes" {
  command = plan

  variables {
    node_instance_types = ["t4g.large"]
  }

  expect_failures = [var.node_instance_types]
}

run "lowercase_owner" {
  command = plan

  variables {
    github_owner = "lakshyabagani"
  }

  expect_failures = [var.github_owner]
}

run "empty_owner_id" {
  command = plan

  variables {
    github_owner_id = ""
  }

  expect_failures = [var.github_owner_id]
}

run "non_16_cidr" {
  command = plan

  variables {
    vpc_cidr = "10.0.0.0/20"
  }

  expect_failures = [var.vpc_cidr]
}

run "long_cluster_name" {
  command = plan

  variables {
    cluster_name = "stockpilot-eks-0123456789abcd" # 29 characters
  }

  expect_failures = [var.cluster_name]
}
