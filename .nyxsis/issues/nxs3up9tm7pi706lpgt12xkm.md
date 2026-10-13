---
format: nyxsis-issue
version: 2
id: nxs3up9tm7pi706lpgt12xkm
zone: EDGE
number: 1
title: Deploy the Cloudflare Tunnel and Access edge for staging and prod
type: generic
state: open
created: 2026-10-13T21:11:19.642122519Z
---

The staging and prod clusters are reached through OpenVPN and an internal
ingress today. The documentation describes one public origin per environment
behind Cloudflare Access over a Cloudflare Tunnel, with no ingress, load
balancer, public IP or certificate in the cluster:
`apps/docs/src/content/docs/deployment/kubernetes/edge.md`.

## What is missing

- The `components/edge` kustomize component: the `tcab-cloudflared`
  Deployment and ConfigMap, the Key Vault-synced tunnel credentials and the
  NetworkPolicy rules the page lists, included by the `staging` and `prod`
  overlays.
- The tunnels, DNS records, identity provider, Access applications and the
  service token, set up per environment as the page's "Setting up an
  environment" section states. The Entra app registration and its client
  secret already exist, as the page's "Identity provider" table records.
- The OpenVPN deployment, the internal ingress and the `k8s-manifests` and
  `k8s-deploy-sets` expectations of them, removed.

## Verify

Follow the page's "Setting up an environment" on staging. Without a
credential, `https://console.staging.testcabinet.ai/api/healthz` answers a
redirect to the sign-in page; with the service token it answers 200. Opening
the origin in a browser leads to the Microsoft login page and then to the
console. `make gate` passes.
