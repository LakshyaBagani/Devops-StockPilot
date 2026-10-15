# Validations reference only their own variable: cross-variable references need Terraform 1.9,
# and the floor is 1.7. The node size ordering is a check block in main.tf instead.

variable "aws_account_id" {
  description = "12-digit id of the AWS account this root may touch (provider allowed_account_ids)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "The aws_account_id must be the 12-digit id printed by: aws sts get-caller-identity --query Account --output text"
  }
}

variable "aws_region" {
  description = "AWS region for every resource."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.aws_region))
    error_message = "The aws_region must be a region code such as ap-south-1."
  }
}

variable "project_name" {
  description = "Short lowercase name that prefixes the VPC and the deploy role (stockpilot-gha-deploy)."
  type        = string
  default     = "stockpilot"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.project_name))
    error_message = "The project_name must be 3-21 characters of a-z, 0-9 and '-', starting with a letter."
  }
}

variable "cluster_name" {
  description = "EKS cluster name. Also the kube context alias, the repo variable EKS_CLUSTER_NAME and the DescribeCluster ARN."
  type        = string
  default     = "stockpilot-eks"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,27}$", var.cluster_name))
    error_message = "The cluster_name must be at most 28 characters (a-z, 0-9, '-'): the eks module uses \"<name>-cluster-\" as an IAM role name_prefix, which is limited to 38 characters."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version, in standard support only."
  type        = string
  default     = "1.36"

  validation {
    condition     = contains(["1.35", "1.36", "1.37"], var.kubernetes_version)
    error_message = "The kubernetes_version must be 1.35, 1.36 or 1.37: the versions in standard support (Oct 2026). 1.31-1.33 bill extended support at $0.60/h."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR. Must be a /16: the subnet maths in main.tf assumes it."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && endswith(var.vpc_cidr, "/16")
    error_message = "The vpc_cidr must be an IPv4 /16 such as 10.0.0.0/16."
  }
}

variable "node_instance_types" {
  description = "Node group instance types. On-demand capacity uses them in list order. Free-plan accounts use [\"m7i-flex.large\"]."
  type        = list(string)
  default     = ["t3a.large", "t3.large"]

  validation {
    condition     = length(var.node_instance_types) > 0
    error_message = "The node_instance_types list must not be empty."
  }

  validation {
    condition = alltrue([
      for t in var.node_instance_types :
      can(regex("^[a-z][a-z0-9-]*[.][a-z0-9]+$", t)) && !can(regex("^([a-z]+[0-9]+g|a1[.])", t))
    ])
    error_message = "Each node_instance_types entry must be an x86_64 instance type such as t3a.large. Graviton (arm64) types need an ARM AMI and arm64 images."
  }
}

variable "node_min_size" {
  description = "Node group minimum size."
  type        = number
  default     = 2

  validation {
    condition     = var.node_min_size >= 1 && var.node_min_size <= 4 && floor(var.node_min_size) == var.node_min_size
    error_message = "The node_min_size must be a whole number from 1 to 4."
  }
}

variable "node_desired_size" {
  description = "Node group desired size. Only honoured when the node group is created; scale later with aws eks update-nodegroup-config."
  type        = number
  default     = 2

  validation {
    condition     = var.node_desired_size >= 1 && var.node_desired_size <= 4 && floor(var.node_desired_size) == var.node_desired_size
    error_message = "The node_desired_size must be a whole number from 1 to 4."
  }
}

variable "node_max_size" {
  description = "Node group maximum size. 4 nodes x 2 vCPU is the 8-vCPU quota floor."
  type        = number
  default     = 3

  validation {
    condition     = var.node_max_size >= 2 && var.node_max_size <= 4 && floor(var.node_max_size) == var.node_max_size
    error_message = "The node_max_size must be a whole number from 2 to 4."
  }
}

variable "github_owner" {
  description = "GitHub owner login, exact case, from: gh api repos/LakshyaBagani/Devops-StockPilot --jq .owner.login"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9-]{1,39}$", var.github_owner))
    error_message = "The github_owner must be a GitHub login (1-39 characters of letters, digits and '-')."
  }

  validation {
    condition     = var.github_owner != "lakshyabagani"
    error_message = "IAM StringLike is case-sensitive: paste the exact login from gh api (LakshyaBagani), never the lowercase GHCR spelling."
  }
}

variable "github_repo" {
  description = "GitHub repository name, exact case, from: gh api repos/LakshyaBagani/Devops-StockPilot --jq .name"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,100}$", var.github_repo))
    error_message = "The github_repo must be a repository name (1-100 characters of letters, digits, '.', '_' and '-')."
  }
}

variable "github_owner_id" {
  description = "Numeric GitHub owner id, from: gh api repos/LakshyaBagani/Devops-StockPilot --jq .owner.id"
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "The github_owner_id must be the numeric owner id from gh api. There is no \"*\" fallback, because this role is cluster-admin."
  }
}

variable "github_repo_id" {
  description = "Numeric GitHub repository id, from: gh api repos/LakshyaBagani/Devops-StockPilot --jq .id"
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repo_id))
    error_message = "The github_repo_id must be the numeric repository id from gh api. There is no \"*\" fallback, because this role is cluster-admin."
  }
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set false when token.actions.githubusercontent.com already exists in the account (one provider per URL)."
  type        = bool
  default     = true
}
