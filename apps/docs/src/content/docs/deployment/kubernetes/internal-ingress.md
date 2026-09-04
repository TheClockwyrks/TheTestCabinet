---
title: Internal ingress
---

The `components/internal-ingress` kustomize component serves the web console
in-cluster and exposes it plus the four services over an internal-only
ingress-nginx, so operators reach an environment by browsing a private URL over
the VPN. Both the `azure-staging` and `azure-prod` overlays include it, with
`*.staging.tcab.testcabinet.ai` and `*.tcab.testcabinet.ai` hostnames.

The boundary is private. ingress-nginx is installed with the Azure internal-LB
annotation, so its `Service` holds a private VNet IP. The hostnames resolve
through an Azure Private DNS zone that VPN clients see. The public
[gallery](/components/site/overview/) and [docs](/components/docs/overview/) stay
on Cloudflare Pages and are unaffected.

## Component contents

The component carries app-level resources only; the controllers are a cluster
prerequisite.

- `tcab-web`, a `Deployment` and `ClusterIP` `Service` serving the console
  as a static SPA from the `tcab-web` image (nginx, port `8080`). The image is
  environment-agnostic, one build per git sha, so the backend and auth URLs are
  injected at runtime: the entrypoint renders a `/config.js` from
  `TCAB_WEB_BACKEND_URL` and `TCAB_WEB_AUTH_URL`, and the SPA prefers that
  `window.__TCAB_CONFIG__` over its build-time `VITE_*` defaults. The workload
  itself lives in a nested `components/web` component, so an overlay can serve
  the console in-cluster without this component's ingress, certificate, and
  `NetworkPolicy` wiring. The local k3d overlay omits both: locally the console
  runs from source against a `kubectl port-forward`ed backend, so a UI edit
  hot-reloads.
- Six host-per-service `Ingress` routes, one `Ingress` each with
  `ingressClassName: nginx`: `console` to `tcab-web`, `api` to
  `tcab-backend:8787`, `auth` to `tcab-auth:8789`, `artifacts` to
  `tcab-artifacts:8790`, `arena` to `tcab-arena:8791`, and `grafana` to
  `tcab-lgtm:3000`. Each carries the nginx annotations the data plane needs:
  `proxy-body-size: "0"`, because the artifact service streams run-tree tars and
  accepts uploads that the default 1 MB cap would truncate;
  `proxy-read-timeout` and `proxy-send-timeout: "3600"`, because the backend and
  arena serve long-lived NDJSON streams that the default 60 s timeout would
  sever; and `proxy-buffering: "off"`, so stream chunks flush straight through.
- A cert-manager `ClusterIssuer` (`letsencrypt-internal`) issuing each host a
  Let's Encrypt certificate over the ACME production directory, solved by DNS-01
  over Cloudflare. DNS-01 is required because the hosts are internal-only: Let's
  Encrypt cannot reach an HTTP-01 token, while proving control of the
  `testcabinet.ai` zone with a TXT record needs no inbound path. The solver reads
  a Cloudflare API token with `Zone:DNS:Edit` from the `cert-manager-cloudflare`
  Secret, key `api-token`.
- Three additive `NetworkPolicy` rules admitting the `ingress-nginx` namespace
  through the base default-deny, covering the four services, `tcab-web`, and
  `tcab-lgtm`; see
  [NetworkPolicy](/deployment/kubernetes/overview/#networkpolicy).

## Client-facing URL repointing

The backend advertises the artifact and arena base URLs to the console through
`GET /config`, and the base sets those to cluster-internal DNS, which a machine
on the VPN cannot resolve. Each overlay therefore patches:

- the backend's `TCAB_ARTIFACTS_PUBLIC_URL` and `TCAB_ARENA_PUBLIC_URL` to the
  `artifacts.` and `arena.` hostnames, and
- the `tcab-web` pod's `TCAB_WEB_BACKEND_URL` and `TCAB_WEB_AUTH_URL` to the
  `api.` and `auth.` hostnames.

`TCAB_BACKEND_AUTH_URL` and `TCAB_ARTIFACTS_URL` are the backend's own
server-side call URLs and stay in-cluster, at `http://tcab-auth:8789` and
`http://tcab-artifacts:8790`. Only the client-facing URLs move to the https
hostnames.

## Prerequisites

The controllers and the cloud-side plumbing are a one-time cluster prerequisite,
installed out of band. Order matters: the DNS records can only be created once
the ingress controller has its internal LB IP.

1. Install ingress-nginx with an internal LB through Helm into its own
   `ingress-nginx` namespace (prod pins chart `4.15.1`), forcing an Azure
   internal LB so it receives a private VNet IP:

   ```yaml
   controller:
     service:
       annotations:
         service.beta.kubernetes.io/azure-load-balancer-internal: "true"
       externalTrafficPolicy: Local
     ingressClassResource: { name: nginx, default: false }
   ```

   Once it settles, read the assigned private IP, which the DNS records point at:

   ```sh
   kubectl -n ingress-nginx get svc ingress-nginx-controller \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}'   # prod: 10.224.0.9
   ```

   The LB IP lives in the AKS node VNet (`aks-vnet-*`, `10.224.0.0/12`), not the
   app VNet.

2. Create the Azure Private DNS zone and records. Prod uses a dedicated
   `tcab.testcabinet.ai` sub-zone. A private `testcabinet.ai` zone would shadow
   the public zone for VPN clients and stop them resolving the public gallery and
   docs. Create the zone, link it to both the AKS VNet and the app/VPN VNet with
   registration disabled, and add A records for `console`, `api`, `auth`,
   `artifacts`, `arena`, and `grafana` pointing at the LB IP from step 1. The
   `_acme-challenge` TXT records from step 5 live in the public Cloudflare
   `testcabinet.ai` zone, which the `Zone:DNS:Edit` token covers.

3. Install cert-manager with its CRDs through Helm into the `cert-manager`
   namespace (prod pins `v1.20.3`). Two non-default flags are load-bearing:

   ```sh
   helm upgrade --install cert-manager jetstack/cert-manager \
     --namespace cert-manager --create-namespace --version v1.20.3 \
     --set crds.enabled=true \
     --set clusterResourceNamespace=tcab-prod \
     --set "extraArgs={--dns01-recursive-nameservers-only=true,--dns01-recursive-nameservers=1.1.1.1:53,1.0.0.1:53}"
   ```

   `clusterResourceNamespace` makes the cluster-scoped `ClusterIssuer` resolve
   the `cert-manager-cloudflare` Secret from the environment's namespace, where
   keyvault-csi syncs it. The `--dns01-recursive-nameservers` flags point the
   DNS-01 self-check at public resolvers, which is required because the private
   zone is linked to the AKS VNet, so in-cluster DNS resolves those names to the
   private LB IP and sees no public NS records. Without them cert-manager loops
   on "Could not determine authoritative nameservers" and issues no certificate.
   The CRDs must exist before the component's `ClusterIssuer` applies.

4. Provision the Cloudflare DNS-01 token. Mint a Cloudflare API token with
   `Zone:DNS:Edit` scoped to `testcabinet.ai`; a Pages-scoped publishing token
   cannot edit DNS records. Store it for cert-manager as the
   `cert-manager-cloudflare` Secret, key `api-token`. Prod adds it as a
   `cloudflare-dns-token` Key Vault secret synced by the `components/keyvault-csi`
   `SecretProviderClass`.

   The CSI driver does not reconcile an existing synced Secret on a plain
   remount. Secret auto-rotation closes that gap for changed values: with it
   enabled on the AKS `azure-keyvault-secrets-provider` add-on the driver polls
   Key Vault and reconciles updated values into the synced Secrets on its own, so
   a refreshed credential reaches the cluster without a restart. Enable it once
   per cluster with `scripts/enable-secret-rotation.sh --env <prod|staging>`,
   which is add-on configuration rather than a Kubernetes object. Adding a
   brand-new key to a Secret still needs
   `kubectl delete secret <name> && kubectl rollout restart deploy/tcab-keyvault-sync`.

5. Upload the Grafana admin credentials. The overlay exposes Grafana at the
   `grafana.` hostname, and its `patch-grafana-auth.yaml` disables the
   `otel-lgtm` image's anonymous-admin default, reading the admin user and
   password from the `tcab-grafana-admin` Secret. Add both
   `grafana-admin-user` and `grafana-admin-password` as Key Vault secrets. They
   are listed in the keyvault-csi `SecretProviderClass`, and the Azure provider
   fails the whole mount if any listed object is absent:

   ```sh
   az keyvault secret set --vault-name testcabinet-clockwyrks \
     --name grafana-admin-user     --value admin            --output none
   az keyvault secret set --vault-name testcabinet-clockwyrks \
     --name grafana-admin-password --value "$(openssl rand -base64 24)" --output none
   ```

   The vault has an IP firewall, so run these from an allow-listed host or add
   your IP with `az keyvault network-rule add`. With either secret missing the
   `tcab-lgtm` pod stays in `CreateContainerConfigError`, which is deliberately
   fail-closed.

6. Apply the overlay, then
   `kubectl rollout restart deploy/tcab-keyvault-sync -n <namespace>` so the new
   `cert-manager-cloudflare` and `tcab-grafana-admin` Secrets materialize.
   cert-manager completes the DNS-01 challenge with the Cloudflare token and
   issues the six certificates; confirm with `kubectl -n <namespace> get
   certificate`, which should report `Ready=True` for each.

7. Confirm VPN DNS resolution. The OpenVPN configuration must make clients
   resolve the private zone, by pushing Azure DNS `168.63.129.16` or a resolver
   that sees the Private DNS zone. From a connected client,
   `nslookup console.tcab.testcabinet.ai` returns the internal LB IP.

The Cloudflare token in step 4 and the Azure DNS zone in step 2 are independent
and can be prepared in parallel.
