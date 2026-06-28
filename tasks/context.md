# Private internal-ingress + in-cluster web console — working context

A handoff document for closing the **operator-access gap** on the prod cluster: making the
web console and the backend/auth/artifact/arena services reachable over the company VPN at
private `*.testcabinet.ai` hostnames (TLS), so multiple operators can use prod by browsing
to a URL — instead of `kubectl port-forward` + running the console locally with env vars.
Self-contained so it survives a fresh session.

This `tasks/` directory was reset for this work; the previous contents (the completed
in-cluster-publishing handoff) were deleted. The companion files `task-1.md … task-6.md`
hold the implementation, in dependency order.

## The gap (why this work exists)

Confirmed this session against the live cluster (`tcab-prod` on AKS
`testcabinet-prod-westus2-aks`, private cluster — operate via `az aks command invoke`):

- Every service is a **`ClusterIP`** with **no Ingress** and **no LoadBalancer**
  (`kubectl get svc` shows `tcab-backend` 8787, `tcab-auth` 8789, `tcab-artifacts` 8790,
  `tcab-arena` 8791, all internal). There is **no ingress controller** installed.
- The **web console is not served at all** in-cluster — there is no `tcab-web` workload.
  `apps/web` is a static SPA operators currently run locally (`npm run dev`) and point at a
  `kubectl port-forward`ed backend.
- The base manifests are explicit that this is by design — `base/backend.yaml`:
  `# ClusterIP only — never expose the backend with a public Ingress/LoadBalancer.` The
  intent is a **private boundary supplied by the deployment**, never a public FQDN
  (`apps/docs/.../deployment/overview.md`: operators reach the console "from inside the
  cluster network: kubectl port-forward … or an internal-only Ingress behind your
  VPN/bastion").
- A second sharp edge: the backend advertises the **artifact/arena URLs** to clients as
  cluster-internal DNS (`TCAB_ARTIFACTS_PUBLIC_URL=http://tcab-artifacts:8790`,
  `TCAB_ARENA_PUBLIC_URL=http://tcab-arena:8791`), which a laptop on the VPN cannot
  resolve — so even with a port-forwarded backend, artifact media + arena views break.

The operator has **OpenVPN** configured for the Azure private network. The decided fix is
the "internal-only Ingress behind the VPN" the docs already anticipate, plus serving the
console in-cluster so there is a real private URL to visit.

## Target architecture (decided)

An **internal-only (VPN-reachable) ingress-nginx**, fronting the console + the four
services at host-per-service `*.testcabinet.ai` names, with TLS from cert-manager.

```
                       OpenVPN client (operator laptop)
                                  │  resolves *.testcabinet.ai via Azure Private DNS
                                  ▼            → ingress internal LB private IP (10.x)
        ┌──────────────── ingress-nginx (internal LB, VPN-only) ───────────────┐
        │  console.testcabinet.ai  → tcab-web      (static console, runtime cfg) │
        │  api.testcabinet.ai      → tcab-backend:8787                           │
        │  auth.testcabinet.ai     → tcab-auth:8789                              │
        │  artifacts.testcabinet.ai→ tcab-artifacts:8790                         │
        │  arena.testcabinet.ai    → tcab-arena:8791                             │
        └───────────────────────────────────────────────────────────────────────┘
  TLS:  cert-manager ClusterIssuer (Let's Encrypt, DNS-01 via Cloudflare) → per-host certs
  Console config: backend=https://api.testcabinet.ai, auth=https://auth.testcabinet.ai
        injected at runtime (config.js); artifacts/arena learned from backend GET /config
        whose TCAB_*_PUBLIC_URL are repointed to the https hostnames.
```

## Key decisions (load-bearing)

- **Serve the web console** (`apps/web`), NOT the public gallery (`apps/site`, which stays
  public on Cloudflare Pages). "The site" in the original ask = the operator console.
- **Host-per-service** hostnames under `testcabinet.ai` (no path-routing/rewrites):
  `console` → tcab-web, `api` → tcab-backend, `auth` → tcab-auth, `artifacts` →
  tcab-artifacts, `arena` → tcab-arena. Five hostnames, five Ingress routes, one cert each.
- **Azure Private DNS zone** linked to the AKS VNet, with A records → the ingress
  controller's **internal** load-balancer private IP. Resolvable ONLY for VPN clients using
  Azure DNS — nothing public. (The VPN must push Azure DNS / a resolver that sees the
  private zone; this is an operator/VPN-config step — see task-4.)
- **TLS via cert-manager + Let's Encrypt, DNS-01 over Cloudflare.** DNS-01 works for
  internal-only hosts (no inbound needed). Requires a **Cloudflare API token with
  Zone:DNS:Edit** on `testcabinet.ai` — the publisher's Pages-scoped token is NOT enough;
  mint a new one.
- **ingress-nginx with the Azure internal-LB annotation**
  (`service.beta.kubernetes.io/azure-load-balancer-internal: "true"`) so its Service gets a
  private VNet IP, never a public one. Controllers (ingress-nginx + cert-manager) are
  installed via **Helm as a cluster prerequisite**; our kustomize component carries only the
  app-level resources (Ingresses, ClusterIssuer, the tcab-web workload, NetworkPolicy).
- **Console config is injected at RUNTIME, not baked at build.** The CI builds one
  `tcab-web:<sha>` image used by every overlay (mirroring the publisher image), so the
  backend/auth URLs cannot be baked per-env via `VITE_*`. Instead the image's nginx
  entrypoint `envsubst`s a `/config.js` from `TCAB_WEB_BACKEND_URL` / `TCAB_WEB_AUTH_URL`,
  and a tiny `apps/web` change prefers `window.__TCAB_CONFIG__` over `import.meta.env.VITE_*`.
- **Internal ingress, never PUBLIC.** Preserve the existing invariant — this adds a
  *private* boundary only. Do not add a public LoadBalancer/Ingress or a public FQDN.
- **azure-prod first.** Wire only the live `azure-prod` overlay now. Staging is not stood up
  yet; it adopts the same component when it is (the operator confirmed staging follows once
  prod is verified). The `internal-ingress` component is written reusable so staging just
  adds it later with staging hostnames.

## What's already true (prior session, live)

The in-cluster **publishing** feature is implemented + deployed (branch
`chore/azure-prod-keyvault-csi`): backend/dispatcher/artifacts run image
`deefcb40373aff87b96ce20f5835d12677579346`; the publisher path is live; KV secrets are
synced via the keyvault-csi component. The cluster is otherwise healthy and unchanged. This
ingress work is the next layer on top; it touches **no** publishing code.

## Building blocks to reuse (with file refs — re-verify line numbers when implementing)

- **Console build + URL discovery:** `apps/web` is a pure static SPA (`vite build` →
  `apps/web/dist/`; `apps/web/vite.config.ts` sets no `base`). URL discovery in
  `apps/web/src/state/useConnections.ts`: backend = localStorage `tcab.web.backendUrl` else
  `import.meta.env.VITE_BACKEND_URL`; auth = `import.meta.env.VITE_AUTH_URL ?? backendUrl`.
  This is the exact spot the runtime-config change lands (task-1).
- **Backend `GET /config`:** handler `client_config` in `crates/backend/src/api.rs` returns
  `{ artifactsUrl, arenaUrl }` from `TCAB_ARTIFACTS_PUBLIC_URL` / `TCAB_ARENA_PUBLIC_URL`
  (parsed in `crates/backend/src/config.rs`). Console consumes via
  `packages/ui/src/transport/httpBackend.ts` (`fetchArtifactsUrl`/`fetchArenaUrl`). These
  envs are repointed to the https hostnames in task-3 (currently set in
  `deployments/k8s/base/backend.yaml`, alongside `TCAB_BACKEND_AUTH_URL`).
- **Services to route (all ClusterIP):** `base/backend.yaml` (8787), `base/auth.yaml`
  (8789), `base/artifacts.yaml` (8790), `base/arena.yaml` (8791) — each with the
  "ClusterIP only / never expose publicly" comment to respect.
- **NetworkPolicy:** `base/networkpolicy.yaml` has `tcab-default-deny-ingress` plus
  `tcab-allow-services-from-runners` (admits dispatcher/driver/artifacts/arena to
  backend+auth). MIRROR this policy to admit the ingress-nginx namespace to
  backend/auth/artifacts/arena/tcab-web (task-2).
- **Kustomize component pattern:** `deployments/k8s/components/{observability,keyvault-csi}/`
  (`kind: Component`, a `kustomization.yaml` + resource/patch files). Overlays add via
  `components:` — see `overlays/azure-prod/kustomization.yaml`. The new `internal-ingress`
  component follows this shape (task-2); the overlay opt-in is task-3.
- **Image + CI:** `deployments/images/*.Dockerfile` (node-based examples: `backend`,
  `driver`; the recent `publisher.Dockerfile` is the freshest "new image" precedent). The
  build matrix is in `.github/workflows/build-service-images.yml` — add a `tcab-web` entry
  + update the header comment (task-1).
- **Operating the private cluster + KV firewall idiom:** the `azure-prod-deployment` memory
  and `scripts/upload-subscription-creds.sh` (temporarily allow egress IP → set → remove).
  Apply manifests with `az aks command invoke … --command "kubectl apply -f -" --file …`.

## Credentials & prerequisites (provisioned vs pending)

- **Cloudflare DNS-01 token — PENDING.** Mint a Cloudflare API token with **Zone:DNS:Edit**
  on `testcabinet.ai` (the existing `CLOUDFLARE_PAGES_API_KEY` is Pages-scoped only). Store
  it as a cert-manager solver Secret — preferably as a new Key Vault secret
  (`cloudflare-dns-token`) synced via the keyvault-csi SecretProviderClass, mirroring how
  `github-pat`/`cloudflare-pages-api-token` were added.
- **Azure Private DNS zone + VNet link + A records — PENDING (operator).** See task-4;
  ordering matters (install the ingress controller first to learn its internal LB IP, then
  create the records).
- **OpenVPN DNS — operator must confirm.** VPN clients must resolve the private zone (push
  Azure DNS / the private resolver). If `nslookup console.testcabinet.ai` on the VPN does
  not return the internal LB IP, this is the thing to fix.
- **`tcab-web` GHCR image — built by the operator's CI** (the GitHub-mirror pipeline;
  canonical remote is Azure DevOps), then set the new package **Public** like the other
  service images.

## Release implication

Shipping this adds **one new service image** (`tcab-web`) and changes **no Rust service**
images — the only code change is a tiny `apps/web` (TypeScript) runtime-config tweak, which
rides into the `tcab-web` image. The backend/dispatcher/etc. images are untouched. The
image build/publish + the overlay tag bump happen via the operator's pipeline (same as the
publisher image).

## Remaining work (companion files, dependency order)

- `task-1.md` — **`tcab-web` image + runtime console config**: `web.Dockerfile` (vite build
  → nginx serving `dist/` with SPA fallback + `envsubst` `/config.js`), the small `apps/web`
  runtime-config change, and the CI matrix entry.
- `task-2.md` — **`internal-ingress` kustomize component**: tcab-web Deployment+Service, the
  five Ingress routes, the cert-manager ClusterIssuer + per-host certs, and the
  ingress-source NetworkPolicy.
- `task-3.md` — **azure-prod overlay wiring + URL repointing**: add the component + the
  tcab-web image, repoint `TCAB_*_PUBLIC_URL`, set the tcab-web pod's backend/auth env.
- `task-4.md` — **controllers + Azure/Cloudflare prerequisites** (mostly operator): Helm
  install ingress-nginx (internal) + cert-manager; Azure Private DNS zone + VNet link + A
  records; the Cloudflare DNS token + solver Secret; VPN DNS.
- `task-5.md` — **docs update**: the deployment access model (browse the private console URL
  / point `tcab` at `api.testcabinet.ai`), preserving "never a public ingress".
- `task-6.md` — **apply + verify**: cert issuance, VPN resolution, console login + media,
  and a CLI smoke run + publish against prod.

## References

- Branch: `chore/azure-prod-keyvault-csi` (the publishing work + the overlay edits live
  here; this feature continues on it unless the operator opens a new branch).
- Memory: `azure-prod-deployment.md` (private cluster + Key Vault + Postgres operating
  model — read before touching the deployment) and `cargo-target-virtiofs-race.md` (export
  `CARGO_TARGET_DIR` off the virtiofs mount before any parallel cargo build).
- The just-shipped in-cluster-publishing handoff (now deleted from `tasks/`, but in git
  history) is the **style template** for tone, structure, and depth.
