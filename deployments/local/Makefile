# Local Kubernetes stack on k3d — the development mirror of a deployment.
#
# `make local-up` stands the whole set of services up on a throwaway k3d cluster
# (k3s-in-Docker) using the SAME manifests staging/prod use, so runs are handled
# the way they will be in the cloud. `make local-down` tears it all down.
#
# This is meant to run INSIDE the devcontainer, which ships `docker` (a client
# only), `k3d`, and `kubectl` and binds the HOST's Docker daemon socket in
# (Docker-outside-of-Docker; see .devcontainer/docker-compose.yml). The cluster is
# created on that host daemon, so its node containers and the built images are
# host-daemon siblings, and `kubectl` reaches the API server published on the host
# via host.docker.internal (the `cluster`/`kubeconfig` targets wire this up). It
# also works on a bare host with `docker`/`k3d`/`kubectl` installed directly.
# Everything runs in the cluster — the backend + auth, the dispatcher, the
# artifact service, the arena service, the in-cluster Grafana LGTM observability
# stack, and one per-run driver Job per enqueued run. There is no worker-on-host
# wiring; a run enqueued at the backend schedules as a Job here, and an adversarial
# match/tournament runs on the arena service. The web console is the ONE piece that
# does NOT run in-cluster locally: baking it into a pod forces a full image
# rebuild+re-import on every UI edit, so instead you run it from source with
# `npm run -w apps/web dev` (serves 127.0.0.1:1430, pre-pointed at the forwarded
# backend/auth via apps/web/.env.development — no VITE_BACKEND_URL to set). It reaches
# the data plane over `make local-forward`, exactly as the in-cluster console did.
# (Prod still serves the console in-cluster; only the local overlay drops it.) The
# observability stack (the local overlay's `components/observability`) replaces the
# LGTM the devcontainer used to ship: every service exports OTLP to it in-cluster —
# reach Grafana at http://127.0.0.1:3000 (it is folded into `make local-forward`;
# `make local-grafana` is only needed when you also want the OTLP collector ports).
#
# Secrets come from the host ENVIRONMENT or the gitignored repo-root .env, never a
# tracked file. Before `local-up`, provide the harness provider API key the run
# needs — at least one of ANTHROPIC_API_KEY (the `claude` harness), OPENAI_API_KEY
# (codex), or OPENROUTER_API_KEY (cline, goose, kilo, opencode, pi) — either by
# exporting it:
#   export ANTHROPIC_API_KEY=…
# or by adding it to the repo-root .env (the `secrets` target sources it):
#   OPENROUTER_API_KEY=…
# Comment a line out in .env to leave that key unset (e.g. when using
# subscription-based auth for that provider instead).
#
# One more credential is OPTIONAL and only matters for audio: the read-scoped
# CLOUDFLARE_AUDIO_R2_PRESIGN pair, which lets the `audio-store` target build the store
# the driver image carries out of the audio object store. Without it the stack still
# comes up — see that target for what happens instead. Nothing here ever PULLS an audio
# image; a local build gets its store from this checkout. The shared
# dispatcher↔backend claim token defaults to a dev value; override it with
# `SERVICE_TOKEN=… make local-up` if you want. The `secrets` target creates the
# cluster Secrets from these; nothing sensitive is ever written to a tracked file.
#
# Targets:
#   local-up        create the cluster, build+import service AND run images, apply, ingest catalog
#   local-down      delete the cluster (and everything in it)
#   local-rebuild   rebuild+import the SERVICE images, re-apply the overlay, restart the services (after a service code OR manifest change)
#   audio-store     (re)build ONLY the audio store the driver image carries — run after publishing an audio pack, then `local-rebuild`
#   run-images      rebuild+import ALL the RUN-CONTAINER images (after changing baked-in tooling: voxel-anim/draw/core modeling) — the heavy path
#   run-images-e2e / -full-stack / -game-jam / -asset / -adversarial / -performance / -gg
#                   rebuild+import ONLY one test type's run image(s) — the fast path when you touched just that type's tooling
#   run-image-<name>  rebuild+import a SINGLE run image by short name (e.g. run-image-voxel-animation) — the finest grain, for one asset kind
#   run-images-gg-selfcheck  build gg static and rebuild the five environment-representative `-gg` images WITH
#                   the `gg selfcheck` gate — the same command CI publishes behind (builds only; imports nothing)
#   local-reapply   re-apply the overlay ONLY (after a manifest-only change — RBAC, env, volumes; no image rebuild)
#   local-forward   foreground-forward backend→:8787, auth→:8789, artifacts→:8790, arena→:8791, AND Grafana→:3000 to localhost (the console runs from source via `npm run -w apps/web dev`)
#   local-grafana   foreground-forward Grafana→:3000 AND the OTLP collector→:4318/:4317 to localhost (use when you also need the OTLP ports; local-forward already exposes Grafana)
#   local-ingest    re-ingest the catalog (force) — run after editing a test case
#   local-import    re-import EVERY already-built service + run image into the node, no rebuild (recovery after the node lost its images)
#   secrets         (re)create the cluster Secrets from the environment
#   local-status    show pods, services, and volumes in the namespace

# Resolve the repo root from this Makefile's location so the targets work no
# matter where `make` is invoked from.
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
REPO         := $(abspath $(MAKEFILE_DIR)../..)

CLUSTER ?= tcab
NS      ?= tcab-local
OVERLAY := $(REPO)/deployments/k8s/overlays/local

# The k3s image `cluster` creates the node from. Pinned — NOT left to k3d's built-in
# default, which tracks whatever k3s was current when that k3d release was cut and so
# drifts from the deployments as k3d ages. This mirrors the Kubernetes version the
# staging/prod AKS clusters run, so the API server this stack validates and applies
# against behaves like the real one; bump it in step with `KUBECTL_VERSION` in
# .devcontainer/tools/k8s.sh. (k3s tags the image with `-k3s1`, not the `+k3s1` of the
# upstream release tag.)
K3S_IMAGE ?= rancher/k3s:v1.35.6-k3s1

# The kubelet setting every local node MUST carry. Every image this cluster runs is a
# local import with NO registry behind it, and the kubelet's image garbage collector
# does not know that: once the node's image filesystem — which under k3d is the HOST
# disk — passes 85% full it deletes every image no running pod is using, which here is
# exactly `tcab-driver:local` and all fifty-four run images. The next run then sits in
# `queued` forever while its driver pod is in ImagePullBackOff, and nothing can pull it
# back. 100 disables the collector (the kubelet documents 100 as "off"). Passed on
# `k3d cluster create`, and written into k3s's config.yaml on a node that predates it
# (see `cluster-kubelet`).
KUBELET_IMAGE_GC_ARG := image-gc-high-threshold=100

# Name k3d gives this cluster's kubeconfig context/cluster entry (used by the
# `kubeconfig` target to repoint the API server for in-devcontainer access).
KUBE_CTX := k3d-$(CLUSTER)

# Every cluster-operating recipe goes through this instead of bare `kubectl`, so
# it ALWAYS targets the local k3d cluster regardless of the kubeconfig's
# current-context. Without the pin, a kubeconfig whose active context points at a
# `tcab` staging/prod AKS cluster (a common state when an operator has just been
# working against a deployment) would silently send these creates/applies/restarts
# — and the secrets — at the wrong cluster. `--context` selects the context by the
# fixed name k3d gives it; if it does not exist yet, kubectl fails fast with a clear
# "context not found" instead of acting on prod. (The `kubeconfig` target's
# `kubectl config set-*` calls are deliberately NOT routed through this: they edit a
# named cluster entry and are independent of the current context.)
KUBECTL := kubectl --context '$(KUBE_CTX)'

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

# The provenance commit stamped into the service binaries (crates/core/build.rs →
# the run record's testCabinetCommit). The build context omits `.git` — the
# repo-root .dockerignore is an allowlist that never re-includes it — so the
# Dockerfiles can't resolve the commit from git themselves; we resolve it here on
# the host and pass it in as the TCAB_BUILD_COMMIT build arg. Mirrors build.rs: the
# HEAD hash, suffixed `-dirty` when the working tree has uncommitted changes. Empty
# when git can't resolve one (no repo), which simply stamps a null commit.
TCAB_COMMIT ?= $(shell sh -c 'h=$$(git -C "$(REPO)" rev-parse HEAD 2>/dev/null) || exit 0; [ -n "$$(git -C "$(REPO)" status --porcelain 2>/dev/null)" ] && h="$$h-dirty"; printf %s "$$h"')

# Every Rust service image is built from this one file, selected by `--target`
# (see the `images` target below and the file's own header for why they share it).
SERVICES_DOCKERFILE := $(REPO)/deployments/images/services.Dockerfile

BACKEND_IMG    := $(REGISTRY_PREFIX)/tcab-backend:local
AUTH_IMG       := $(REGISTRY_PREFIX)/tcab-auth-service:local
DISPATCHER_IMG := $(REGISTRY_PREFIX)/tcab-dispatcher:local
DRIVER_IMG     := $(REGISTRY_PREFIX)/tcab-driver:local
ARTIFACTS_IMG  := $(REGISTRY_PREFIX)/tcab-artifacts:local
ARENA_IMG      := $(REGISTRY_PREFIX)/tcab-arena:local

# The web console is intentionally absent: it runs from source locally
# (`npm run -w apps/web dev`), not as an in-cluster pod, so there is no tcab-web
# image to build or import here (see the header comment and the local overlay).
ALL_IMGS := $(BACKEND_IMG) $(AUTH_IMG) $(DISPATCHER_IMG) $(DRIVER_IMG) $(ARTIFACTS_IMG) $(ARENA_IMG)

# The run-container images — the base end-to-end image plus the per-asset-kind
# images that BAKE IN their modeling tool (`draw`/`draw-sheet`/`voxel`/`voxel-anim`,
# and the adversarial/performance tooling), all compiled from `crates/` at image
# build time (see `containers/build.sh` and `containers/*/Dockerfile`). These are
# DISTINCT from the long-lived service images above: a run pod is a per-run Job the
# dispatcher creates, running one of these images. In a deployment they come from
# the Test Cabinet ACR (core's `resolve_run_image` defaults to `testcabinet.azurecr.io`);
# locally the `run-images` target builds them from THIS checkout and imports them so
# a change to the baked-in tooling actually reaches run pods, with the local
# dispatcher overlay pointing `TCAB_CONTAINER_REGISTRY`/`_TAG` at this prefix/tag.
# The `:local` tag is what makes the kubelet's IfNotPresent default use the imported
# image rather than trying to pull it (a `:latest` tag would force a registry pull).
# `build.sh` names each image `$(RUN_IMAGE_PREFIX)<name>:$(RUN_IMAGE_TAG)` via its
# IMAGE_NAME_PREFIX/IMAGE_TAG knobs, so RUN_IMGS mirrors the set it builds.
RUN_IMAGE_PREFIX := $(REGISTRY_PREFIX)/test-cabinet-
RUN_IMAGE_TAG    := local

# The AUDIO STORE image the DRIVER SERVICE image copies its `/opt/tcab-audio` out of
# (the `FROM ${AUDIO_STORE_IMAGE}` stage in deployments/images/services.Dockerfile).
# It is not a run image — nothing executes in it, no run resolves it, and it is never
# imported into the cluster — but it is named with the run-image prefix/tag anyway,
# because `containers/build.sh` builds it and names everything it builds
# `$(IMAGE_NAME_PREFIX)<name>:$(IMAGE_TAG)`.
#
# IT IS BUILT HERE, NEVER PULLED. The published store lives in the Test Cabinet ACR,
# and taking it locally would be wrong twice over: it makes `make images` fail on any
# machine that cannot pull from that registry, and it makes trying an audio change
# require publishing a container image first. The `audio-store` target below builds the
# store from THIS checkout and `images` passes this ref in as `AUDIO_STORE_IMAGE`, so no
# local build reaches a registry for audio at all.
AUDIO_STORE_IMG := $(RUN_IMAGE_PREFIX)audio-store:$(RUN_IMAGE_TAG)

# The run images grouped by TEST TYPE, so a `run-images-<type>` target (and, for
# asset generation, a per-kind `run-image-<kind>`) can rebuild just one type / one
# asset kind instead of the whole set — the full rebuild recompiles ~20 images from
# scratch (minutes each) and is rarely what an iteration on one tool needs.
#
#   - end-to-end runs execute in the `base-wasm` image (the Node `base` plus the
#     shared Rust → wasm toolchain). The plain `base` is the FROM every other image
#     builds on but is NOT itself a run image, so it is built as needed (build.sh
#     handles it) and never imported on its own;
#   - full-stack runs execute in one of the two full-stack images, chosen by the case's
#     `asset_dimension`: `full-stack-2d` (the default) is base-wasm plus the six 2D
#     asset-generation binaries, and `full-stack-3d` is its SIBLING (also FROM base-wasm,
#     not FROM the 2D image) carrying the same six plus `voxel`, `voxel-anim`,
#     `particle-3d` and the Mesa software-Vulkan runtime those three render previews
#     through. Neither bakes any audio — a run is staged with the packs its test case
#     declares when its container starts, so neither build reads the audio object store
#     nor needs a credential. BOTH are built and imported, because which one a run
#     resolves is a property of the case, not of this Makefile;
#   - game-jam runs execute in the `game-jam` image, built `FROM` the full-stack-2d
#     image (it inherits those six binaries + the Rust/wasm toolchain and adds nothing
#     but its own identity — but its full-stack-2d parent must already be built);
#   - asset-generation runs each execute in their own per-kind image;
#   - adversarial and performance runs each execute in their own image;
#   - a `gg` run executes in the `-gg` VARIANT of the image its test type resolves —
#     that image plus the language toolchains its responses-as-code programs are
#     compiled with. There is one per run image (a program's language is resolved per
#     agent, so a gg run of ANY kind may drive a compiled-language agent), and each is
#     `FROM` its parent, so build.sh builds the parent first when it is missing and only
#     the variant ref is imported (the parent's layers are baked into it). A local gg run
#     needs these imported or it schedules against an image the cluster does not have —
#     which is what doubles the full `run-images` set; `run-images-gg` rebuilds just
#     them, and `run-image-<name>-gg` just one.
#
# `blender` (the `blender-character` asset kind) is a full member of the asset group:
# core's resolve_run_image maps that kind to `test-cabinet-blender`, the local overlay
# composes `docker.io/library/test-cabinet-blender:local` for it, and this imports that
# ref — so a blender-character run schedules against the locally-built image. Note it
# bakes headless Blender (a large third-party download), so it is the slowest asset
# image to build; rebuild it alone with `make run-image-blender` when iterating on the
# `tcab-blend` runner rather than paying for the whole `run-images-asset` group.
E2E_IMAGE_NAMES         := base-wasm
FULL_STACK_IMAGE_NAMES  := full-stack-2d full-stack-3d
GAME_JAM_IMAGE_NAMES    := game-jam
ASSET_IMAGE_NAMES       := sprite sprite-sheet voxel voxel-animation mc mc-animation sn sn-animation dc dc-animation ui material mc-skinned sn-skinned dc-skinned blender particle-2d particle-3d sfx-synth sfx-sample music
ADVERSARIAL_IMAGE_NAMES := adversarial
PERFORMANCE_IMAGE_NAMES := performance
# One per run image above, derived rather than listed for the same reason core derives
# the name: there is exactly one variant per image and no list that could be missing one.
GG_IMAGE_NAMES          := $(addsuffix -gg,$(E2E_IMAGE_NAMES) $(FULL_STACK_IMAGE_NAMES) $(GAME_JAM_IMAGE_NAMES) $(ASSET_IMAGE_NAMES) $(ADVERSARIAL_IMAGE_NAMES) $(PERFORMANCE_IMAGE_NAMES))

# The five variants `run-images-gg-selfcheck` drives `gg selfcheck` in, and the binary it
# builds to drive them with. One variant per ENVIRONMENT: every `-gg` image carries the same
# `/opt/gg` (copied with `--link`, so byte-identical), so what differs between them is the
# environment that tree has to run in — the image the lineage is rooted at, plus every package
# the run images `apt-get install` on the way down. That is five and not two, because a dozen
# run images install their own packages on top of `base` and apt brings each package's whole
# closure with it: the mesa render images carry an ICU nothing in their Dockerfiles asked for,
# which is the very library the C# arm was shipped without. `full-stack-3d-gg` is the fifth
# and the least obvious: it carries the same mesa ICU `voxel-gg` does, but on top of
# base-wasm's packages rather than the bare base's, and it is the only run image that is
# both. Named here rather than derived
# because they are the same five `containers/build.sh` names in GG_SELFCHECK_IMAGES and the
# same five `scripts/ci/run-images.sh` asserts by name. What keeps three lists
# from drifting apart is not agreement between them: `assert_gg_environments`, in build.sh,
# re-derives the grouping from the Dockerfiles and fails a gated build if any variant's
# environment has no representative.
GG_SELFCHECK_IMAGE_NAMES := sprite-gg base-wasm-gg voxel-gg full-stack-3d-gg blender-gg
GG_SELFCHECK_BIN         := $(REPO)/target/gg-selfcheck/gg

# Every run image this Makefile builds + imports locally: the union of the per-type
# groups above (so it stays in lockstep with them). Order matches build.sh's
# dependency order (base, then base-wasm which is FROM it, then full-stack-2d /
# full-stack-3d / adversarial / performance which are FROM base-wasm — and game-jam,
# which is FROM full-stack-2d, so it must follow it here).
RUN_IMAGE_NAMES  := $(E2E_IMAGE_NAMES) $(FULL_STACK_IMAGE_NAMES) $(GAME_JAM_IMAGE_NAMES) $(ASSET_IMAGE_NAMES) $(ADVERSARIAL_IMAGE_NAMES) $(PERFORMANCE_IMAGE_NAMES) $(GG_IMAGE_NAMES)

# Map a space-separated list of image NAMES to their fully-qualified `:local` refs
# (what `$(CONTAINER_TOOL) save` / `k3d image import` and the manifests resolve).
run_image_refs = $(foreach n,$(1),$(RUN_IMAGE_PREFIX)$(n):$(RUN_IMAGE_TAG))

RUN_IMGS         := $(call run_image_refs,$(RUN_IMAGE_NAMES))

# Shared dispatcher↔backend service token. A fixed dev default (no production value
# lives in the repo); override from the environment, e.g. `SERVICE_TOKEN=… make …`.
SERVICE_TOKEN ?= local-dev-service-token

# Sourced (not `include`d) at the top of any recipe that needs harness secrets, so
# keys configured in the repo-root .env reach the recipe environment without having
# to be exported by hand first. .env is gitignored (it is NOT a tracked file), so
# this keeps secrets off disk-in-the-repo just as the host-environment path does.
# `set -a` exports everything the file assigns; sourcing in-shell (rather than a
# Make `include`) lets the shell handle comments, quoting, and `=` in values — so a
# commented-out ANTHROPIC_API_KEY/OPENAI_API_KEY line is correctly left unset.
# Assignments in the file overwrite the existing environment, so the .env is the
# source of truth when present (point ENV_FILE elsewhere, or comment a line out, to
# fall back to a value exported in the shell).
ENV_FILE  ?= $(REPO)/.env
LOAD_ENV  := if [ -f '$(ENV_FILE)' ]; then set -a; . '$(ENV_FILE)'; set +a; fi

# A throwaway docker config dir used ONLY for the image builds (the `images`
# target points DOCKER_CONFIG at it). It deliberately carries no credsStore: the
# devcontainer auto-writes ~/.docker/config.json with a `credsStore` (the VS Code
# dev-containers credential helper) that the BuildKit builder invokes even for the
# PUBLIC base-image pulls and which errors hard in here — the legacy builder
# tolerated it, BuildKit does not. The service-image Dockerfiles only ever pull
# public images (the docker.io bases — the audio store the driver stage copies in is
# built locally by the `audio-store` target and never pulled), so an empty auth set
# is correct. Pointing DOCKER_CONFIG here also pins buildx to its `default`
# (docker-driver) builder, which loads the result into the daemon image store so the
# `docker save`/`k3d image import` below can find it — sidestepping any
# `docker-container` builder a host might default to.
# That pin is load-bearing for the audio store too: the driver build resolves
# `AUDIO_STORE_IMAGE` — a locally-built `:local` ref — out of that same daemon image
# store, which a `docker-container` builder could not see.
# buildx itself lives in the system cli-plugins dir, so it is still found with
# DOCKER_CONFIG overridden. Harmless for podman (it uses its own auth store).
BUILD_DOCKER_CONFIG := $(HOME)/.cache/tcab/build-docker-config

.PHONY: local-up local-down local-rebuild local-reapply local-forward local-grafana local-ingest local-status secrets cluster kubeconfig audio-store images run-images run-images-e2e run-images-full-stack run-images-game-jam run-images-asset run-images-adversarial run-images-performance run-images-gg run-images-gg-selfcheck apply apply-overlay apply-wait rollout-wait sts-reconcile

# The ingest sits BETWEEN applying the overlay and waiting for the services to become
# ready, and that order is load-bearing rather than incidental. The backend's readiness
# probe is `/readyz`, which stays 503 until its definition store holds versions (see
# crates/backend/src/readiness.rs) — and locally NOTHING fills that store but the
# `local-ingest` below: the overlay drops the base `tcab-ingest` CronJob and, unlike the
# azure-staging/azure-prod overlays, ships no ingest sidecar, precisely because the
# Makefile ingests from the mounted checkout instead. So on a cluster whose `state`
# volume is cold — a freshly created one, or any `local-down` that took the PVCs with
# it — waiting for tcab-backend to go Ready BEFORE ingesting waits for something only
# the ingest can produce, and `local-up` burns $(ROLLOUT_TIMEOUT) and then fails with
# `statefulset/tcab-backend` never ready. It is the same self-deadlock the in-pod ingest
# sidecars call out (deployments/k8s/overlays/azure-*/patch-backend-ingest.yaml: "Wait on
# /healthz (LIVENESS), never /readyz"), reached from the other side. `local-ingest` only
# needs the backend LIVE, not ready, so it runs happily in the gap; `apply-wait` then
# confirms the whole stack, backend readiness included.
local-up: cluster images run-images apply-overlay local-ingest apply-wait
	@echo ""
	@echo "Stack is up in namespace '$(NS)' (services only — the web console runs from source, see below)."
	@echo "Forward the data plane with:  make -C deployments/local local-forward"
	@echo "  backend → http://127.0.0.1:8787   auth → http://127.0.0.1:8789   artifacts → http://127.0.0.1:8790   arena → http://127.0.0.1:8791   Grafana → http://127.0.0.1:3000"
	@echo "Then start the web console from source (a separate terminal):  npm run -w apps/web dev  →  http://127.0.0.1:1430"
	@echo "  (its backend/auth URLs are baked into apps/web/.env.development — no extra flags; edits hot-reload with no image rebuild)"
	@echo "  (the backend reports the artifacts + arena URLs at GET /config; the console fetches build/media and matches/tournaments from them)"
	@echo "Observe it with Grafana at http://127.0.0.1:3000 (anonymous admin) — local-forward above already exposes it; local-grafana adds the OTLP ports for out-of-cluster exporters."

# Create the k3d cluster if it does not already exist, mapping the repository to
# /repo on the server node so the backend can ingest from a read-only mount of it
# (see the local overlay's patch-backend.yaml).
#
# The mount source must be a path the cluster's HOST daemon can see. When this runs
# inside the devcontainer (Docker-outside-of-Docker), $(REPO) is an in-container
# path the host daemon knows nothing about — but the workspace is itself a bind
# mount from the host, so the host path is the Source of this devcontainer's mount
# at $(REPO). Read it back by inspecting our own container (named by hostname) and
# pass THAT to k3d. On a bare host the inspect finds no such mount and we fall back
# to $(REPO), which is already a real host path there.
cluster:
	@if k3d cluster list --no-headers 2>/dev/null | awk '{print $$1}' | grep -Fxq '$(CLUSTER)'; then \
	  echo "k3d cluster '$(CLUSTER)' already exists."; \
	else \
	  host_repo="$$(docker inspect "$$(hostname)" --format '{{range .Mounts}}{{if eq .Destination "$(REPO)"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"; \
	  if [ -z "$$host_repo" ]; then host_repo='$(REPO)'; fi; \
	  echo "Creating k3d cluster '$(CLUSTER)' on $(K3S_IMAGE) (mounting $$host_repo → /repo)…"; \
	  k3d cluster create '$(CLUSTER)' --image '$(K3S_IMAGE)' --volume "$$host_repo:/repo@server:0" \
	    --k3s-arg '--kubelet-arg=$(KUBELET_IMAGE_GC_ARG)@server:*' --wait; \
	fi
	@k3d kubeconfig merge '$(CLUSTER)' --kubeconfig-merge-default --kubeconfig-switch-context >/dev/null
	@$(MAKE) -s -f '$(firstword $(MAKEFILE_LIST))' kubeconfig
	@$(MAKE) -s -f '$(firstword $(MAKEFILE_LIST))' cluster-kubelet

# Ensure an EXISTING cluster's server node runs with $(KUBELET_IMAGE_GC_ARG). A node
# created by the `cluster` target above already carries it on its command line; one
# created before the flag existed does not, and k3d cannot change a node's arguments
# after the fact. k3s also reads /etc/rancher/k3s/config.yaml at start, so write the
# kubelet argument there and restart the node once — the container's writable layer
# keeps the file (and the PVC-backed state) across the restart. Idempotent: a node that
# has the flag either way is left alone.
K3D_SERVER_NODE := k3d-$(CLUSTER)-server-0
cluster-kubelet:
	@node='$(K3D_SERVER_NODE)'; \
	if $(CONTAINER_TOOL) inspect "$$node" --format '{{join .Args " "}}' 2>/dev/null | grep -Fq -- '--kubelet-arg=$(KUBELET_IMAGE_GC_ARG)'; then exit 0; fi; \
	if $(CONTAINER_TOOL) exec "$$node" grep -Fqs -- '$(KUBELET_IMAGE_GC_ARG)' /etc/rancher/k3s/config.yaml; then exit 0; fi; \
	echo "Node $$node runs with the kubelet's image garbage collector ON; writing $(KUBELET_IMAGE_GC_ARG) into its k3s config.yaml and restarting it…"; \
	$(CONTAINER_TOOL) exec "$$node" sh -c 'mkdir -p /etc/rancher/k3s && printf "kubelet-arg:\n  - $(KUBELET_IMAGE_GC_ARG)\n" > /etc/rancher/k3s/config.yaml'; \
	$(CONTAINER_TOOL) stop -t 60 "$$node" >/dev/null && $(CONTAINER_TOOL) start "$$node" >/dev/null; \
	echo "Waiting for $$node to report Ready (up to $(ROLLOUT_TIMEOUT))…"; \
	deadline=$$(( $$(date +%s) + $$(echo '$(ROLLOUT_TIMEOUT)' | sed 's/s$$//') )); \
	until $(KUBECTL) wait node "$$node" --for=condition=Ready --timeout=10s >/dev/null 2>&1; do \
	  if [ "$$(date +%s)" -ge "$$deadline" ]; then echo "ERROR: $$node did not become Ready within $(ROLLOUT_TIMEOUT)." >&2; exit 1; fi; \
	  sleep 2; \
	done; \
	echo "Node $$node is Ready with image garbage collection disabled."

# Make the merged kubeconfig reachable from inside the devcontainer. When the
# devcontainer drives the HOST Docker daemon, `k3d kubeconfig merge` records the
# API server with a host IP that is not dialable from in here (e.g.
# https://0.0.0.0:<port>), so kubectl cannot reach the API server. Repoint the
# cluster's server at host.docker.internal — the host loopback the daemon
# publishes the API port on (the devcontainer maps it via extra_hosts) — while
# KEEPING TLS verification by pinning tls-server-name to `localhost`, a SAN the
# k3s API certificate actually carries (k3d adds it by default).
#
# The API port MUST be read from k3d's own view (`k3d kubeconfig get`), which
# always reflects the cluster's CURRENT published host port — never from the
# already-merged kubeconfig. Two reasons: (1) `k3d kubeconfig merge` does NOT
# overwrite an existing cluster entry's server, so reading the port back from the
# merged file would just re-pin whatever was last written; (2) the published host
# port is reassigned whenever the serverlb container is recreated (e.g. a docker
# or host restart), so a port cached in the kubeconfig goes stale. Idempotent:
# re-running re-pins to the live port. This targets the devcontainer's
# host.docker.internal (Docker-outside-of-Docker, mapped via extra_hosts) and
# deliberately does NOT fall back for a bare host: if that name does not resolve,
# the failure should surface plainly rather than be papered over.
kubeconfig:
	@server="$$(k3d kubeconfig get '$(CLUSTER)' 2>/dev/null | grep -E '^[[:space:]]*server:' | head -n1)"; \
	if [ -z "$$server" ]; then \
	  echo "ERROR: could not read the API server for cluster '$(CLUSTER)' from k3d; run 'make cluster' first." >&2; exit 1; \
	fi; \
	hostport="$${server##*://}"; \
	port="$${hostport##*:}"; \
	case "$$port" in (''|*[!0-9]*) echo "ERROR: could not parse the API port from k3d server '$$server'." >&2; exit 1;; esac; \
	kubectl config set-cluster '$(KUBE_CTX)' --server="https://host.docker.internal:$$port" >/dev/null; \
	kubectl config set 'clusters.$(KUBE_CTX).tls-server-name' localhost >/dev/null; \
	echo "kubeconfig: '$(KUBE_CTX)' server → https://host.docker.internal:$$port (tls-server-name=localhost)."

# Save a set of already-built images and import them into the k3d cluster. $(1) is the
# space-separated list of fully-qualified refs. Both the service-image target and every
# run-image target go through this, so the two paths cannot drift.
#
# ONE ARCHIVE, NOT ONE PER IMAGE. `$(CONTAINER_TOOL) save a b c` writes each distinct blob
# ONCE however many of the images share it; a tar per image cannot share anything, so every
# image re-writes the whole base it inherits. That is not a rounding error on this image
# set: the twenty-seven non-gg run images are 8.5 GB as separate tars and 1.23 GB as one, and
# all fifty-four together are 23.2 GB as one archive — the entire non-gg set rides along for
# free once the gg set is in it. Every byte saved here is paid three times over, because it
# is written to disk, streamed into the node, and unpacked into the node's snapshotter.
#
# Sharing only works if the images genuinely share layer DIGESTS, which for the `-gg`
# variants is what `--link` in containers/gg/Dockerfile buys; see the comment there.
#
# Images are imported as a saved archive rather than by name: `k3d image import` does its
# own `save` from a name through the runtime, which fails on podman (the name resolves under
# a `localhost/` prefix). Saving ourselves and importing the archive sidesteps that entirely
# and works on both docker and podman.
#
# `-m direct` streams the archive straight into each node's containerd. The default
# (`tools-node`) instead starts a helper container and copies the archive into a shared
# volume first — a full extra write of every byte, which on the gg set was minutes of the
# import all by itself. Direct mode is not the riskier choice: the one archive shape that
# breaks it, a MULTI-PLATFORM image whose other platforms' blobs are not in the local store,
# fails identically under `tools-node` (`ctr: content digest …: not found`). Everything this
# Makefile imports is built locally for one platform, so neither mode ever sees that shape.
#
# THE GREP IS A REAL GATE, NOT BELT AND BRACES. `k3d image import` prints a per-node
# `failed to import images in node` on ERRO and then exits 0 with "Successfully imported
# image(s)" anyway. Without this check a failed import is indistinguishable from a good one
# here, and the first symptom is a run pod in ImagePullBackOff minutes later.
define save_and_import
	@set -e; tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	  echo "Saving $(words $(1)) image(s) to one archive …"; \
	  $(CONTAINER_TOOL) save -o "$$tmp/images.tar" $(1); \
	  k3d image import "$$tmp/images.tar" -c '$(CLUSTER)' -m direct 2>&1 | tee "$$tmp/import.log"; \
	  if grep -q 'failed to import images in node' "$$tmp/import.log"; then \
	    echo "ERROR: k3d reported a per-node import failure above (it still exits 0 — see the comment on save_and_import)." >&2; \
	    exit 1; \
	  fi
endef

# Build the AUDIO STORE the driver image is given, out of THIS checkout — never pulled.
#
# The driver stages each run's declared `[audio] packs` into its run container out of a
# host store at /opt/tcab-audio (crates/core `audio_stage`), and the driver IMAGE is what
# carries that store in a deployment: services.Dockerfile has a
# `FROM ${AUDIO_STORE_IMAGE}` stage it copies the tree from. A local build passes a
# store built from the checkout rather than the published one — see AUDIO_STORE_IMG
# above for why. This target produces the ref `images` passes in.
#
# Three sources, in order:
#
#   1. THE AUDIO OBJECT STORE, when the CLOUDFLARE_AUDIO_R2_PRESIGN pair is in the
#      environment or $(ENV_FILE) — the normal case for anyone working on audio, and the
#      only one that is authoritative. `containers/build.sh audio-store` runs
#      scripts/stage-audio-store.mjs, which presigns a short-lived read-only GET for
#      every published object and verifies each against
#      containers/sample-packs/objects.lock.json before it lands, then builds the
#      data-only image from the staged tree. THIS IS THE AUDIO ITERATION LOOP: publish a
#      pack (`node scripts/build-sample-pack.mjs <pack> --publish`, commit the updated
#      lock), re-run `make images`, enqueue a run. Nothing is pushed to a registry, and
#      the stager's content-addressed download cache means a re-stage re-reads only the
#      bytes it does not already have.
#   2. A TREE ALREADY STAGED at dist/audio-store/tree by an earlier run, when the
#      credentials are absent. It is exactly what that staging produced, so it is as
#      current as the last one, and a machine that has staged once keeps building
#      offline.
#   3. NEITHER — an EMPTY store, loudly. A contributor with no audio credentials still
#      gets a stack that comes up, and every case declaring no packs (every end-to-end,
#      adversarial and performance run, and every sfx-synth one) is unaffected. A case
#      that DOES declare packs then fails at staging with a clear error, which is a much
#      better failure than `make images` dying for everybody.
audio-store: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
audio-store:
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	@$(LOAD_ENV); \
	if [ -n "$${CLOUDFLARE_AUDIO_R2_PRESIGN_ACCESS_KEY_ID:-}" ] && [ -n "$${CLOUDFLARE_AUDIO_R2_PRESIGN_SECRET_ACCESS_KEY:-}" ]; then \
	  echo '==> staging the audio store from the audio object store'; \
	  IMAGE_NAME_PREFIX='$(RUN_IMAGE_PREFIX)' IMAGE_TAG='$(RUN_IMAGE_TAG)' DOCKER='$(CONTAINER_TOOL)' \
	    bash '$(REPO)/containers/build.sh' audio-store; \
	elif [ -f '$(REPO)/dist/audio-store/tree/objects.lock.json' ]; then \
	  echo '==> WARNING: no CLOUDFLARE_AUDIO_R2_PRESIGN credentials in the environment or $(ENV_FILE);'; \
	  echo '             reusing the store already staged at dist/audio-store/tree.'; \
	  $(CONTAINER_TOOL) build --build-arg AUDIO_STAGE_DIR=dist/audio-store/tree \
	    -t '$(AUDIO_STORE_IMG)' -f '$(REPO)/containers/audio-store/Dockerfile' '$(REPO)'; \
	else \
	  echo '==> WARNING: no CLOUDFLARE_AUDIO_R2_PRESIGN credentials and nothing staged at'; \
	  echo '             dist/audio-store/tree — building an EMPTY $(AUDIO_STORE_IMG).'; \
	  echo '             The stack comes up and every case that declares no [audio] packs runs'; \
	  echo '             normally; a full-stack, game-jam, sfx-sample or music case that DOES'; \
	  echo '             declare packs will fail at staging. Put the CLOUDFLARE_AUDIO_R2_PRESIGN'; \
	  echo '             pair in $(ENV_FILE) and re-run `make audio-store`.'; \
	  mkdir -p '$(REPO)/dist/audio-store/tree'; \
	  $(CONTAINER_TOOL) build --build-arg AUDIO_STAGE_DIR=dist/audio-store/tree \
	    -t '$(AUDIO_STORE_IMG)' -f '$(REPO)/containers/audio-store/Dockerfile' '$(REPO)'; \
	fi

# Build the service images from the same Dockerfile the cluster uses, then load
# them into the cluster's nodes (no registry needed for local development).
#
# All six come out of ONE file, deployments/images/services.Dockerfile, each
# selected with `--target`. That file shares a single cargo build stage across every
# service, so the six builds below compile the workspace ONCE between them: the
# first `docker build` runs the shared stage and the other five hit it in the layer
# cache. (When they were six separate Dockerfiles each re-dirtied the shared cargo
# target/ cache mount, so every service rebuilt the ~19 workspace crates it pulls in
# — six times over per `make images`, even with no source change.)
#
# It is a BuildKit Dockerfile (`# syntax=…` + `--mount=type=cache` Rust build
# caches), so the build needs the buildx plugin — the devcontainer ships it in the
# system cli-plugins dir (see .devcontainer/tools/docker.sh); a bare host gets it
# from its docker install. DOCKER_CONFIG is pinned to a credsStore-free config dir
# for the builds (see BUILD_DOCKER_CONFIG above for why).
#
# Saving and importing is `save_and_import` above — one archive for the whole set, not one
# per image, imported in k3d's direct mode. The reasons are written down there.
#
# The `audio-store` prerequisite builds the store the DRIVER line copies in, from this
# checkout, and the driver build is pointed at it with `--build-arg AUDIO_STORE_IMAGE`,
# which the Dockerfile requires for that target. Building the store locally keeps a local
# build off the registry and makes an audio change testable before it has been
# published. See the `audio-store` target.
#
# THE BACKEND AND DRIVER LINES ARE THE SLOW ONES, AND THE FIRST RUN IS MUCH THE
# SLOWEST. Both depend on the gg stage: the driver bakes the `gg` binary itself, and the
# backend bakes the reference documents that binary projects (`gg reference --out`,
# served at /gg/reference). gg's build reflects a signature catalogue out of each of its
# eleven program languages' SDKs — nothing is committed under crates/gg/src/sandbox/guests
# any more — so that stage installs every one of those toolchains
# (scripts/ci/install-gg-toolchains.sh, ~1.9 GB) and runs eleven documentation tools.
# They live in BuildKit cache mounts rather than in image layers, so a second
# `make images` on the same machine re-downloads nothing and re-reflects only the arms
# whose SDK changed; a pruned builder pays for all of it again. The two lines share the
# stage, so the SECOND of them is cheap — the cost is paid once, by whichever runs first,
# which since the backend leads the list below is normally the backend. This is the
# fastest way to find out that the gg stage is broken, which is why it is worth knowing it
# is normal for it to take minutes rather than seconds.
images: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
images: audio-store
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --target backend    -t '$(BACKEND_IMG)'    -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --target auth       -t '$(AUTH_IMG)'       -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --target dispatcher -t '$(DISPATCHER_IMG)' -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --build-arg AUDIO_STORE_IMAGE='$(AUDIO_STORE_IMG)' \
	                        --target driver    -t '$(DRIVER_IMG)'     -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --target artifacts  -t '$(ARTIFACTS_IMG)'  -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' --target arena      -t '$(ARENA_IMG)'      -f '$(SERVICES_DOCKERFILE)' '$(REPO)'
	$(call save_and_import,$(ALL_IMGS))

# Build the run-container images (the base + per-asset-kind images with their
# baked-in modeling tool compiled from `crates/`) and import them into the cluster,
# so run pods use THIS checkout's tooling instead of the published ACR images. This
# is the run-pod counterpart of the service-image `images` target and is what closes
# the gap where a change to `voxel-anim`/`draw`/the core modeling library never
# reaches a run: those tools live in these images, not in any service.
#
# It is DELIBERATELY separate from `local-rebuild` (which rebuilds only the service
# images) and is instead folded into `local-up`. Run it after changing the baked-in
# tooling — `voxel-anim`, `voxel`, `draw`/`draw-sheet`, the Foray/Lattice tooling, or
# the core modeling library any of them link — then enqueue a run (driver Jobs
# resolve the run image fresh each run, so no service restart is needed to pick the
# new image up).
#
# Every asset image's binaries now come out of ONE shared tooling builder
# (`containers/tools/Dockerfile`), which carries cargo cache mounts — so the whole
# asset set costs a single incremental compile plus a per-image layer export, rather
# than the from-scratch recompile per image it used to be. `build.sh` always rebuilds
# that builder when an asset image is selected, so a tooling change can never be
# missed. The per-type targets below are still worth reaching for (each image still
# has to be exported and re-imported into the cluster), just no longer to dodge a
# multi-minute recompile:
#   - `run-images`               everything (what local-up runs; the heavy path)
#   - `run-images-e2e`           the base-wasm image (an end-to-end / base-layer change)
#   - `run-images-full-stack`    both full-stack images, 2d and 3d (needs the R2 pack credentials)
#   - `run-images-game-jam`      the game-jam image (FROM full-stack-2d, which must be built first)
#   - `run-images-asset`         every asset-generation kind
#   - `run-image-<kind>`         one asset kind, e.g. `run-image-voxel-animation`
#                                (you changed only `voxel-anim` → rebuild only that image)
#   - `run-images-adversarial`   the adversarial image (a Foray change)
#   - `run-images-performance`   the performance image (a Lattice change)
#   - `run-images-gg`            the `-gg` variants (a gg language-toolchain change)
# Every variant builds the FROM base first when it is missing (build.sh handles this),
# so a narrow target works even on a cluster that has never built base — though normal
# use is after `local-up` has already imported the full set once.
#
# `build.sh` builds each named image from the repo root; its IMAGE_NAME_PREFIX/IMAGE_TAG
# name them to match RUN_IMGS, and DOCKER selects the same runtime the service images
# use. The BuildKit-vs-credsStore DOCKER_CONFIG pin from `images` applies here too
# (these Dockerfiles also pull only public base images).
#
# `build_import_run_images` is the shared body every run-image target uses: build the
# named images with build.sh (which (re)builds the FROM base when it is missing OR older
# than its own Dockerfile, cascading down the layers), then hand them
# to `save_and_import` above, which saves the whole selection into ONE archive and imports
# it. $(1) is the space-separated list of image NAMES to pass to build.sh; $(2) is the
# matching list of fully-qualified refs to save + import (normally
# `$(call run_image_refs,$(1))`). Since an asset/adversarial/performance image bakes its
# base's layers in, importing just those refs is enough for their run pods — the plain `base` image is never imported on its own (it is not
# a run image); end-to-end runs schedule against `base-wasm`, imported via the
# `run-images-e2e` group and the full `run-images`.
define build_import_run_images
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	IMAGE_NAME_PREFIX='$(RUN_IMAGE_PREFIX)' IMAGE_TAG='$(RUN_IMAGE_TAG)' DOCKER='$(CONTAINER_TOOL)' \
	  bash '$(REPO)/containers/build.sh' $(1)
	$(call save_and_import,$(2))
endef

# Rebuild + import EVERY run image (what `local-up` runs). The heavy path — prefer a
# narrower target below when iterating on one test type or one asset kind. Passes the
# explicit RUN_IMAGE_NAMES set to build.sh (rather than letting it build all) so it
# builds exactly what it imports.
run-images: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images:
	$(call build_import_run_images,$(RUN_IMAGE_NAMES),$(RUN_IMGS))

# Per-test-type rebuilds — the fast paths after changing one type's baked-in tooling.
# `-e2e` rebuilds the base-wasm image (build.sh (re)builds the plain base it is FROM as
# needed); `-asset` rebuilds all asset-generation kinds; `-adversarial` / `-performance`
# each rebuild their one image. build.sh auto-(re)builds the base/base-wasm parents when
# a group needs them.
run-images-e2e: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-e2e:
	$(call build_import_run_images,$(E2E_IMAGE_NAMES),$(call run_image_refs,$(E2E_IMAGE_NAMES)))

# `-full-stack` rebuilds BOTH full-stack images — full-stack-2d (base-wasm plus the six
# 2D asset binaries) and full-stack-3d (the same, plus `voxel`, `voxel-anim`,
# `particle-3d` and the Mesa runtime they render previews through). They are siblings, not
# a chain, so neither is a by-product of building the other and a local cluster missing one
# cannot schedule a case that resolves it. Neither bakes audio, so neither needs a
# credential.
run-images-full-stack: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-full-stack:
	$(call build_import_run_images,$(FULL_STACK_IMAGE_NAMES),$(call run_image_refs,$(FULL_STACK_IMAGE_NAMES)))

# `-game-jam` rebuilds the game-jam image, which is built `FROM` the full-stack-2d image.
# build.sh (re)builds full-stack-2d first when it is missing. Only the game-jam ref is
# imported; its full-stack-2d parent's layers are baked into it.
run-images-game-jam: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-game-jam:
	$(call build_import_run_images,$(GAME_JAM_IMAGE_NAMES),$(call run_image_refs,$(GAME_JAM_IMAGE_NAMES)))

run-images-asset: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-asset:
	$(call build_import_run_images,$(ASSET_IMAGE_NAMES),$(call run_image_refs,$(ASSET_IMAGE_NAMES)))

run-images-adversarial: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-adversarial:
	$(call build_import_run_images,$(ADVERSARIAL_IMAGE_NAMES),$(call run_image_refs,$(ADVERSARIAL_IMAGE_NAMES)))

run-images-performance: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-performance:
	$(call build_import_run_images,$(PERFORMANCE_IMAGE_NAMES),$(call run_image_refs,$(PERFORMANCE_IMAGE_NAMES)))

# `-gg` rebuilds the gg variants: every run image, plus the language toolchains a
# responses-as-code program is compiled with. build.sh builds the shared toolchain
# builder first (always — it carries the compilers, so a stale one would bake yesterday's
# toolchain in) and each variant's parent when that is missing. Only the variant refs are
# imported; their parents' layers are in them. This is the whole set —
# `make run-image-sprite-gg` rebuilds one.
run-images-gg: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-gg:
	$(call build_import_run_images,$(GG_IMAGE_NAMES),$(call run_image_refs,$(GG_IMAGE_NAMES)))

# Ask the question building a `-gg` variant does not: do the eleven language toolchains it
# carries actually RUN in the image they were copied into?
#
# Nothing above answers that. A variant is one `COPY` of a compiler tree onto a parent, and
# every gate those compilers have — the installers' own verification compiles, the Rust
# suite, the catalogue reflection — runs on the machine that ASSEMBLED the tree rather than
# inside the image it ships in. The C# arm was dead in twenty-five published images for
# exactly that reason: `csc` aborted at CLR start-up for want of an ICU the toolchain did
# not carry, and the installer's verification passed because the builder stage it ran in had
# apt-installed one and then exported `/opt/gg` without it.
#
# So this target builds the static `gg` a run is actually given (`scripts/build-gg-static.sh`
# — the same binary the driver image bakes in) and hands it to `containers/build.sh
# --gg-selfcheck`, which drives every arm's real bootstrap turn inside each image it builds,
# as the unprivileged `node` run user, in the gap where CI pushes. It is the SAME
# invocation `scripts/ci/run-images.sh` publishes behind, which is what makes a
# green run here mean something: not a local approximation of the gate, the gate.
#
# FIVE IMAGES, NOT TWENTY-SEVEN. `/opt/gg` is byte-identical across every variant (the
# `--link` COPY in containers/gg/Dockerfile), so what can differ is the environment it runs
# in — and there are five of those, not the two parents it looks like: `sprite-gg` is the
# shared base, `base-wasm-gg` adds base-wasm's packages, `voxel-gg` adds the mesa stack the
# render images install, `full-stack-3d-gg` is the one image that has BOTH base-wasm's
# packages and that mesa stack, and `blender-gg` is the Ubuntu lineage. build.sh refuses the
# flag against a selection containing none of them, and re-derives the grouping from the
# Dockerfiles before it builds anything.
#
# It BUILDS but does not IMPORT: this is a question about the images, not a way to put them
# in the cluster — `run-images-gg` is what the cluster needs. Expect minutes: the check
# compiles one program per arm eleven times over (~35 s per image once the toolchain builder
# and every parent is cached; the first run pays for those instead — and two of the five
# parents bake tooling binaries, so that first run also builds the `tools` Rust builder).
#
# The binary is written under the repository's own gitignored `target/`, beside where
# `gg-reference`/`gg-artifacts` land, rather than into a temporary directory — it is ~750 MB
# and rebuilding it for every check is the slow half of this target.
#
# NONE OF THE FIVE PARENTS NEEDS A CREDENTIAL. `full-stack-3d` bakes no audio, as the 2D
# image does not — the packs a run may reach are staged into its container at start time
# from what its test case declares — so build.sh needs nothing from the audio object store
# to build that parent, which it does the first time this target runs.
run-images-gg-selfcheck: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-gg-selfcheck:
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	bash '$(REPO)/scripts/build-gg-static.sh' '$(GG_SELFCHECK_BIN)'
	IMAGE_NAME_PREFIX='$(RUN_IMAGE_PREFIX)' IMAGE_TAG='$(RUN_IMAGE_TAG)' DOCKER='$(CONTAINER_TOOL)' \
	  bash '$(REPO)/containers/build.sh' --gg-selfcheck '$(GG_SELFCHECK_BIN)' $(GG_SELFCHECK_IMAGE_NAMES)

# Rebuild + import a SINGLE run image by its short name — the finest grain, for
# iterating on one asset-generation kind (`make run-image-voxel-animation`,
# `make run-image-blender`, …). Works for any image build.sh knows. build.sh
# validates `$*` and auto-builds the FROM base if it is missing.
run-image-%: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-image-%:
	$(call build_import_run_images,$*,$(call run_image_refs,$*))

# Create the cluster Secrets from the host ENVIRONMENT and signed-in CLI files, so
# no API key or token is ever written to a tracked file (the local overlay
# deliberately omits them). Runs automatically as part of `apply`; run it on its
# own after rotating a key, then enqueue a run (driver Jobs pick up the Secrets
# fresh each run) or `local-rebuild` to restart the long-lived services. Idempotent
# — re-running updates each Secret in place.
#
# Requires at least one harness API key in the environment OR the repo-root .env
# (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY); only the key(s)
# present are included. The .env is sourced (see LOAD_ENV) before the keys are
# read, so its assignments take effect here.
#
# OPTIONALLY also builds tcab-driver-subscription from the host's signed-in harness
# CLI credential files (the same files the local `tcab run` reads): Claude's
# ~/.claude/.credentials.json (+ ~/.claude.json), Codex's $CODEX_HOME/auth.json
# (default ~/.codex/auth.json), and the Antigravity OAuth token. Unlike the API-key
# block this NEVER errors when the files are absent — subscription is opt-in; the
# Secret is mounted optional, so missing creds just leave runs API-key-only.
secrets:
	@$(KUBECTL) create namespace '$(NS)' --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null
	@set -e; \
	  $(LOAD_ENV); \
	  extra=""; \
	  if [ -n "$$OPENROUTER_API_KEY" ]; then extra="--from-literal=TCAB_OPENROUTER_API_KEY=$$OPENROUTER_API_KEY"; fi; \
	  $(KUBECTL) -n '$(NS)' create secret generic tcab-backend-secrets \
	    --from-literal=TCAB_BACKEND_SERVICE_TOKEN='$(SERVICE_TOKEN)' $$extra \
	    --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null
	@$(KUBECTL) -n '$(NS)' create secret generic tcab-dispatcher-secrets \
	  --from-literal=TCAB_BACKEND_SERVICE_TOKEN='$(SERVICE_TOKEN)' \
	  --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null
	@set -e; \
	  $(LOAD_ENV); \
	  args=""; \
	  if [ -n "$$ANTHROPIC_API_KEY" ];  then args="$$args --from-literal=ANTHROPIC_API_KEY=$$ANTHROPIC_API_KEY"; fi; \
	  if [ -n "$$OPENAI_API_KEY" ];     then args="$$args --from-literal=OPENAI_API_KEY=$$OPENAI_API_KEY"; fi; \
	  if [ -n "$$OPENROUTER_API_KEY" ]; then args="$$args --from-literal=OPENROUTER_API_KEY=$$OPENROUTER_API_KEY"; fi; \
	  if [ -z "$$args" ]; then \
	    echo "ERROR: no harness API key found in the environment or $(ENV_FILE)."; \
	    echo "       Export (or set in $(ENV_FILE)) at least one of"; \
	    echo "       ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY"; \
	    echo "       before running this (it injects the key into each driver Job)."; \
	    exit 1; \
	  fi; \
	  $(KUBECTL) -n '$(NS)' create secret generic tcab-driver-secrets $$args \
	    --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null
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
	    $(KUBECTL) -n '$(NS)' create secret generic tcab-driver-subscription $$args \
	      --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null; \
	    echo "Subscription creds applied to tcab-driver-subscription (opt-in)."; \
	  else \
	    echo "No host subscription creds found — skipping tcab-driver-subscription (runs stay API-key-only)."; \
	  fi

# Reconcile the StatefulSet fields Kubernetes forbids changing in place, so the
# apply that follows can succeed.
#
# A StatefulSet's `volumeClaimTemplates` are IMMUTABLE: once the object exists,
# adding, removing, or resizing a claim makes every later apply fail with
# "updates to statefulset spec for fields other than 'replicas' ... are
# forbidden". That aborts the WHOLE `apply -k`, so one stale StatefulSet blocks
# every unrelated manifest change with it — which is what broke local-rebuild
# when the LGTM stack moved its stores onto PVCs (one volume -> five) against a
# cluster still running the one-volume tcab-lgtm.
#
# So: render the overlay, compare each StatefulSet's claims against the live
# object, and delete the ones that differ. Only the StatefulSet is deleted — the
# PVCs are retained (the default persistentVolumeClaimRetentionPolicy) and are
# re-bound by name when the apply recreates it, so existing volumes keep their
# data. The pod is replaced, which it must be anyway to mount the new volumes.
# This is a StatefulSet-only rule; Deployments are unaffected.
#
# Staging/prod deliberately do NOT do this: they take the `--cascade=orphan`
# route (see the note in k8s/components/observability/lgtm.yaml) to keep the pod
# serving while the object is recreated. Locally that downtime is worth nothing.
sts-reconcile:
	@set -e; \
	  desired="$$($(KUBECTL) apply -k '$(OVERLAY)' --dry-run=client -o json)"; \
	  claims='[.spec.volumeClaimTemplates[]? | {name: .metadata.name, storage: .spec.resources.requests.storage, modes: .spec.accessModes, class: .spec.storageClassName}]'; \
	  for name in $$(printf '%s' "$$desired" | jq -r '.items[] | select(.kind == "StatefulSet") | .metadata.name'); do \
	    live="$$($(KUBECTL) -n '$(NS)' get statefulset "$$name" -o json 2>/dev/null || true)"; \
	    [ -n "$$live" ] || continue; \
	    want="$$(printf '%s' "$$desired" | jq -S -c --arg n "$$name" ".items[] | select(.kind == \"StatefulSet\" and .metadata.name == \$$n) | $$claims")"; \
	    have="$$(printf '%s' "$$live" | jq -S -c "$$claims")"; \
	    if [ "$$want" != "$$have" ]; then \
	      echo "StatefulSet '$$name': volume claims changed (an immutable field) — deleting the object so the apply recreates it; its PVCs are retained."; \
	      $(KUBECTL) -n '$(NS)' delete statefulset "$$name" --wait=true; \
	    fi; \
	  done

# How long `rollout-wait` gives EACH workload before it gives up. Deliberately
# generous, because of what runs immediately before it: a rebuild's last act prior
# to restarting the services is `k3d image import`, which pushes gigabytes of saved
# images out of one archive into the node's containerd content store, and the node can
# still be digesting that when the restart lands. A container runtime stalled that way
# has been observed to take many minutes to reap the OUTGOING pods — far past their 30s
# termination grace period, SIGKILL notwithstanding — and until those die their
# replacements cannot start. So the wait is on the node settling, not on anything
# the build produced. Lower it to fail faster when you suspect a genuinely broken
# image:
#   make local-rebuild ROLLOUT_TIMEOUT=120s
ROLLOUT_TIMEOUT ?= 600s

# How long `local-ingest` waits (in SECONDS — this one is not a kubectl duration) for a
# tcab-backend pod to reach Running before giving up. It covers scheduling and, on a
# cluster that has just imported them, the kubelet unpacking the service images; it does
# NOT cover readiness, which the ingest itself is what produces.
INGEST_POD_TIMEOUT ?= 300

# The workloads each caller waits on. `apply` covers everything the overlay owns,
# including the observability stack. `local-rebuild` restarts only the services it
# rebuilds, so it waits on exactly those — tcab-lgtm is neither rebuilt nor
# restarted there, and waiting on a rollout nobody started proves nothing.
APPLY_WORKLOADS   := statefulset/tcab-backend statefulset/tcab-auth statefulset/tcab-artifacts statefulset/tcab-lgtm deployment/tcab-arena deployment/tcab-dispatcher
RESTART_WORKLOADS := statefulset/tcab-backend statefulset/tcab-auth statefulset/tcab-artifacts deployment/tcab-arena deployment/tcab-dispatcher

# Wait for every workload in $(WAIT_WORKLOADS) to finish rolling out, then report once.
#
# This deliberately does NOT stop at the first workload that times out, the way a
# bare sequence of `rollout status` lines does. When the node's container runtime
# stalls it stalls for ALL of them at once, and an operator told only about the
# first cannot distinguish that from "the image I just built is broken" — two
# problems with completely different fixes, one of which is not a problem with the
# build at all. So: wait on all of them, name every one that failed, and print the
# evidence that separates the two cases. Pods still Terminating long past their
# grace period, and the runtime's own FailedKillPod events, mean the node is wedged
# and the answer is to wait or retry, rather than to go hunting through a build that
# in all likelihood succeeded.
rollout-wait:
	@set -u; failed=''; \
	  for w in $(WAIT_WORKLOADS); do \
	    if ! $(KUBECTL) -n '$(NS)' rollout status "$$w" --timeout='$(ROLLOUT_TIMEOUT)'; then \
	      failed="$$failed $$w"; \
	    fi; \
	  done; \
	  if [ -z "$$failed" ]; then exit 0; fi; \
	  echo "" >&2; \
	  echo "ERROR: did not become ready within $(ROLLOUT_TIMEOUT):$$failed" >&2; \
	  echo "" >&2; \
	  $(KUBECTL) -n '$(NS)' get pods >&2 || true; \
	  stuck="$$($(KUBECTL) -n '$(NS)' get pods --no-headers 2>/dev/null | awk '$$3 == "Terminating" { printf " %s", $$1 }')"; \
	  if [ -n "$$stuck" ]; then \
	    echo "" >&2; \
	    echo "Pods still Terminating:$$stuck" >&2; \
	    echo "They were SIGKILLed after a 30s grace period and the node has STILL not reaped them, so" >&2; \
	    echo "their replacements cannot start. That is a node/container-runtime stall — commonly the" >&2; \
	    echo "runtime still digesting the multi-gigabyte 'k3d image import' that ran just before this —" >&2; \
	    echo "and NOT a fault in the images that were just built. Recent kill failures, if any:" >&2; \
	    $(KUBECTL) -n '$(NS)' get events --field-selector reason=FailedKillPod 2>/dev/null | tail -5 >&2 || true; \
	    echo "" >&2; \
	    echo "Re-run this target once the node settles, or give it longer: ROLLOUT_TIMEOUT=1800s" >&2; \
	  fi; \
	  exit 1

# Apply the local overlay and wait for every service to become ready. Secrets are
# created first (from the environment) so the pods find them on their first start,
# and any StatefulSet whose immutable fields drifted is cleared out first (see
# sts-reconcile) so the apply is not rejected.
#
# Deliberately split into two halves that `apply` just re-joins, because `local-up`
# has to slot the catalog ingest BETWEEN them — see the deadlock described there.
# Callers that only ever run against an already-ingested cluster (`local-rebuild`)
# keep using the joined `apply` and are unaffected.
apply: apply-overlay apply-wait

apply-overlay: secrets sts-reconcile
	$(KUBECTL) apply -k '$(OVERLAY)'

apply-wait:
	@$(MAKE) --no-print-directory rollout-wait WAIT_WORKLOADS='$(APPLY_WORKLOADS)'

# Ingest (force) the test-case catalog from the repo the backend has mounted.
# Uses an ephemeral port-forward that is torn down when the recipe exits, then
# defers to `scripts/reingest.sh`, which streams the backend's NDJSON progress
# feed and prints a line per case — so a minute-plus scan reports progress instead
# of looking like a hang.
#
# Four guards turn the failure modes into immediate, legible errors instead of a
# silent hang: a bounded wait for a RUNNING backend pod (a port-forward started
# before one exists dies instantly with a message about the Service, which says
# nothing about the pod still being scheduled or pulling); a pre-flight check that
# host port 8787 is free (a devcontainer's editor often auto-forwards it, squatting
# the port the port-forward needs to bind, and connections to that squatter
# accept-then-stall forever); a watch that the port-forward process stays alive (its
# bind error is no longer discarded); and a bounded healthz poll
# (`--connect-timeout`/`--max-time`) so a stalled connection can never block the
# loop indefinitely.
#
# The pod wait is on Running, NOT on Ready, and it has to stay that way: `local-up`
# calls this while the backend is deliberately unready (503 on /readyz) waiting for
# the very ingest this target performs, so gating on readiness would deadlock. The
# port-forward reaches a not-yet-ready pod because `kubectl port-forward svc/…`
# selects a pod by the Service's selector rather than through its endpoints, which
# readiness has emptied.
local-ingest:
	@echo "Waiting for a running tcab-backend pod (up to $(INGEST_POD_TIMEOUT)s)…"; \
	  deadline=$$(( $$(date +%s) + $(INGEST_POD_TIMEOUT) )); \
	  until [ -n "$$($(KUBECTL) -n '$(NS)' get pod -l app.kubernetes.io/name=tcab-backend \
	                   -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' 2>/dev/null)" ]; do \
	    if [ "$$(date +%s)" -ge "$$deadline" ]; then \
	      echo "ERROR: no tcab-backend pod reached Running within $(INGEST_POD_TIMEOUT)s; cannot ingest." >&2; \
	      $(KUBECTL) -n '$(NS)' get pods >&2 || true; \
	      exit 1; \
	    fi; \
	    sleep 2; \
	  done
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
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-backend $$port:8787 >"$$pflog" 2>&1 & \
	  pf=$$!; trap 'kill $$pf 2>/dev/null; rm -f "$$pflog"' EXIT; \
	  ready=""; \
	  for i in $$(seq 1 30); do \
	    if ! kill -0 $$pf 2>/dev/null; then echo "ERROR: kubectl port-forward exited before the backend was reachable:" >&2; cat "$$pflog" >&2; exit 1; fi; \
	    if curl -fsS --connect-timeout 2 --max-time 4 http://127.0.0.1:$$port/healthz >/dev/null 2>&1; then ready=1; break; fi; \
	    sleep 1; \
	  done; \
	  if [ -z "$$ready" ]; then echo "ERROR: backend not reachable on 127.0.0.1:$$port after 30s." >&2; cat "$$pflog" >&2; exit 1; fi; \
	  BACKEND_URL=http://127.0.0.1:$$port '$(REPO)/scripts/reingest.sh'

# Hold the data-plane services open on localhost until interrupted (Ctrl-C). The web
# console is NOT forwarded here — it runs from source (`npm run -w apps/web dev` on
# 127.0.0.1:1430), reaching these same forwarded addresses. The backend + auth are
# forwarded so the console (and the CLI) can reach them; auth is separate
# because the backend no longer proxies it. The artifact + arena services are
# forwarded because the console loads a pre-publish run's build and its proof/asset
# media directly from them (as browser `<img>`/`<iframe>` requests) and POSTs
# matches/tournaments to the arena — the in-cluster `tcab-artifacts:8790` /
# `tcab-arena:8791` the backend advertises by default are not resolvable from the host
# browser (the local backend patch points `TCAB_ARTIFACTS_PUBLIC_URL` /
# `TCAB_ARENA_PUBLIC_URL` at these forwarded addresses). Everything the browser touches
# runs outside the cluster, so these forwards are required.
#
# Grafana (tcab-lgtm:3000) is forwarded here too, purely for convenience: it is the
# session an operator keeps running anyway, so folding Grafana in saves a second
# terminal for `local-grafana`. That target still exists for when you ALSO need the
# OTLP collector ports (:4318/:4317) forwarded — to export telemetry from a binary
# run OUTSIDE the cluster — which this data-plane forward deliberately leaves out.
local-forward:
	@echo "Forwarding backend→127.0.0.1:8787, auth→127.0.0.1:8789, artifacts→127.0.0.1:8790, arena→127.0.0.1:8791, Grafana→http://127.0.0.1:3000 (Ctrl-C to stop)…"
	@echo "Start the console separately with:  npm run -w apps/web dev  →  http://127.0.0.1:1430"
	@$(KUBECTL) -n '$(NS)' port-forward svc/tcab-backend 8787:8787 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-auth 8789:8789 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-artifacts 8790:8790 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-arena 8791:8791 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-lgtm 3000:3000 & \
	  wait

# Hold the in-cluster Grafana LGTM stack open on localhost until interrupted
# (Ctrl-C). Grafana's UI lands on http://127.0.0.1:3000 (anonymous admin — no
# login). The OTLP ports are forwarded too so a binary run OUTSIDE the cluster — a
# `cargo run` in the devcontainer, a host-side `tcab` CLI, or the
# browser web console — can export to the same stack by pointing its
# OTEL_EXPORTER_OTLP_ENDPOINT at http://localhost:4318 (HTTP/protobuf; the browser
# must use this :4318 port). In-cluster services need none of this — they already
# export to the `tcab-lgtm` Service directly.
local-grafana:
	@echo "Forwarding Grafana→http://127.0.0.1:3000, OTLP→127.0.0.1:4318 (HTTP) + :4317 (gRPC) (Ctrl-C to stop)…"
	@$(KUBECTL) -n '$(NS)' port-forward svc/tcab-lgtm 3000:3000 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-lgtm 4318:4318 & \
	  $(KUBECTL) -n '$(NS)' port-forward svc/tcab-lgtm 4317:4317 & \
	  wait

# Rebuild after a code change: new SERVICE images, re-import, re-apply the overlay,
# rolling restart. (Driver pods are per-run Jobs the dispatcher creates fresh each
# run, so they pick up the new tcab-driver:local image on the next run with no
# restart here.) This rebuilds ONLY the long-lived service images — NOT the
# run-container images that bake in the modeling tooling (`voxel-anim`/`draw`/`voxel`
# and the Foray/Lattice tooling). Those are rebuilt by the separate `run-images`
# target (folded into `local-up`); run it by hand after changing that baked-in
# tooling or the core modeling library it links, otherwise a run pod keeps executing
# the previously-imported (or ACR) image and a tooling change silently never reaches
# a run. The `apply` dependency is what makes a
# rebuild also pick up MANIFEST
# changes — RBAC, env, volumes — not just new image bytes; without it a Role or env
# edit silently never reaches the cluster on a rebuild (it only does on local-up).
# `kubectl apply -k` is idempotent (a no-op when nothing changed), and the rollout
# restart below still forces the pods to pick up rebuilt images even when their spec
# is byte-identical (same :local tag), which apply alone would not trigger.
#
# The restart is followed by an ingest, for the same reason `local-up` runs one: the
# rebuilt backend may read the definition store differently from the one that wrote
# it, in which case it holds itself unready until an ingest rewrites the store (see
# crates/backend/src/store.rs). Waiting for readiness without ingesting would wait
# for something only the ingest can produce. The ingest has to reach the REBUILT
# backend, so it waits for the restart to actually replace the pod first — the
# rollout restart returns before the old pod is gone, and ingesting into the old one
# would leave the store in the format the new one cannot read. An already-current
# store makes this the cheap no-op the incremental script reports.
local-rebuild: images apply
	@old="$$($(KUBECTL) -n '$(NS)' get pod -l app.kubernetes.io/name=tcab-backend \
	          -o jsonpath='{.items[0].metadata.uid}' 2>/dev/null)"; \
	  $(KUBECTL) -n '$(NS)' rollout restart $(RESTART_WORKLOADS); \
	  if [ -n "$$old" ]; then \
	    echo "Waiting for the restarted tcab-backend pod (up to $(INGEST_POD_TIMEOUT)s)…"; \
	    deadline=$$(( $$(date +%s) + $(INGEST_POD_TIMEOUT) )); \
	    while [ "$$($(KUBECTL) -n '$(NS)' get pod -l app.kubernetes.io/name=tcab-backend \
	                  -o jsonpath='{.items[0].metadata.uid}' 2>/dev/null)" = "$$old" ]; do \
	      if [ "$$(date +%s)" -ge "$$deadline" ]; then \
	        echo "ERROR: tcab-backend was not replaced within $(INGEST_POD_TIMEOUT)s." >&2; \
	        exit 1; \
	      fi; \
	      sleep 2; \
	    done; \
	  fi
	@$(MAKE) --no-print-directory local-ingest
	@$(MAKE) --no-print-directory rollout-wait WAIT_WORKLOADS='$(RESTART_WORKLOADS)'

# Re-apply the overlay ONLY, with no image rebuild or service restart — the fast
# path after a manifest-only change (RBAC, env, volumes). `kubectl apply -k` is
# idempotent, so this is a no-op when nothing changed. Use local-rebuild instead
# when code changed (it rebuilds images and restarts the pods so they pick the new
# bytes up). Object-level changes that need a pod restart to take effect (e.g. an
# env edit) still want a `kubectl -n $(NS) rollout restart …` or local-rebuild
# after this; a Role change like the driver's pods/exec RBAC takes effect for the
# next driver Job with no restart.
local-reapply: sts-reconcile
	$(KUBECTL) apply -k '$(OVERLAY)'

# Re-import EVERY service + run image already built in the container runtime, with no
# rebuild — the recovery for a node whose images are gone (a cluster created before
# `cluster` disabled the kubelet's image garbage collector, see KUBELET_IMAGE_GC_ARG).
# Runs `cluster` first so the node stops deleting what this puts back. A driver Job
# already stuck in ImagePullBackOff picks its image up on the kubelet's next retry —
# unless `cluster-kubelet` had to restart the node, which takes the backend down with
# it and fails every in-flight run as interrupted (crates/backend/src/lib.rs reaps
# them on a single-box restart); those must be launched again.
local-import: cluster
	$(call save_and_import,$(ALL_IMGS) $(RUN_IMGS))

local-status:
	$(KUBECTL) -n '$(NS)' get pods,svc,pvc

local-down:
	-k3d cluster delete '$(CLUSTER)'
