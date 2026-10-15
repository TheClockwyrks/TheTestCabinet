---
title: Edge
---

The edge is how anything outside a cluster reaches it: a Cloudflare Tunnel held
open from inside the namespace, one public hostname per environment routed by
path to the in-cluster services, and a Cloudflare Access application per
hostname that admits a person through Microsoft Entra ID. No `Ingress`, no load
balancer, no public IP and no certificate exist in the cluster; TLS terminates
at Cloudflare. The identity the edge hands the services is the contract in
[Identity](/components/auth/overview/).

The in-cluster half is the `components/edge` kustomize component, which the
`staging` and `prod` overlays include. The Cloudflare half, the tunnel, the DNS
records, the identity provider, the applications and the service token, is set
up once per environment, below.

## Hostnames and paths

| Environment | Origin                                   | Grafana                                          |
| ----------- | ---------------------------------------- | ------------------------------------------------ |
| Prod        | `https://console.testcabinet.ai`         | `https://grafana.console.testcabinet.ai`         |
| Staging     | `https://console.staging.testcabinet.ai` | `https://grafana.console.staging.testcabinet.ai` |

The tunnel's ingress rules route the origin by path and Grafana by hostname:

| Path            | Service               | What it is                                                           |
| --------------- | --------------------- | -------------------------------------------------------------------- |
| `/api/`         | `tcab-backend:8787`   | The [backend](/components/backend/overview/)                         |
| `/artifacts/`   | `tcab-artifacts:8790` | The [artifacts service](/components/artifacts/overview/)             |
| `/arena/`       | `tcab-arena:8791`     | The [arena](/components/arena/overview/)                             |
| `/`             | `tcab-web:8080`       | The [console](/components/web/overview/), the `tcab-web` nginx image |
| `grafana.` host | `tcab-lgtm:3000`      | Grafana, from the [observability component](/deployment/telemetry/)  |

`cloudflared` forwards a request's path unchanged, so each service accepts its
routes under its edge prefix as well as at its root: `/api/runs` through the
edge is `/runs` for an in-cluster caller. The console is same-origin with every
service it uses, so it carries no service URL and the backend advertises none.

## The tunnel

Each environment has one named tunnel, `tcab-prod` or `tcab-staging`, in the
Cloudflare account that holds the `testcabinet.ai` zone. The
`components/edge` component runs it:

- `tcab-cloudflared`, a `Deployment` of two replicas of the `cloudflare/cloudflared`
  image at a pinned version, so a restart or a node drain keeps the tunnel up.
  It needs no `Service`, no `ServiceAccount` permissions and no volume: the
  connection is outbound, to Cloudflare's edge, over `443`.
- `tcab-cloudflared`, a `ConfigMap` holding the tunnel's `config.yaml` with the
  ingress rules above, so the routing is in git with the rest of the overlay.
- The tunnel's credentials file, the Key Vault secret
  `cloudflare-tunnel-credentials`, synced by the `components/keyvault-csi`
  `SecretProviderClass` into the `tcab-cloudflared` `Secret` under the key
  `credentials.json` and mounted into the pod.
- `NetworkPolicy` rules admitting the `tcab-cloudflared` pods, through the
  base default-deny, to `tcab-web` on `8080`, the backend, artifacts and arena
  on their service ports, and `tcab-lgtm` on `3000`. These are additive; see
  [NetworkPolicy](/deployment/kubernetes/overview/#networkpolicy).

The nested `components/web` component provides the `tcab-web` workload, so an
overlay can serve the console in-cluster without the edge. The `local` overlay
includes neither: locally the console runs from source against a port-forwarded
backend, with no Access in front of it.

## DNS and TLS

Cloudflare holds the `testcabinet.ai` zone. Each hostname is a proxied `CNAME`
to the environment's tunnel, `<tunnel-id>.cfargotunnel.com`, which
`cloudflared tunnel route dns` writes. The zone has Total TLS enabled, so the
multi-level hostnames (`console.staging.…`, `grafana.console.…`) carry edge
certificates of their own beyond the zone's universal wildcard. Cloudflare's WAF
and rate limiting apply to the hostnames as to any proxied record.

## Identity provider

Access signs a person in through the Entra app registration "The Test Cabinet
Cloudflare Access" in the `clockwyrks.com` tenant:

| Setting          | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Application ID   | `edab70f0-74ca-4da9-bf91-fa5a77f1fc69`                                                                                 |
| Redirect URI     | `https://shrill-term-5c16.cloudflareaccess.com/cdn-cgi/access/callback`                                                |
| Delegated scopes | `openid profile email offline_access User.Read`                                                                        |
| Client secret    | Key Vault secret `cloudflare-access-entra-client-secret`, in `testcabinet-clockwyrks` (prod) and `testcabinet-staging` |

The client secret lives at Cloudflare, in the Access identity provider's
configuration, and Key Vault holds the record of it; nothing in the cluster
reads it. When the secret is rotated in Entra, store the new value in both
vaults and paste it into the identity provider. Sign-in is the Microsoft login
page, and MFA, lockout and conditional access are Entra's policies.

## Access applications

One self-hosted Access application per hostname, each with:

- the hostname as its domain, and a session of 24 hours;
- Entra ID as its only login method;
- an Allow policy whose membership is a list of email addresses, one per
  allowed person;
- for the two origins, a Service Auth policy that includes the environment's
  [service token](#the-service-token).

Each application has an audience tag, which the services behind that hostname
verify the assertion against; the overlay sets it as `TCAB_ACCESS_AUDIENCE` on
the backend, artifacts and arena workloads, with
`TCAB_ACCESS_TEAM_DOMAIN=shrill-term-5c16.cloudflareaccess.com`. Grafana sits
behind its own application and keeps its admin credentials from the
`tcab-grafana-admin` `Secret`, so a person signs in to Access and then to
Grafana.

## The service token

Each environment has one Access service token, `tcab-automation-<env>`, whose
client id and secret are the Key Vault secrets `cloudflare-access-client-id` and
`cloudflare-access-client-secret`. It is what the CLI's automation (ingest, the
reference publishes) and CI present, as the `CF-Access-Client-Id` and
`CF-Access-Client-Secret` headers; its assertion carries the token's name as
`common_name`. It is not synced into the cluster: the in-cluster callers hold
the backend's own tokens and never cross the edge.

## Setting up an environment

Once per environment, with `cloudflared` and `az` signed in to the account:

1. Create the tunnel and store its credentials:

   ```sh
   cloudflared tunnel create tcab-prod
   az keyvault secret set --vault-name testcabinet-clockwyrks \
     --name cloudflare-tunnel-credentials \
     --file ~/.cloudflared/<tunnel-id>.json --output none
   ```

   The vault has an IP firewall, so run this from an allow-listed host or add
   your IP with `az keyvault network-rule add`.

2. Point the hostnames at the tunnel:

   ```sh
   cloudflared tunnel route dns tcab-prod console.testcabinet.ai
   cloudflared tunnel route dns tcab-prod grafana.console.testcabinet.ai
   ```

3. In Zero Trust, add the Entra ID identity provider from the app registration
   above, create the two Access applications with their policies, and create
   the service token; store its id and secret in the vault under the names
   above.

4. Write each application's audience tag into the overlay's
   `patch-access.yaml` as `TCAB_ACCESS_AUDIENCE`, and the tunnel id into the
   component's `config.yaml`.

5. Let the pipeline deploy the overlay, then
   `kubectl rollout restart deploy/tcab-keyvault-sync -n <namespace>` so the
   tunnel credentials materialize. `kubectl -n <namespace> get deploy
   tcab-cloudflared` reports two ready replicas, and the tunnel shows as healthy
   in Zero Trust.

Confirm the boundary from outside the cluster. Without a credential the edge
redirects to the sign-in page; with the service token the backend answers:

```sh
curl -sI https://console.testcabinet.ai/api/healthz | head -1          # 302
curl -sI https://console.testcabinet.ai/api/healthz \
  -H "CF-Access-Client-Id: $TCAB_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $TCAB_ACCESS_CLIENT_SECRET" | head -1   # 200
```

Staging is the same sequence with `tcab-staging`, the staging hostnames and
the `testcabinet-staging` vault.
