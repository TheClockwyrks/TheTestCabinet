# Task 4 — Controllers + Azure/Cloudflare prerequisites (mostly operator)

**Status:** ⬜ Not started. The cluster + cloud groundwork the component (task-2) and apply
(task-6) depend on. Read the `azure-prod-deployment` memory first. The cluster is private —
operate with `az aks command invoke -g testcabinet-prod-westus2-rg -n
testcabinet-prod-westus2-aks --command "…"` (use `--file` to upload manifests/values).

## Goal

Stand up the two controllers and the cloud-side plumbing the internal ingress needs:
ingress-nginx (internal LB), cert-manager, the Cloudflare DNS-01 token, the Azure Private
DNS zone, and VPN resolution.

## 1. Install ingress-nginx (INTERNAL load balancer)

Helm-install ingress-nginx into its own namespace, forcing an **internal** Azure LB so it
gets a private VNet IP (never public):
```
controller:
  service:
    annotations:
      service.beta.kubernetes.io/azure-load-balancer-internal: "true"
    externalTrafficPolicy: Local
  ingressClassResource: { name: nginx, default: false }
```
After it settles, read the assigned private IP — this is what the DNS records point at:
`kubectl -n ingress-nginx get svc <controller> -o jsonpath='{.status.loadBalancer.ingress[0].ip}'`.
Confirm the namespace carries `kubernetes.io/metadata.name: ingress-nginx` (the
NetworkPolicy in task-2 selects on it).

## 2. Install cert-manager

Helm-install cert-manager (with CRDs) into `cert-manager`. The CRDs must exist before the
`internal-ingress` component's `ClusterIssuer`/`Certificate` resources apply (task-6 orders
this). Nothing else here — the issuer itself ships in the component.

## 3. Cloudflare DNS-01 token + solver Secret

- **Mint a Cloudflare API token with `Zone:DNS:Edit` scoped to `testcabinet.ai`** (the
  Pages-scoped `CLOUDFLARE_PAGES_API_KEY` cannot edit DNS records — DNS-01 needs a DNS
  token). Verify it the same way the Pages token was (`/user/tokens/verify` → active).
- **Store it for cert-manager.** Preferred: add a Key Vault secret `cloudflare-dns-token`
  (firewall idiom from `scripts/upload-subscription-creds.sh`) and extend the keyvault-csi
  `SecretProviderClass` (`deployments/k8s/components/keyvault-csi/secretproviderclass.yaml`)
  with a new `objects` entry + a `secretObjects` Secret (e.g. `cert-manager-cloudflare`,
  key `api-token`) the ClusterIssuer references. Mirror exactly how `github-pat` /
  `cloudflare-pages-api-token` were added. **CSI gotcha:** the driver won't add keys to an
  *existing* synced Secret on remount — a NEW Secret materializes fine, but if you later
  add keys, `kubectl delete` it and restart `tcab-keyvault-sync`. Alternatively (simpler,
  less consistent) `kubectl create secret generic` it directly in `tcab-prod`.

## 4. Azure Private DNS zone + VNet link + A records

- Create a Private DNS zone covering the hostnames (e.g. `testcabinet.ai`, or a delegated
  sub — a private `testcabinet.ai` zone linked to the VNet will SHADOW the public zone for
  VPN clients, so they couldn't reach the public site/docs; if that matters, use a
  dedicated internal sub like `tcab.testcabinet.ai` and name the hosts
  `console.tcab.testcabinet.ai` etc., and update task-2/task-3 hostnames + the cert to match).
- **Link the zone to the AKS VNet** (virtual-network-link).
- Add **A records** for `console` / `api` / `auth` / `artifacts` / `arena` → the
  ingress-nginx internal LB IP from step 1.

## 5. VPN DNS resolution (operator)

Ensure the OpenVPN config makes clients resolve the private zone — push Azure DNS
(`168.63.129.16`) or a resolver that sees the Private DNS zone. Validate from a connected
client: `nslookup console.testcabinet.ai` returns the internal LB IP.

## Ordering (important)

install ingress-nginx → read its internal LB IP → create the Private DNS zone + records →
install cert-manager → (apply the component, task-6) → cert-manager completes DNS-01 (needs
the Cloudflare token) and issues the certs. The Cloudflare token + Azure DNS zone are
independent and can be prepared in parallel.

## Out of scope

The component resources (task-2), overlay wiring (task-3), the apply + verification (task-6).
Most of this task is `az`/Helm/portal operator action, not repo code — capture exact
commands/values in the deployment docs (task-5) as you go.
