# Local Kubernetes stack on k3d — the development mirror of a deployment.
#
# `make local-up` stands the whole set of services up on a throwaway k3d cluster
# (k3s-in-Docker) using the SAME manifests staging/prod use, so runs are handled
# the way they will be in the cloud. `make local-down` tears it all down.
#
# Requirements on the host: docker (or a docker-compatible runtime), k3d, and
# kubectl. Everything runs in the cluster — the backend + auth, the dispatcher, the
# artifact service, the arena service, the in-cluster Grafana LGTM observability
# stack, and one per-run driver Job per enqueued run. There is no worker-on-host
# wiring; a run enqueued at the backend schedules as a Job here, and an adversarial
# match/tournament runs on the arena service. The observability stack (the local
# overlay's `components/observability`) replaces the LGTM the devcontainer used to
# ship: every service exports OTLP to it in-cluster — reach Grafana with
# `make local-grafana`.
#
# Secrets come from the host ENVIRONMENT, never a tracked file. Before `local-up`,
# export the harness provider API key the run needs — at least one of:
#   export ANTHROPIC_API_KEY=…     # the `claude` harness
#   export OPENAI_API_KEY=…        # codex
#   export OPENROUTER_API_KEY=…    # cline, goose, kilo, opencode, pi
# The shared dispatcher↔backend claim token defaults to a dev value; override it
# with `SERVICE_TOKEN=… make local-up` if you want. The `secrets` target creates
# the cluster Secrets from these; nothing sensitive is ever written to disk.
#
# Targets:
#   local-up        create the cluster, build+import images, apply, ingest catalog
#   local-down      delete the cluster (and everything in it)
#   local-rebuild   rebuild+import images, re-apply the overlay, restart the services (after a code OR manifest change)
#   local-reapply   re-apply the overlay ONLY (after a manifest-only change — RBAC, env, volumes; no image rebuild)
#   local-forward   foreground-forward backend→:8787, auth→:8789, artifacts→:8790, arena→:8791 to localhost
#   local-grafana   foreground-forward Grafana→:3000 and the OTLP collector→:4318/:4317 to localhost
#   local-ingest    re-ingest the catalog (force) — run after editing a test case
#   secrets         (re)create the cluster Secrets from the environment
#   local-status    show pods, services, and volumes in the namespace

# Resolve the repo root from this Makefile's location so the targets work no
# matter where `make` is invoked from.
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
REPO         := $(abspath $(MAKEFILE_DIR)../..)

CLUSTER ?= tcab
NS      ?= tcab-local
OVERLAY := $(REPO)/deployments/k8s/overlays/local

# Container runtime used to build the images. Prefers podman when installed,
# falling back to docker; override with `CONTAINER_TOOL=… make …`. (podman is
# checked first on purpose: a host that points `docker` at podman would otherwise
# always resolve to docker, so the fallback would never pick the real runtime.)
CONTAINER_TOOL ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)

# Images are tagged with the fully-qualified `docker.io/library/` prefix so podman
# does not store them under a `localhost/` prefix (which `k3d image import` then
# can't find by name). This normalizes to the same containerd reference the local
# overlay's `tcab-<svc>:local` image names resolve to, so the manifests match.
REGISTRY_PREFIX ?= docker.io/library

BACKEND_IMG    := $(REGISTRY_PREFIX)/tcab-backend:local
AUTH_IMG       := $(REGISTRY_PREFIX)/tcab-auth-service:local
DISPATCHER_IMG := $(REGISTRY_PREFIX)/tcab-dispatcher:local
DRIVER_IMG     := $(REGISTRY_PREFIX)/tcab-driver:local
ARTIFACTS_IMG  := $(REGISTRY_PREFIX)/tcab-artifacts:local
ARENA_IMG      := $(REGISTRY_PREFIX)/tcab-arena:local

ALL_IMGS := $(BACKEND_IMG) $(AUTH_IMG) $(DISPATCHER_IMG) $(DRIVER_IMG) $(ARTIFACTS_IMG) $(ARENA_IMG)

# Shared dispatcher↔backend service token. A fixed dev default (no production value
# lives in the repo); override from the environment, e.g. `SERVICE_TOKEN=… make …`.
SERVICE_TOKEN ?= local-dev-service-token

.PHONY: local-up local-down local-rebuild local-reapply local-forward local-grafana local-ingest local-status secrets cluster images apply

local-up: cluster images apply local-ingest
	@echo ""
	@echo "Stack is up in namespace '$(NS)'."
	@echo "Reach it with:  make -C deployments/local local-forward"
	@echo "  backend → http://127.0.0.1:8787   auth → http://127.0.0.1:8789   artifacts → http://127.0.0.1:8790   arena → http://127.0.0.1:8791"
	@echo "  (the backend reports the artifacts + arena URLs at GET /config; the console fetches build/media and matches/tournaments from them)"
	@echo "Observe it with:  make -C deployments/local local-grafana   →  Grafana at http://127.0.0.1:3000 (anonymous admin)"

# Create the k3d cluster if it does not already exist, mapping the repository to
# /repo on the server node so the backend can ingest from a read-only mount of it
# (see the local overlay's patch-backend.yaml).
cluster:
	@if k3d cluster list 2>/dev/null | grep -qw '$(CLUSTER)'; then \
	  echo "k3d cluster '$(CLUSTER)' already exists."; \
	else \
	  echo "Creating k3d cluster '$(CLUSTER)'…"; \
	  k3d cluster create '$(CLUSTER)' --volume '$(REPO):/repo@server:0' --wait; \
	fi
	@k3d kubeconfig merge '$(CLUSTER)' --kubeconfig-switch-context >/dev/null

# Build the service images from the same Dockerfiles the cluster uses, then load
# them into the cluster's nodes (no registry needed for local development).
#
# Images are imported as saved tarballs rather than by name: `k3d image import`
# does its own `save` from a name through the runtime, which fails on podman (the
# name resolves under a `localhost/` prefix). Saving with $(CONTAINER_TOOL)
# ourselves and importing the tar sidesteps that entirely and works on both docker
# and podman.
images:
	$(CONTAINER_TOOL) build -t '$(BACKEND_IMG)'    -f '$(REPO)/deployments/images/backend.Dockerfile'    '$(REPO)'
	$(CONTAINER_TOOL) build -t '$(AUTH_IMG)'       -f '$(REPO)/deployments/images/auth.Dockerfile'       '$(REPO)'
	$(CONTAINER_TOOL) build -t '$(DISPATCHER_IMG)' -f '$(REPO)/deployments/images/dispatcher.Dockerfile' '$(REPO)'
	$(CONTAINER_TOOL) build -t '$(DRIVER_IMG)'     -f '$(REPO)/deployments/images/driver.Dockerfile'     '$(REPO)'
	$(CONTAINER_TOOL) build -t '$(ARTIFACTS_IMG)'  -f '$(REPO)/deployments/images/artifacts.Dockerfile'  '$(REPO)'
	$(CONTAINER_TOOL) build -t '$(ARENA_IMG)'      -f '$(REPO)/deployments/images/arena.Dockerfile'      '$(REPO)'
	@set -e; tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	  i=0; tars=""; \
	  for img in $(ALL_IMGS); do \
	    i=$$((i+1)); \
	    echo "Saving $$img …"; \
	    $(CONTAINER_TOOL) save -o "$$tmp/img-$$i.tar" "$$img"; \
	    tars="$$tars $$tmp/img-$$i.tar"; \
	  done; \
	  k3d image import $$tars -c '$(CLUSTER)'

# Create the cluster Secrets from the host ENVIRONMENT and signed-in CLI files, so
# no API key or token is ever written to a tracked file (the local overlay
# deliberately omits them). Runs automatically as part of `apply`; run it on its
# own after rotating a key, then enqueue a run (driver Jobs pick up the Secrets
# fresh each run) or `local-rebuild` to restart the long-lived services. Idempotent
# — re-running updates each Secret in place.
#
# Requires at least one harness API key in the environment (ANTHROPIC_API_KEY /
# OPENAI_API_KEY / OPENROUTER_API_KEY); only the key(s) present are included.
#
# OPTIONALLY also builds tcab-driver-subscription from the host's signed-in harness
# CLI credential files (the same files the local `tcab run` reads): Claude's
# ~/.claude/.credentials.json (+ ~/.claude.json), Codex's $CODEX_HOME/auth.json
# (default ~/.codex/auth.json), and the Antigravity OAuth token. Unlike the API-key
# block this NEVER errors when the files are absent — subscription is opt-in; the
# Secret is mounted optional, so missing creds just leave runs API-key-only.
secrets:
	@kubectl create namespace '$(NS)' --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	@kubectl -n '$(NS)' create secret generic tcab-backend-secrets \
	  --from-literal=TCAB_BACKEND_SERVICE_TOKEN='$(SERVICE_TOKEN)' \
	  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	@kubectl -n '$(NS)' create secret generic tcab-dispatcher-secrets \
	  --from-literal=TCAB_BACKEND_SERVICE_TOKEN='$(SERVICE_TOKEN)' \
	  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	@set -e; \
	  args=""; \
	  if [ -n "$$ANTHROPIC_API_KEY" ];  then args="$$args --from-literal=ANTHROPIC_API_KEY=$$ANTHROPIC_API_KEY"; fi; \
	  if [ -n "$$OPENAI_API_KEY" ];     then args="$$args --from-literal=OPENAI_API_KEY=$$OPENAI_API_KEY"; fi; \
	  if [ -n "$$OPENROUTER_API_KEY" ]; then args="$$args --from-literal=OPENROUTER_API_KEY=$$OPENROUTER_API_KEY"; fi; \
	  if [ -z "$$args" ]; then \
	    echo "ERROR: no harness API key found in the environment."; \
	    echo "       Export at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY"; \
	    echo "       before running this (it injects the key into each driver Job)."; \
	    exit 1; \
	  fi; \
	  kubectl -n '$(NS)' create secret generic tcab-driver-secrets $$args \
	    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	@echo "Secrets applied to namespace '$(NS)' from the environment."
	@# OPTIONAL subscription creds, keyed by credential BASENAME (the driver maps
	@# each back to its full container path). Opt-in: include only the files that
	@# exist; NEVER error when none do. CODEX_HOME relocates Codex's home (default
	@# ~/.codex).
	@set -e; \
	  codex_home="$${CODEX_HOME:-$$HOME/.codex}"; \
	  args=""; \
	  if [ -f "$$HOME/.claude/.credentials.json" ]; then args="$$args --from-file=.credentials.json=$$HOME/.claude/.credentials.json"; fi; \
	  if [ -f "$$HOME/.claude.json" ];               then args="$$args --from-file=.claude.json=$$HOME/.claude.json"; fi; \
	  if [ -f "$$codex_home/auth.json" ];            then args="$$args --from-file=auth.json=$$codex_home/auth.json"; fi; \
	  if [ -f "$$HOME/.gemini/antigravity-cli/antigravity-oauth-token" ]; then args="$$args --from-file=antigravity-oauth-token=$$HOME/.gemini/antigravity-cli/antigravity-oauth-token"; fi; \
	  if [ -n "$$args" ]; then \
	    kubectl -n '$(NS)' create secret generic tcab-driver-subscription $$args \
	      --dry-run=client -o yaml | kubectl apply -f - >/dev/null; \
	    echo "Subscription creds applied to tcab-driver-subscription (opt-in)."; \
	  else \
	    echo "No host subscription creds found — skipping tcab-driver-subscription (runs stay API-key-only)."; \
	  fi

# Apply the local overlay and wait for every service to become ready. Secrets are
# created first (from the environment) so the pods find them on their first start.
apply: secrets
	kubectl apply -k '$(OVERLAY)'
	kubectl -n '$(NS)' rollout status statefulset/tcab-backend   --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-auth      --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-artifacts --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-lgtm      --timeout=300s
	kubectl -n '$(NS)' rollout status deployment/tcab-arena      --timeout=300s
	kubectl -n '$(NS)' rollout status deployment/tcab-dispatcher --timeout=300s

# Ingest (force) the test-case catalog from the repo the backend has mounted.
# Uses an ephemeral port-forward that is torn down when the recipe exits, then
# defers to `scripts/reingest.sh`, which streams the backend's NDJSON progress
# feed and prints a line per case — so a minute-plus scan reports progress instead
# of looking like a hang.
#
# Three guards turn the failure modes into immediate, legible errors instead of a
# silent hang: a pre-flight check that host port 8787 is free (a devcontainer's
# editor often auto-forwards it, squatting the port the port-forward needs to
# bind, and connections to that squatter accept-then-stall forever); a watch that
# the port-forward process stays alive (its bind error is no longer discarded); and
# a bounded healthz poll (`--connect-timeout`/`--max-time`) so a stalled connection
# can never block the loop indefinitely.
local-ingest:
	@port=8787; \
	  if command -v ss >/dev/null 2>&1; then \
	    busy="$$(ss -ltnp "sport = :$$port" 2>/dev/null | grep -i listen || true)"; \
	    if [ -n "$$busy" ]; then \
	      echo "ERROR: host port $$port is already in use; the ephemeral port-forward cannot bind:" >&2; \
	      echo "  $$busy" >&2; \
	      echo "Free it and retry. In a devcontainer this is usually the editor auto-forwarding $$port — stop it in the PORTS panel." >&2; \
	      exit 1; \
	    fi; \
	  fi; \
	  pflog="$$(mktemp)"; \
	  kubectl -n '$(NS)' port-forward svc/tcab-backend $$port:8787 >"$$pflog" 2>&1 & \
	  pf=$$!; trap 'kill $$pf 2>/dev/null; rm -f "$$pflog"' EXIT; \
	  ready=""; \
	  for i in $$(seq 1 30); do \
	    if ! kill -0 $$pf 2>/dev/null; then echo "ERROR: kubectl port-forward exited before the backend was reachable:" >&2; cat "$$pflog" >&2; exit 1; fi; \
	    if curl -fsS --connect-timeout 2 --max-time 4 http://127.0.0.1:$$port/healthz >/dev/null 2>&1; then ready=1; break; fi; \
	    sleep 1; \
	  done; \
	  if [ -z "$$ready" ]; then echo "ERROR: backend not reachable on 127.0.0.1:$$port after 30s." >&2; cat "$$pflog" >&2; exit 1; fi; \
	  BACKEND_URL=http://127.0.0.1:$$port '$(REPO)/scripts/reingest.sh'

# Hold the services open on localhost until interrupted (Ctrl-C). The artifact
# service is forwarded too: the console loads a pre-publish run's build and its
# proof/asset media directly from it (as browser `<img>`/`<iframe>` requests), so
# it must be reachable on localhost — the in-cluster `tcab-artifacts:8790` the
# backend advertises by default is not resolvable from the host browser. The local
# backend patch points `TCAB_ARTIFACTS_PUBLIC_URL` at this forwarded address.
local-forward:
	@echo "Forwarding backend→127.0.0.1:8787, auth→127.0.0.1:8789, artifacts→127.0.0.1:8790, arena→127.0.0.1:8791 (Ctrl-C to stop)…"
	@kubectl -n '$(NS)' port-forward svc/tcab-backend 8787:8787 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-auth 8789:8789 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-artifacts 8790:8790 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-arena 8791:8791 & \
	  wait

# Hold the in-cluster Grafana LGTM stack open on localhost until interrupted
# (Ctrl-C). Grafana's UI lands on http://127.0.0.1:3000 (anonymous admin — no
# login). The OTLP ports are forwarded too so a binary run OUTSIDE the cluster — a
# `cargo run` in the devcontainer, a host-side `tcab` CLI or desktop app, or the
# browser web console — can export to the same stack by pointing its
# OTEL_EXPORTER_OTLP_ENDPOINT at http://localhost:4318 (HTTP/protobuf; the browser
# must use this :4318 port). In-cluster services need none of this — they already
# export to the `tcab-lgtm` Service directly.
local-grafana:
	@echo "Forwarding Grafana→http://127.0.0.1:3000, OTLP→127.0.0.1:4318 (HTTP) + :4317 (gRPC) (Ctrl-C to stop)…"
	@kubectl -n '$(NS)' port-forward svc/tcab-lgtm 3000:3000 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-lgtm 4318:4318 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-lgtm 4317:4317 & \
	  wait

# Rebuild after a code change: new images, re-import, re-apply the overlay, rolling
# restart. (Driver pods are per-run Jobs the dispatcher creates fresh each run, so
# they pick up the new tcab-driver:local image on the next run with no restart
# here.) The `apply` dependency is what makes a rebuild also pick up MANIFEST
# changes — RBAC, env, volumes — not just new image bytes; without it a Role or env
# edit silently never reaches the cluster on a rebuild (it only does on local-up).
# `kubectl apply -k` is idempotent (a no-op when nothing changed), and the rollout
# restart below still forces the pods to pick up rebuilt images even when their spec
# is byte-identical (same :local tag), which apply alone would not trigger.
local-rebuild: images apply
	kubectl -n '$(NS)' rollout restart statefulset/tcab-backend statefulset/tcab-auth statefulset/tcab-artifacts deployment/tcab-arena deployment/tcab-dispatcher
	kubectl -n '$(NS)' rollout status statefulset/tcab-backend   --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-auth      --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-artifacts --timeout=300s
	kubectl -n '$(NS)' rollout status deployment/tcab-arena      --timeout=300s
	kubectl -n '$(NS)' rollout status deployment/tcab-dispatcher --timeout=300s

# Re-apply the overlay ONLY, with no image rebuild or service restart — the fast
# path after a manifest-only change (RBAC, env, volumes). `kubectl apply -k` is
# idempotent, so this is a no-op when nothing changed. Use local-rebuild instead
# when code changed (it rebuilds images and restarts the pods so they pick the new
# bytes up). Object-level changes that need a pod restart to take effect (e.g. an
# env edit) still want a `kubectl -n $(NS) rollout restart …` or local-rebuild
# after this; a Role change like the driver's pods/exec RBAC takes effect for the
# next driver Job with no restart.
local-reapply:
	kubectl apply -k '$(OVERLAY)'

local-status:
	kubectl -n '$(NS)' get pods,svc,pvc

local-down:
	-k3d cluster delete '$(CLUSTER)'
