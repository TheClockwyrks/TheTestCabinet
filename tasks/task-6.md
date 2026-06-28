# Task 6 — Apply + verify (end to end)

**Status:** ⬜ Not started. Last step. Depends on everything: task-1 (image built + public),
task-2/3 (component + overlay), task-4 (controllers + DNS + token). Read the
`azure-prod-deployment` memory; the cluster is private — apply via `az aks command invoke`.

## Goal

Roll the internal ingress + console to `azure-prod` and prove an operator on the VPN can use
prod entirely through the browser + CLI at the private hostnames.

## Apply

Prereqs in place (task-4): ingress-nginx (internal LB, IP known), cert-manager installed,
the Cloudflare DNS token Secret present, the Azure Private DNS zone + A records created, the
`tcab-web` image built + public + pinned in the overlay (task-3).

1. **Preview the diff** first (read-only), as with the publishing rollout:
   render `kubectl kustomize deployments/k8s/overlays/azure-prod` to a single file, then
   `az aks command invoke … --command "kubectl diff -f render.yaml" --file render.yaml`.
   Confirm the blast radius is only: the `tcab-web` Deployment/Service, the five Ingresses,
   the ClusterIssuer, the NetworkPolicy, the repointed backend `*_PUBLIC_URL` env, and the
   SPC change if the Cloudflare DNS secret was added there.
2. **Apply** the rendered overlay (`kubectl apply -f render.yaml`). If the Cloudflare DNS
   secret was added to the keyvault-csi SPC, `kubectl rollout restart deploy/tcab-keyvault-sync`
   so it materializes (new synced Secret).

## Verify (each must pass)

- **Certificates issued:** `kubectl -n tcab-prod get certificate` → all `Ready=True`
  (cert-manager completed the Cloudflare DNS-01 challenge). If stuck, inspect
  `kubectl describe certificate/<x>` + `kubectl -n cert-manager logs` (usual cause: the DNS
  token lacks Zone:DNS:Edit, or the zone name mismatch).
- **VPN resolution:** from a connected client, `nslookup console.testcabinet.ai` (and the
  other four) → the ingress internal LB IP.
- **Console works:** browse `https://console.testcabinet.ai` (valid TLS), register/login,
  and confirm it auto-targets `https://api.testcabinet.ai` (no manual URL entry — the
  runtime `config.js` injected it).
- **Media resolves:** open a published/finished run and confirm artifact media (playable
  build, screenshots) + arena views load — this proves the repointed
  `TCAB_ARTIFACTS_PUBLIC_URL` / `TCAB_ARENA_PUBLIC_URL` resolve over the VPN.
- **CLI against prod:** on the VPN, `TCAB_BACKEND_URL=https://api.testcabinet.ai`
  `TCAB_AUTH_URL=https://auth.testcabinet.ai`, `tcab login`, then run a small case end to
  end (queued → driver Job → result) and `tcab publish` it — closing the loop with the
  publishing feature. (This is also the still-outstanding prod smoke run from the prior
  handoff.)
- **Off-VPN negative check:** the hostnames do NOT resolve / are not reachable without the
  VPN (confirms private-only).

## Rollback

If a roll misbehaves, revert the overlay change and re-apply; the ingress/console are
additive (new resources + the two repointed env values), so reverting the backend
`*_PUBLIC_URL` patch + removing the component restores the prior state. The controllers
(ingress-nginx/cert-manager) are independent installs and can stay.

## Out of scope

None — this is the finish line. Update the `azure-prod-deployment` memory to record the
internal-ingress access model once verified.
