---
title: Overview
---

The Tauri app is The Test Cabinet's desktop GUI and the primary way test cases
are launched interactively. It is an enqueue-and-watch client of the
[backend](/components/backend/overview/) and a reporter, exposing the run
lifecycle through an interactive window.

Its console is the shared gallery application from the [UI
library](/components/ui/overview/), the same one the [web
console](/components/web/overview/) renders, driven over the same HTTP
transport. A run is enqueued at the backend, claimed by a dispatcher, and
executed by a per-run driver `Job`. The one thing the app runs on the host is
the [adversarial](/testing/adversarial/overview/) arena, whose matches and
tournaments are CPU-bound wasm played in-process by the embedded core.

## Capabilities

- Run test cases. Configure and launch a run, then watch the live [harness
  event](/components/core/events/) stream.
- Track runs in progress. Return to any executing run, and receive a
  notification when a run completes that links to it. Both the notifications and
  the in-flight list are pushed over the backend's multiplexed [console
  stream](/components/backend/api/#the-console-stream), and the active list is
  re-read only when that stream reports it may have missed something.
- Read the specs. Browse the specification a run was built from, so the produced
  implementation can be judged against what was asked for.
- Sign in. Register with or log in to the auth service so reviews and publishes
  are attributed to an account.
- Review runs. Record a review against the signed-in account. A run may carry
  one review per account.
- Publish. Publish a reviewed run to make it public.

## Backend resolution

The shell resolves the backend and auth service URLs from its own environment
(`TCAB_BACKEND_URL` and `TCAB_AUTH_URL`, with `.env.runner` loaded on start) and
hands them to the webview over IPC. Those URLs are fixed for the app's lifetime.

Setting `TCAB_BACKEND_URL` selects the developer path, where the app is a thin
client of a backend run separately, whether as bare processes or as a local
service stack (see [Running locally](/development/running/)). Leaving it unset
selects the self-contained cluster below.

## Self-contained cluster

With no external backend configured the shell stands up the whole run topology
itself on a local [k3d](https://k3d.io) cluster, from the same manifests a
[deployment](/deployment/kubernetes/overview/) uses, and then talks to it over
HTTP exactly as the web console talks to a remote backend.

- The service images are pulled from GHCR. A release stamps the image tag to the
  set built for its own commit, so an installer pins a known-good image set.
- The test-case catalog ships inside the app, is staged onto the cluster node,
  and is ingested by the backend.
- `k3d` and `kubectl` ship as bundled sidecars. The one host prerequisite is a
  running container runtime, Podman or Docker.
- The cluster and namespace are named `tcab-desktop`, distinct from the names a
  developer's own local stack uses, so the two coexist on one machine.
- The shell holds `kubectl port-forward`s open for the backend, auth, artifact,
  and arena services, and reports the forwarded backend URL to the webview.
- Bootstrap runs on its own thread and emits a status after each step. The
  console is reachable only once the cluster is up, and a failed bootstrap
  reports its cause and can be retried.

The cluster persists between launches and is reconciled on each start. Its
port-forwards are torn down on exit.

## Harness authentication

The desktop app operates its own cluster, so it also owns the harness
credentials its driver `Job`s authenticate with, covering the [two auth
modes](/components/core/harnesses/#authentication) every deployment uses. Those
credentials are gated on a `harnessAuth` capability only this host supplies and
are applied to the running cluster. Per harness the app can:

- Select the authentication method, one of `auto`, `subscription`, or `api-key`,
  written into the driver Secret as `TCAB_AUTH_MODE_<SLUG>`.
- Set an API key, written as `TCAB_API_KEY_<SLUG>`, the per-harness override
  core reads ahead of the shared provider variable, so harnesses sharing a
  provider give independent keys.
- Refresh a subscription's auth files, rebuilding the
  `tcab-driver-subscription` Secret the dispatcher mounts into each driver pod
  from the host's currently signed-in CLI credential files.

These settings persist to `harness-auth.json` in the app-data directory and are
layered over the host environment: a key exported in the shell or in a `.env`
file is the discovered default, and a saved override wins. They are applied to
the running cluster on every change and re-applied on each launch. Keys are
stored in plaintext, matching the app's posture of lifting plaintext keys into a
loopback-only cluster on a single-user machine.

## Host-specific concerns

Tauri IPC is reserved for concerns the host genuinely owns: the shell's resolved
service URLs, the cluster bootstrap status, the harness-credential commands, and
the local arena. A tournament's per-match replay media is produced on the host,
so it is served to the webview over the `tcab-tournament://` URI scheme.
Everything else, including a produced run's proof and asset media, is loaded
over HTTP from the [artifact service](/components/artifacts/overview/), exactly
as in the browser.
