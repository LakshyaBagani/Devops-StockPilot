################################################################################
# GitHub Actions -> AWS through OIDC: no long-lived keys in GitHub.
#
# Nothing in this file may reference the eks or vpc modules. make eks-oidc applies only the
# three IAM addresses below (-target), before any cluster exists, and such a reference would
# pull billable resources into that targeted apply.
################################################################################

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # No thumbprint_list: IAM validates GitHub's certificate against its own trusted CAs.
}

# An account holds one provider per URL; reuse it when it already exists.
data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  # The deploy and whoami jobs declare this environment, and its branch policy allows only main.
  github_environment = "production"

  # Exact subjects, no wildcards: this role is cluster-admin. Repos created (or renamed or
  # transferred) after 2026-07-15 send the immutable form; older ones send the legacy form.
  github_subjects = [
    "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:environment:${local.github_environment}",
    "repo:${var.github_owner}/${var.github_repo}:environment:${local.github_environment}",
  ]

  # Built from variables, not the eks module's cluster_arn output, so the role can exist before
  # the cluster.
  eks_cluster_arn = "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/${var.cluster_name}"
}

data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringLike with no wildcard behaves like StringEquals; it is case-sensitive.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name                 = "${var.project_name}-gha-deploy"
  description          = "GitHub Actions deploy role for ${var.github_owner}/${var.github_repo} (environment ${local.github_environment})"
  assume_role_policy   = data.aws_iam_policy_document.github_actions_trust.json
  max_session_duration = 3600
}

# The only AWS permission the deploy job needs, for aws eks update-kubeconfig.
# Its Kubernetes rights come from the access entry in main.tf.
data "aws_iam_policy_document" "github_actions_eks" {
  statement {
    effect    = "Allow"
    actions   = ["eks:DescribeCluster"]
    resources = [local.eks_cluster_arn]
  }
}

resource "aws_iam_role_policy" "github_actions_eks" {
  name   = "eks-describe-cluster"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_eks.json
}
