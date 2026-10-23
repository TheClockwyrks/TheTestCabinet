---
format: nyxsis-issue
version: 3
id: c1r4ue2uglgojvcylongym4h
zone: EDGE
number: 5
title: Retire the internal ingress and VPN path on prod
type: generic
priority: 3
state: open
depends_on:
  - rbx3kjw1cve8gps68gmnr16a
created: 2026-10-20T06:15:26.079574592Z
---

Each environment has one origin, reached through Cloudflare Access over a
Cloudflare Tunnel: `apps/docs/src/content/docs/deployment/kubernetes/edge.md`
and `apps/docs/src/content/docs/components/auth/overview.md`.

## What is wrong

Prod still carries the retired path: the `ingress-nginx` and `cert-manager`
releases, the per-service Ingress objects, their TLS secrets and network
policies, the `letsencrypt-internal` issuer, the private DNS zone
`tcab.testcabinet.ai` with its VNet links, the VNet peerings to the OpenVPN
network, and the `cloudflare-dns-token` secret in the vault
`testcabinet-clockwyrks`. Staging has already dropped them.

## What to do

Once `master` has deployed the edge to prod (`tcab-cloudflared` 2/2 ready in
`tcab-prod`, the tunnel `tcab-prod` healthy, and
`https://console.testcabinet.ai/api/healthz` answering through Access),
restart `tcab-keyvault-sync` so the tunnel credentials sync, then delete the
objects above through `az aks command invoke`, uninstall the two Helm
releases with their CRDs, namespaces, ingress class and webhooks, delete the
secrets last, and remove the Azure DNS zone, links and peerings on the
`testcabinet-prod-westus2` side.

Leave `openvpn-prod-westus2-rg`, `OpenVPNAccessServer-vnet` and its peerings
to the other projects in place.

## Verify

`kubectl -n tcab-prod get ingress,networkpolicy,certificates` lists none of
the retired objects, `helm list -A` shows neither release, the private DNS
zone and the two peerings are gone, and the console, API and arena answer
through Access.
