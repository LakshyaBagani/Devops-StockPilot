data "aws_availability_zones" "available" {
  state = "available"

  # Skip opt-in Local Zones: the EKS control plane cannot use them.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

################################################################################
# VPC: 2 public /24 + 2 private /20 subnets in 2 AZs, one NAT gateway
################################################################################

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = "${var.project_name}-vpc"
  cidr = var.vpc_cidr
  azs  = local.azs

  # /20 private subnets leave room for the /28 blocks of VPC CNI prefix delegation.
  private_subnets = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]      # 10.0.0.0/20, 10.0.16.0/20
  public_subnets  = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 48)] # 10.0.48.0/24, 10.0.49.0/24

  # One NAT for both AZs: the private nodes need egress (GHCR pulls), and a second NAT only adds cost.
  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  # The elb tag lets the Classic LB of the Traefik Service find the public subnets.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
}

################################################################################
# EKS: control plane, add-ons, managed node group, access entries
################################################################################

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.29.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  # IRSA is unused (Pod Identity); off where the SCP denies OIDC providers.
  enable_irsa = var.enable_irsa

  # The laptop and GitHub-hosted runners reach the API over the internet; access stays IAM-authenticated.
  endpoint_public_access = true

  # STANDARD avoids the $0.60/h extended-support price: EKS upgrades the cluster instead.
  upgrade_policy = {
    support_type = "STANDARD"
  }

  # No control-plane log group: EKS can re-create it after a destroy, and the next apply then
  # fails with ResourceAlreadyExistsException.
  enabled_log_types           = []
  create_cloudwatch_log_group = false

  # The module's KMS key keeps Secrets envelope-encrypted; a 7-day window shortens the
  # PendingDeletion tail after each destroy (it costs nothing while pending).
  kms_key_deletion_window_in_days = 7

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # v21 bootstraps no add-ons (bootstrap_self_managed_addons = false): without the CNI the
  # nodes never become Ready.
  addons = {
    vpc-cni = {
      before_compute = true
      # Prefix delegation is harmless headroom: managed nodes then allow more pods per node.
      configuration_values = jsonencode({
        env = {
          ENABLE_PREFIX_DELEGATION = "true"
          WARM_PREFIX_TARGET       = "1"
        }
      })
    }
    eks-pod-identity-agent = {
      before_compute = true
    }
    kube-proxy     = {}
    coredns        = {}
    metrics-server = {}
    aws-ebs-csi-driver = {
      # Pod Identity, because the nodes' IMDS hop limit of 1 keeps pods off the node role.
      pod_identity_association = [{
        role_arn        = module.ebs_csi_pod_identity.iam_role_arn
        service_account = "ebs-csi-controller-sa"
      }]
      # Creates the default gp3 StorageClass ebs-csi-default-sc: EKS >= 1.30 ships no default class.
      configuration_values = jsonencode({
        defaultStorageClass = {
          enabled = true
        }
      })
    }
  }

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size
    }
  }

  # Cluster-admin access entry for the identity that runs terraform apply.
  enable_cluster_creator_admin_permissions = true

  # The CI deploy role; IAM grants it only eks:DescribeCluster (github-oidc.tf).
  access_entries = var.enable_github_oidc ? {
    github_actions = {
      principal_arn = aws_iam_role.github_actions[0].arn

      policy_associations = {
        cluster_admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  } : {}
}

# IAM role for the EBS CSI controller, bound through EKS Pod Identity (no IRSA trust plumbing).
module "ebs_csi_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                      = "${var.cluster_name}-ebs-csi"
  attach_aws_ebs_csi_policy = true
}

# A check, not a validation: validations cannot reference other variables below Terraform 1.9.
check "node_group_sizes" {
  assert {
    condition     = var.node_min_size <= var.node_desired_size && var.node_desired_size <= var.node_max_size
    error_message = "Node group sizes must satisfy node_min_size <= node_desired_size <= node_max_size."
  }
}
