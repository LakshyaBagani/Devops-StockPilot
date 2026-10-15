terraform {
  # 1.7 is the first release with mock_provider, which tests/ uses.
  # Raise the floor to ">= 1.11.0" only if backend.tf is enabled (S3-native state locking).
  required_version = ">= 1.7.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.68" # eks 21.29.0 needs >= 6.59; vpc 6.7.3 needs >= 6.28
    }
  }
}

# Credentials come only from AWS_PROFILE=stockpilot (laptop). CI runs init -backend=false,
# validate and test, none of which authenticate.
provider "aws" {
  region = var.aws_region

  # Plan, apply and destroy refuse to run against any other account, e.g. a wrong AWS_PROFILE.
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
