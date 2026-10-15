output "region" {
  description = "AWS region of every resource."
  value       = var.aws_region
}

output "vpc_id" {
  description = "VPC id; the teardown gates and leftover diagnostics filter on it."
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet ids (tagged kubernetes.io/role/elb), where the Traefik load balancer lands."
  value       = module.vpc.public_subnets
}

output "private_subnet_ids" {
  description = "Private subnet ids of the control-plane ENIs and the nodes."
  value       = module.vpc.private_subnets
}

output "cluster_name" {
  description = "EKS cluster name; the repo variable EKS_CLUSTER_NAME."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint (public, IAM-authenticated)."
  value       = module.eks.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes minor version of the control plane."
  value       = module.eks.cluster_version
}

output "node_security_group_id" {
  description = "Security group shared by the nodes; teardown diagnostics look for rules that reference k8s-* groups."
  value       = module.eks.node_security_group_id
}

output "configure_kubectl" {
  description = "Runnable one-liner that writes the kube context stockpilot-eks: $(terraform -chdir=terraform output -raw configure_kubectl)"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}"
}

output "github_actions_role_arn" {
  description = "Deploy role ARN; the repo variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_actions.arn
}

output "github_oidc_subjects" {
  description = "The two OIDC subjects the deploy role trusts, for review against the whoami run."
  value       = local.github_subjects
}
