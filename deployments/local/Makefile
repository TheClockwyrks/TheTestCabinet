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
# subscription-based auth for that provider instead). The shared
# dispatcher↔backend claim token defaults to a dev value; override it with
# `SERVICE_TOKEN=… make local-up` if you want. The `secrets` target creates the
# cluster Secrets from these; nothing sensitive is ever written to a tracked file.
#
# Targets:
#   local-up        create the cluster, build+import service AND run images, apply, ingest catalog
#   local-down      delete the cluster (and everything in it)
#   local-rebuild   rebuild+import the SERVICE images, re-apply the overlay, restart the services (after a service code OR manifest change)
#   run-images      rebuild+import ALL the RUN-CONTAINER images (after changing baked-in tooling: voxel-anim/draw/core modeling) — the heavy path
#   run-images-e2e / -full-stack / -game-jam / -asset / -adversarial / -performance
#                   rebuild+import ONLY one test type's run image(s) — the fast path when you touched just that type's tooling
#   run-image-<name>  rebuild+import a SINGLE run image by short name (e.g. run-image-voxel-animation) — the finest grain, for one asset kind
#   local-reapply   re-apply the overlay ONLY (after a manifest-only change — RBAC, env, volumes; no image rebuild)
#   local-forward   foreground-forward backend→:8787, auth→:8789, artifacts→:8790, arena→:8791, AND Grafana→:3000 to localhost (the console runs from source via `npm run -w apps/web dev`)
#   local-grafana   foreground-forward Grafana→:3000 AND the OTLP collector→:4318/:4317 to localhost (use when you also need the OTLP ports; local-forward already exposes Grafana)
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
# ghcr (core's `resolve_run_image` defaults to `ghcr.io/theclockwyrks/…:latest`);
# locally the `run-images` target builds them from THIS checkout and imports them so
# a change to the baked-in tooling actually reaches run pods, with the local
# dispatcher overlay pointing `TCAB_CONTAINER_REGISTRY`/`_TAG` at this prefix/tag.
# The `:local` tag is what makes the kubelet's IfNotPresent default use the imported
# image rather than trying to pull it (a `:latest` tag would force a registry pull).
# `build.sh` names each image `$(RUN_IMAGE_PREFIX)<name>:$(RUN_IMAGE_TAG)` via its
# IMAGE_NAME_PREFIX/IMAGE_TAG knobs, so RUN_IMGS mirrors the set it builds.
RUN_IMAGE_PREFIX := $(REGISTRY_PREFIX)/test-cabinet-
RUN_IMAGE_TAG    := local

# The run images grouped by TEST TYPE, so a `run-images-<type>` target (and, for
# asset generation, a per-kind `run-image-<kind>`) can rebuild just one type / one
# asset kind instead of the whole set — the full rebuild recompiles ~20 images from
# scratch (minutes each) and is rarely what an iteration on one tool needs.
#
#   - end-to-end runs execute in the `base-wasm` image (the Node `base` plus the
#     shared Rust → wasm toolchain). The plain `base` is the FROM every other image
#     builds on but is NOT itself a run image, so it is built as needed (build.sh
#     handles it) and never imported on its own;
#   - full-stack runs execute in the `full-stack-2d` image (base-wasm plus the six 2D
#     asset-generation binaries and the two audio packs they need — so building it
#     needs the R2 PRESIGN credentials in .env, like the sfx-sample/music images);
#   - game-jam runs execute in the `game-jam` image, built `FROM` the full-stack-2d
#     image (it inherits those six binaries + baked audio packs + the Rust/wasm
#     toolchain and adds nothing but its own identity, so it needs no R2 credentials
#     of its own — but its full-stack-2d parent must already be built, which does);
#   - asset-generation runs each execute in their own per-kind image;
#   - adversarial and performance runs each execute in their own image.
#
# `blender` (the `blender-character` asset kind) is a full member of the asset group:
# core's resolve_run_image maps that kind to `test-cabinet-blender`, the local overlay
# composes `docker.io/library/test-cabinet-blender:local` for it, and this imports that
# ref — so a blender-character run schedules against the locally-built image. Note it
# bakes headless Blender (a large third-party download), so it is the slowest asset
# image to build; rebuild it alone with `make run-image-blender` when iterating on the
# `tcab-blend` runner rather than paying for the whole `run-images-asset` group.
E2E_IMAGE_NAMES         := base-wasm
FULL_STACK_IMAGE_NAMES  := full-stack-2d
GAME_JAM_IMAGE_NAMES    := game-jam
ASSET_IMAGE_NAMES       := sprite sprite-sheet voxel voxel-animation mc mc-animation sn sn-animation dc dc-animation ui material mc-skinned sn-skinned dc-skinned blender particle-2d particle-3d sfx-synth sfx-sample music
ADVERSARIAL_IMAGE_NAMES := adversarial
PERFORMANCE_IMAGE_NAMES := performance

# Every run image this Makefile builds + imports locally: the union of the per-type
# groups above (so it stays in lockstep with them). Order matches build.sh's
# dependency order (base, then base-wasm which is FROM it, then full-stack-2d /
# adversarial / performance which are FROM base-wasm — and game-jam, which is FROM
# full-stack-2d, so it must follow it here).
RUN_IMAGE_NAMES  := $(E2E_IMAGE_NAMES) $(FULL_STACK_IMAGE_NAMES) $(GAME_JAM_IMAGE_NAMES) $(ASSET_IMAGE_NAMES) $(ADVERSARIAL_IMAGE_NAMES) $(PERFORMANCE_IMAGE_NAMES)

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
# public docker.io images, so an empty auth set is correct. Pointing DOCKER_CONFIG
# here also pins buildx to its `default` (docker-driver) builder, which loads the
# result into the daemon image store so the `docker save`/`k3d image import` below
# can find it — sidestepping any `docker-container` builder a host might default to.
# buildx itself lives in the system cli-plugins dir, so it is still found with
# DOCKER_CONFIG overridden. Harmless for podman (it uses its own auth store).
BUILD_DOCKER_CONFIG := $(HOME)/.cache/tcab/build-docker-config

.PHONY: local-up local-down local-rebuild local-reapply local-forward local-grafana local-ingest local-status secrets cluster kubeconfig images run-images run-images-e2e run-images-full-stack run-images-game-jam run-images-asset run-images-adversarial run-images-performance apply

local-up: cluster images run-images apply local-ingest
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
	  echo "Creating k3d cluster '$(CLUSTER)' (mounting $$host_repo → /repo)…"; \
	  k3d cluster create '$(CLUSTER)' --volume "$$host_repo:/repo@server:0" --wait; \
	fi
	@k3d kubeconfig merge '$(CLUSTER)' --kubeconfig-merge-default --kubeconfig-switch-context >/dev/null
	@$(MAKE) -s -f '$(firstword $(MAKEFILE_LIST))' kubeconfig

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

# Build the service images from the same Dockerfiles the cluster uses, then load
# them into the cluster's nodes (no registry needed for local development).
#
# The Dockerfiles are BuildKit Dockerfiles (`# syntax=…` + `--mount=type=cache`
# Rust build caches), so the build needs the buildx plugin — the devcontainer ships
# it in the system cli-plugins dir (see .devcontainer/tools/docker.sh); a bare host
# gets it from its docker install. DOCKER_CONFIG is pinned to a credsStore-free
# config dir for the builds (see BUILD_DOCKER_CONFIG above for why).
#
# Images are imported as saved tarballs rather than by name: `k3d image import`
# does its own `save` from a name through the runtime, which fails on podman (the
# name resolves under a `localhost/` prefix). Saving with $(CONTAINER_TOOL)
# ourselves and importing the tar sidesteps that entirely and works on both docker
# and podman.
images: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
images:
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(BACKEND_IMG)'    -f '$(REPO)/deployments/images/backend.Dockerfile'    '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(AUTH_IMG)'       -f '$(REPO)/deployments/images/auth.Dockerfile'       '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(DISPATCHER_IMG)' -f '$(REPO)/deployments/images/dispatcher.Dockerfile' '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(DRIVER_IMG)'     -f '$(REPO)/deployments/images/driver.Dockerfile'     '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(ARTIFACTS_IMG)'  -f '$(REPO)/deployments/images/artifacts.Dockerfile'  '$(REPO)'
	$(CONTAINER_TOOL) build --build-arg TCAB_BUILD_COMMIT='$(TCAB_COMMIT)' -t '$(ARENA_IMG)'      -f '$(REPO)/deployments/images/arena.Dockerfile'      '$(REPO)'
	@set -e; tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	  i=0; tars=""; \
	  for img in $(ALL_IMGS); do \
	    i=$$((i+1)); \
	    echo "Saving $$img …"; \
	    $(CONTAINER_TOOL) save -o "$$tmp/img-$$i.tar" "$$img"; \
	    tars="$$tars $$tmp/img-$$i.tar"; \
	  done; \
	  k3d image import $$tars -c '$(CLUSTER)'

# Build the run-container images (the base + per-asset-kind images with their
# baked-in modeling tool compiled from `crates/`) and import them into the cluster,
# so run pods use THIS checkout's tooling instead of the published ghcr images. This
# is the run-pod counterpart of the service-image `images` target and is what closes
# the gap where a change to `voxel-anim`/`draw`/the core modeling library never
# reaches a run: those tools live in these images, not in any service.
#
# It is DELIBERATELY separate from `local-rebuild` (which rebuilds only the service
# images) and is instead folded into `local-up`: a run-container rebuild recompiles
# each image's tooling from scratch (the run-container Dockerfiles carry no cargo
# cache mount), so it is minutes-per-image and not something to pay on every
# service-code iteration. Run it explicitly after changing the baked-in tooling —
# `voxel-anim`, `voxel`, `draw`/`draw-sheet`, the Foray/Lattice tooling, or the core
# modeling library any of them link — then enqueue a run (driver Jobs resolve the
# run image fresh each run, so no service restart is needed to pick the new image
# up).
#
# Because a full rebuild is ~20 images at minutes each, the target is SPLIT so a
# change to one test type's tooling only rebuilds that type. Reach for the narrowest
# target that covers what you changed:
#   - `run-images`               everything (what local-up runs; the heavy path)
#   - `run-images-e2e`           the base-wasm image (an end-to-end / base-layer change)
#   - `run-images-full-stack`    the full-stack-2d image (needs the R2 pack credentials)
#   - `run-images-game-jam`      the game-jam image (FROM full-stack-2d, which must be built first)
#   - `run-images-asset`         every asset-generation kind
#   - `run-image-<kind>`         one asset kind, e.g. `run-image-voxel-animation`
#                                (you changed only `voxel-anim` → rebuild only that image)
#   - `run-images-adversarial`   the adversarial image (a Foray change)
#   - `run-images-performance`   the performance image (a Lattice change)
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
# named images with build.sh (which (re)builds the FROM base as needed), then save
# each and import it into the k3d cluster. $(1) is the space-separated list of image
# NAMES to pass to build.sh; $(2) is the matching list of fully-qualified refs to
# save + import (normally `$(call run_image_refs,$(1))`). Since an asset/adversarial/
# performance image bakes its base's layers in, importing just those refs is enough
# for their run pods — the plain `base` image is never imported on its own (it is not
# a run image); end-to-end runs schedule against `base-wasm`, imported via the
# `run-images-e2e` group and the full `run-images`.
define build_import_run_images
	@mkdir -p '$(BUILD_DOCKER_CONFIG)' && printf '{}\n' > '$(BUILD_DOCKER_CONFIG)/config.json'
	IMAGE_NAME_PREFIX='$(RUN_IMAGE_PREFIX)' IMAGE_TAG='$(RUN_IMAGE_TAG)' DOCKER='$(CONTAINER_TOOL)' \
	  bash '$(REPO)/containers/build.sh' $(1)
	@set -e; tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	  i=0; tars=""; \
	  for img in $(2); do \
	    i=$$((i+1)); \
	    echo "Saving $$img …"; \
	    $(CONTAINER_TOOL) save -o "$$tmp/run-$$i.tar" "$$img"; \
	    tars="$$tars $$tmp/run-$$i.tar"; \
	  done; \
	  k3d image import $$tars -c '$(CLUSTER)'
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

# `-full-stack` rebuilds the full-stack-2d image (the base plus the six 2D asset
# binaries + the two audio packs). Building it presigns the packs from R2, so it needs
# the PRESIGN credentials in .env (as the sfx-sample/music asset images do).
run-images-full-stack: export DOCKER_CONFIG := $(BUILD_DOCKER_CONFIG)
run-images-full-stack:
	$(call build_import_run_images,$(FULL_STACK_IMAGE_NAMES),$(call run_image_refs,$(FULL_STACK_IMAGE_NAMES)))

# `-game-jam` rebuilds the game-jam image, which is built `FROM` the full-stack-2d image.
# build.sh (re)builds full-stack-2d first when it is missing — and that parent build
# presigns the two audio packs from R2, so it needs the PRESIGN credentials in .env the
# first time (a rebuild against an already-present full-stack-2d does not). Only the
# game-jam ref is imported; its full-stack-2d parent's layers are baked into it.
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
	@$(KUBECTL) -n '$(NS)' create secret generic tcab-backend-secrets \
	  --from-literal=TCAB_BACKEND_SERVICE_TOKEN='$(SERVICE_TOKEN)' \
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

# Apply the local overlay and wait for every service to become ready. Secrets are
# created first (from the environment) so the pods find them on their first start.
apply: secrets
	$(KUBECTL) apply -k '$(OVERLAY)'
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-backend   --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-auth      --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-artifacts --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-lgtm      --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status deployment/tcab-arena      --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status deployment/tcab-dispatcher --timeout=300s

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
# forwarded so the console (and the CLI/desktop app) can reach them; auth is separate
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
# `cargo run` in the devcontainer, a host-side `tcab` CLI or desktop app, or the
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
# and the Foray/Lattice tooling). Those are minutes-per-image to recompile and are
# rebuilt by the separate `run-images` target (folded into `local-up`); run it by
# hand after changing that baked-in tooling or the core modeling library it links,
# otherwise a run pod keeps executing the previously-imported (or ghcr) image and a
# tooling change silently never reaches a run. The `apply` dependency is what makes a
# rebuild also pick up MANIFEST
# changes — RBAC, env, volumes — not just new image bytes; without it a Role or env
# edit silently never reaches the cluster on a rebuild (it only does on local-up).
# `kubectl apply -k` is idempotent (a no-op when nothing changed), and the rollout
# restart below still forces the pods to pick up rebuilt images even when their spec
# is byte-identical (same :local tag), which apply alone would not trigger.
local-rebuild: images apply
	$(KUBECTL) -n '$(NS)' rollout restart statefulset/tcab-backend statefulset/tcab-auth statefulset/tcab-artifacts deployment/tcab-arena deployment/tcab-dispatcher
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-backend   --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-auth      --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status statefulset/tcab-artifacts --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status deployment/tcab-arena      --timeout=300s
	$(KUBECTL) -n '$(NS)' rollout status deployment/tcab-dispatcher --timeout=300s

# Re-apply the overlay ONLY, with no image rebuild or service restart — the fast
# path after a manifest-only change (RBAC, env, volumes). `kubectl apply -k` is
# idempotent, so this is a no-op when nothing changed. Use local-rebuild instead
# when code changed (it rebuilds images and restarts the pods so they pick the new
# bytes up). Object-level changes that need a pod restart to take effect (e.g. an
# env edit) still want a `kubectl -n $(NS) rollout restart …` or local-rebuild
# after this; a Role change like the driver's pods/exec RBAC takes effect for the
# next driver Job with no restart.
local-reapply:
	$(KUBECTL) apply -k '$(OVERLAY)'

local-status:
	$(KUBECTL) -n '$(NS)' get pods,svc,pvc

local-down:
	-k3d cluster delete '$(CLUSTER)'
