# Mock data for the aws provider, shared by every tests/*.tftest.hcl file through
# mock_provider "aws" { source = "./tests/mocks" }. No AWS API is ever called.

mock_data "aws_availability_zones" {
  defaults = {
    names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
  }
}

mock_data "aws_partition" {
  defaults = {
    partition  = "aws"
    dns_suffix = "amazonaws.com"
  }
}

# The eks module passes this arn to aws_iam_session_context, which validates it even when mocked.
mock_data "aws_caller_identity" {
  defaults = {
    account_id = "123456789012"
    arn        = "arn:aws:iam::123456789012:user/student"
  }
}

mock_data "aws_iam_session_context" {
  defaults = {
    issuer_arn = "arn:aws:iam::123456789012:user/student"
  }
}

mock_data "aws_iam_policy_document" {
  defaults = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

mock_data "aws_eks_addon_version" {
  defaults = {
    version = "v1.0.0-eksbuild.1"
  }
}

# Used once a run applies the role (tests/eks-oidc.tftest.hcl): the EKS access entry validates
# its principal_arn.
mock_resource "aws_iam_role" {
  defaults = {
    arn = "arn:aws:iam::123456789012:role/stockpilot-gha-deploy"
  }
}
