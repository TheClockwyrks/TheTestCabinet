---
format: nyxsis-issue
version: 3
id: c1r4ue2uglgojvcylongym4h
zone: EDGE
number: 5
title: Retire the internal ingress and VPN path on prod
type: generic
priority: 3
state: done
depends_on:
  - rbx3kjw1cve8gps68gmnr16a
created: 2026-10-20T06:15:26.079574592Z
done: 2026-10-23T19:46:27.120832353Z
outcome: |
  Retired on 2026-10-23, after the prod stage deployed the edge from `master`
  4fe28c570. Before anything was deleted, `tcab-cloudflared` was 2/2 ready in
  `tcab-prod`, `tcab-keyvault-sync` had already been restarted after that deploy,
  and `/api/healthz`, `/arena/healthz`, `/artifacts/healthz` and `/` all answered
  200 through Access with the `tcab-automation-prod` service token. `/api/healthz`
  answered 302 without the token.

  Removed, in this order:

  - **Cluster:**
    - The `letsencrypt-internal` ClusterIssuer.
    - The `ingress-nginx` and `cert-manager` Helm releases. Uninstalling them also
      removed the `nginx` IngressClass, both releases' admission webhooks and
      their RBAC.
    - The six cert-manager CRDs, which the chart's resource policy had kept.
    - The `ingress-nginx` and `cert-manager` namespaces.
    - The per-service Ingress objects, their Certificates and their ingress
      network policies were already gone when the edge deploy ran.
  - **Secrets, last:**
    - In `tcab-prod`: `tls-api`, `tls-arena`, `tls-artifacts`, `tls-auth`,
      `tls-console`, `tls-grafana`, `cert-manager-cloudflare` and
      `letsencrypt-internal-account-key`.
    - In the vault `testcabinet-clockwyrks`: `cloudflare-dns-token`. It was
      soft-deleted, not purged, so it stays recoverable for the retention window.
  - **Azure:**
    - The private DNS zone `tcab.testcabinet.ai` with its links
      `aks-prod-vnet-link` and `openvpn-vnet-link`.
    - The peerings `testcabinet-prod-westus2-vnet-to-openvpn` and
      `openvpn-to-testcabinet-prod-westus2-vnet`.

  `openvpn-prod-westus2-rg`, `OpenVPNAccessServer-vnet` and its peerings to the
  other projects are untouched. To read the service token, the
  operator's IP was added to the vault firewall and then removed again, so the
  firewall's IP rules are empty, as they were before.

  Verified afterwards:

  - `kubectl -n tcab-prod get ingress,networkpolicy` lists only the edge and
    runner policies.
  - The `certificates` resource type no longer exists.
  - `helm list -A` shows only the AKS-managed releases.
  - The zone and both peerings are gone.
  - The console, API, arena and artifacts still answer 200 through Access.

  Left in place, outside this issue's list: the vault's network rule that allows
  `OpenVPNAccessServer-vnet/subnet-1`. Without the peering it no longer gives this
  project a path in, and removing it is a separate choice.
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
