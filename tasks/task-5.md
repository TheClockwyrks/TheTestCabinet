# Task 5 — Docs update: the internal-ingress access model

**Status:** ⬜ Not started. Do after the shape is settled (task-2/3) so the docs match what
shipped. Pure documentation.

## Goal

Update the deployment docs so operators know how to reach prod over the VPN at the private
hostnames, replacing the "port-forward only" framing — while preserving the load-bearing
invariant that nothing is ever exposed on a PUBLIC ingress.

## Changes (`apps/docs/src/content/docs/deployment/`)

- **`overview.md`** — the access-control / reachability section currently says operators
  reach the console via `kubectl port-forward` or "an internal-only Ingress behind your
  VPN/bastion." Promote the internal Ingress from a suggestion to the documented path:
  on the VPN, browse `https://console.testcabinet.ai`; the console talks to
  `https://api.testcabinet.ai` (backend) and `https://auth.testcabinet.ai`, and pulls
  artifact/arena media from `https://artifacts.testcabinet.ai` / `https://arena.testcabinet.ai`.
  Keep the "never a PUBLIC ingress / no public FQDN" statement — this is an INTERNAL LB
  reachable only on the VPN via Azure Private DNS.
- **`kubernetes.md`** — update the topology diagram/notes: add the ingress-nginx (internal
  LB) + the `tcab-web` workload + the five host routes; note cert-manager (LE, DNS-01 via
  Cloudflare) provides TLS; update the "web console … via kubectl port-forward" line.
  Document the NetworkPolicy addition (ingress-nginx namespace admitted to the services).
- **CLI usage** — wherever the docs tell operators to point `tcab` at a port-forwarded
  backend (e.g. `development/running.md` references `TCAB_BACKEND_URL=http://127.0.0.1:8787`),
  add the prod path: on the VPN, `TCAB_BACKEND_URL=https://api.testcabinet.ai` (+
  `TCAB_AUTH_URL=https://auth.testcabinet.ai`), `tcab login`, then run. (Port-forward stays
  valid as a fallback when off-VPN or for debugging.)
- Capture the **operator runbook** bits from task-4 (Helm installs, the Private DNS
  zone/records, the Cloudflare DNS token, VPN DNS) wherever deployment runbooks live, so the
  setup is reproducible — and note the **ordering** (controller IP → DNS records → certs).

## Cross-check

- `CLAUDE.md`'s component map / any "how to access" pointers don't contradict the new model.
- The public site/docs (Cloudflare Pages) story is unchanged — only the private console +
  services gained an internal ingress.

## Out of scope

Code/manifests (tasks 1–4), the apply + smoke (task-6).
