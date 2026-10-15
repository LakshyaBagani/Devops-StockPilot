# ADR-0002: Traefik as the Ingress controller on kind and EKS

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `platform/traefik-values-kind.yaml`, `platform/traefik-values-eks.yaml`,
  `helm/stockpilot/templates/ingress.yaml`, `terraform/alb-controller.tf.example`

## Context

The rubric asks for an Ingress resource that routes `/` to the frontend and `/api` to the backend,
reachable through an Ingress hostname or load balancer. An Ingress object needs a controller, and:

- The community **ingress-nginx** controller was retired in March 2026: no further releases or
  security fixes. Starting a new project on it would mean shipping an unmaintained edge component.
- The free rehearsal cluster (kind) and the paid one (EKS) should behave the same, so that what is
  proven on a laptop holds in the cloud.
- Every extra AWS IAM role is one more thing to create, trust-scope and tear down for a cluster that
  lives a few hours per session.

## Decision

Use **Traefik v3** (chart `traefik/traefik` 41.7.1, Traefik 3.7.14) in namespace `traefik`, installed by
`scripts/lib/platform.sh` on both clusters:

- **kind:** Service type `NodePort` 30080, published by the kind port mapping on
  `http://127.0.0.1:8080`; `publishedService` off (a NodePort has no address to publish).
- **EKS:** Service type `LoadBalancer`, which the EKS cloud provider turns into a Classic Load
  Balancer in the public subnets tagged `kubernetes.io/role/elb=1`; 2 replicas; `publishedService`
  on, so `kubectl get ingress` shows the load balancer hostname.

The chart's single Ingress uses `ingressClassName: traefik`, no host and no rewrite annotations:
`/api` (Prefix) goes to Service `stockpilot-backend`, port name `http`; `/` (Prefix) goes to
`stockpilot-frontend` port 80. `/health`, `/ready` and `/metrics` are never routed.

## Alternatives considered

- **ingress-nginx:** retired; rejected.
- **AWS Load Balancer Controller with an ALB:** the usual production choice on EKS (target type
  `ip`, WAF and ACM certificates later). It needs its own IAM role, `region` and `vpcId` settings, and
  it does not exist on kind. It is kept as the documented fallback: `terraform/alb-controller.tf.example`
  plus the Helm overrides listed in `helm/stockpilot/values-eks.yaml` (`ingress.className=alb`,
  scheme, target type, backend health-check path).
- **Gateway API:** the long-term direction, but the rubric asks for an Ingress resource; a later
  version can move to `HTTPRoute`.

## Consequences

- One controller and one routing behaviour everywhere. On kind, `curl` through the Ingress shows
  `Server: uvicorn` on `/api/version` and `Server: nginx` on `/`, which proves `/api` bypasses the
  frontend (`docs/evidence/kind/terminal/m8-06-ingress-rules.txt`). CI asserts the same routes on the
  EKS render of the chart.
- No AWS IAM for the edge: nothing to trust-scope or clean up beyond the load balancer, which
  `make eks-down` removes by uninstalling Traefik before `terraform destroy`.
- The edge is a Classic Load Balancer serving plain HTTP. TLS (cert-manager or an ACM certificate on
  an ALB) is future work, listed in the README limitations.
- Traefik's image comes from Docker Hub, so repeated cluster rebuilds within an hour can hit the
  anonymous pull limit (it happened once during the build; ECR Public mirrors were the fallback).
