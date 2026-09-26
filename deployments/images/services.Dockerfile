# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# Every Rust SERVICE image for the Kubernetes deployment (and the local stack), in
# one file: backend, auth, dispatcher, driver, artifacts, arena and publisher.
#
# Select one with `--target`:
#   docker build --target backend -t <registry>/tcab-backend:<tag> \
#     -f deployments/images/services.Dockerfile .
# The target names are `backend`, `auth`, `dispatcher`, `driver`, `artifacts`,
# `arena` and `publisher`. The web console is NOT here — it is the one non-Rust
# service image and keeps its own web.Dockerfile (`npm ci` + `vite build`, no crate
# compiled).
#
# Why one file
# ------------
# These were seven Dockerfiles, each with its own `COPY . . / cargo build -p <crate>`
# stage. Every one of them opened by refreshing the whole source tree's mtimes (see
# the build stage below for why that is necessary), and all seven shared ONE cargo
# target/ cache mount — so building them back to back, as `make images` does, meant
# each build re-dirtied precisely what the previous build had just compiled. The
# ~19 workspace crates each service pulls in were rebuilt six or seven times over
# per invocation, every time, even with no source change at all.
#
# One shared build stage compiles all seven binaries in a single cargo pass, so the
# mtime refresh happens ONCE and each workspace crate is compiled once. `--target`
# then picks a runtime stage, and BuildKit builds only the stages that target
# actually depends on — asking for `arena` never runs the gg or npm stages. Two
# targets depend on the gg stage: `driver` bakes the gg binary, and `backend` bakes
# the reference documents that binary projects.
#
# The check=skip above silences a false positive: BuildKit's SecretsUsedInArgOrEnv
# lint flags any ENV whose *name* contains "AUTH" (also TOKEN/KEY/SECRET/PASSWORD).
# The only such ENV here is the auth stage's TCAB_AUTH_BIND — the socket the Axum
# server listens on (0.0.0.0:8789), a network bind address, not a credential. The
# same value is already committed in plaintext in the compose file, the k8s
# manifests and the .env.example files. No secret is baked into any image.
#
# The canonical images are built by the Azure pipeline (scripts/ci/service-image.sh)
# on every push to master and staging, natively per architecture, and pushed to the
# Test Cabinet ACR as testcabinet.azurecr.io/tcab-<name>:<sha>.

# Pinned wrangler version, used by the publisher stage. Bump deliberately
# (Cloudflare ships frequent releases); pinning keeps the publish path reproducible
# across image builds. Declared before the first FROM so the publisher stage's own
# `ARG WRANGLER_VERSION` inherits this default.
ARG WRANGLER_VERSION=4.40.3

# The audio store the driver stage copies in. Declared here, before the first FROM,
# because that is the only scope a `FROM` can resolve an ARG from. A driver build must
# pass it: the pipeline passes testcabinet.azurecr.io/test-cabinet-audio-store:<sha>,
# and deployments/local/Makefile passes the store it builds from the checkout. The
# default is `scratch` rather than blank because BuildKit refuses a blank `FROM` in any
# stage, which would break every other target; a driver built without the arg fails at
# its `COPY --from=audio-store` with `lstat /opt/tcab-audio: no such file or directory`.
ARG AUDIO_STORE_IMAGE=scratch

# ── Shared build stage ───────────────────────────────────────────────────────
# Compiles every service binary in ONE cargo invocation. The cargo registry/git, the
# rustup toolchain and the build's target/ are BuildKit cache mounts, so a source
# change recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch.
#
# THE RUSTUP CACHE IS NOT SHARED WITH THE gg STAGE, and that is a correctness
# requirement rather than a preference. rust-toolchain.toml pins an exact compiler,
# which the `rust:1-bookworm` base image does not necessarily ship — and a cache mount
# over /usr/local/rustup hides whatever it *does* ship, so against a cold cache rustup
# fetches the pinned toolchain here. gg-build fetches it too (its first `rustc` runs
# inside install-gg-toolchains.sh), and the two stages start at the same moment: a
# `--target backend` build depends on both. rustup stages a component download at a
# content-hash-named `<hash>.partial` under RUSTUP_HOME and takes no cross-process
# lock, so two rustups fetching one toolchain into one shared mount collide on that
# exact path — whichever renames it into place first leaves the other renaming
# something that is no longer there, and the build dies with
#
#   error: component download failed for rustc-<triple>: could not rename 'downloaded'
#   file from '/usr/local/rustup/downloads/<hash>.partial' to
#   '/usr/local/rustup/downloads/<hash>': No such file or directory (os error 2)
#
# A distinct `id` per stage gives each its own RUSTUP_HOME: the toolchain is fetched
# once per stage per cold builder and never again. `sharing=locked` covers the other
# way in — two concurrent builds of the SAME stage (the cargo registry and target/
# mounts need no such flag, because cargo does take a lock over both).
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binaries
# (crates/core/build.rs); this `.git`-less context can't resolve it from git, so
# CI passes the commit (github.sha) in as a build arg. Unset, it stamps null.
ARG TCAB_BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup,id=rustup-services,sharing=locked \
    --mount=type=cache,target=/src/target \
    # Refresh the COPYed sources' mtimes before building. BuildKit preserves the
    # mtimes a file had in the build context and replays them verbatim when the
    # `COPY . .` layer is served from cache — so a cache-hit COPY can hand cargo
    # sources OLDER than artifacts a previous build (a different branch, or one that
    # was interrupted) left in the persistent target/ mount. Cargo's freshness check
    # is mtime-based, so it would call those stale artifacts fresh and silently bake
    # a stale binary — or fail with spurious E0599s when the reused crate's API no
    # longer matches. Touching the tree forces every source to be unambiguously
    # newer. Only workspace crates are dirtied: registry dependencies are
    # fingerprinted by version+features, not mtime, so the ~450 third-party crates in
    # the target mount stay fresh. target/ is pruned so build outputs keep their real
    # mtimes.
    find /src -path /src/target -prune -o -type f -exec touch {} + \
    && TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release \
        -p test-cabinet-backend \
        -p test-cabinet-auth-service \
        -p test-cabinet-dispatcher \
        -p test-cabinet-driver \
        -p test-cabinet-artifacts \
        -p test-cabinet-arena \
        -p tcab-publisher \
    # target/ is a cache mount, not a layer, so the binaries are copied to a stable
    # path inside the same RUN, before the mount is detached; the runtime stages
    # COPY them from there.
    && mkdir -p /out \
    && cp \
        target/release/tcab-backend \
        target/release/tcab-auth-service \
        target/release/tcab-dispatcher \
        target/release/tcab-driver \
        target/release/tcab-artifacts \
        target/release/tcab-arena \
        target/release/tcab-publisher \
        /out/

# ── gg static-musl stage (driver AND backend) ────────────────────────────────
# The first-party `gg` harness, built static against musl. gg is copied into every
# sandbox run container, whose images span glibc Debian bookworm AND the Ubuntu
# blender image — a static binary is the one gg that runs across all of them. Built
# here for THIS image's own platform (the script targets the host arch), so an arm64
# image bakes an aarch64-musl gg and an amd64 image an x86_64-musl gg. musl-tools
# supplies the musl-gcc the script needs (ring/wasmtime compile a little C for the
# musl target).
#
# WHY A SINGLE STATIC BINARY NOW PULLS IN ELEVEN COMPILERS. gg drives a model in one of
# eleven program languages, and what a model is *told* each language offers is a
# signature catalogue reflected out of that language's own SDK by that language's own
# documentation tool — `tsc`, griffe, YARD, `purs`, javadoc, the Kotlin front end,
# rustdoc, `swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn. Those
# catalogues were committed once, so that this stage needed nothing but rustc; they are
# generated by `crates/gg/build.rs` now, on every build, so a gg binary cannot embed a
# description of a surface the guest in the same checkout does not export. A machine
# that builds gg is therefore a machine that has all eleven toolchains — this one
# included, and scripts/ci/install-gg-toolchains.sh is the one pinned list of them that
# the devcontainer and CI install too.
#
# AND IT NOW COMPILES THEM AS WELL AS READING THEM. What a model's program is compiled
# and evaluated AGAINST — the guest components, the SDK jars, the compiled library sets —
# stopped being committed the same way and for the same reason. Each arm has a crate under
# crates/gg-sandbox-artifacts/ whose build script runs that arm's packages/gg-sandbox*/build.sh
# into its own OUT_DIR, so this stage bakes four language runtimes (TypeScript/JavaScript,
# Python, Ruby, C#) and links six compile targets on the way to one static binary. One of
# them needs a toolchain the eleven-arm list deliberately excludes — see the second
# installer call below.
FROM docker.io/library/rust:1-bookworm AS gg-build
WORKDIR /src
# Node, for the two ECMAScript arms: the TypeScript and JavaScript catalogues are one
# reflection over the declarations `tsc` emits, and the PureScript arm's reflector is a
# Node script as well. Taken from the same official image the package-store stage below
# builds on rather than from Debian's archive, which is two majors behind. Only the
# interpreter and npm itself are copied — copying all of /usr/local would bury this
# image's own /usr/local/cargo and /usr/local/rustup.
COPY --from=docker.io/library/node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=docker.io/library/node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY . .
ARG TCAB_BUILD_COMMIT
# Every arm's installer defaults to a directory under $HOME — ~/.local/bin for `purs`,
# `uv` and esbuild, ~/.local/share for the JDK, the Kotlin compiler, Swift, wasi-sdk and
# .NET — and `purs` and `uv` are found on PATH. This is the root user's, so name it once
# here rather than in the RUN below, where a `cd` into a package would lose it.
ENV PATH=/root/.local/bin:$PATH
# The registry and git caches are shared with the build stage, which is safe because
# cargo locks both. The `rustup` and `target/` caches are NOT: each gets its OWN id,
# for two different reasons. This stage and the build stage run in parallel, and cargo
# locks a whole target dir, so a shared `target/` would serialise the two builds on
# that lock — a distinct id lets them proceed independently (glibc services vs
# static-musl gg). rustup, by contrast, locks nothing at all, and two rustups fetching
# the pinned toolchain into one mount race on a single `<hash>.partial` and fail the
# build outright; the build stage's header states that one in full. This stage's own
# rustup writes are the wasm32 and musl targets `rustup target add`s in, which land in
# this id and are wanted nowhere else.
#
# The toolchains land in a CACHE MOUNT (/root/.local) rather than in a layer, and that
# is a size decision rather than a speed one. Installed they are ~1.9 GB — Swift alone
# is 835 MB after its installer prunes 3.3 GB down — and scripts/ci/service-image.sh
# exports every stage's layers to a registry cache with `mode=max`, so a 1.9 GB layer
# would be pushed into every service's cache on every build. A cache mount is not
# exported at all: a warm local BuildKit
# (`make -C deployments/local images`) reuses it and never re-downloads, and a cold CI
# runner pays the download once per run. Everything the installers write lives under that
# one prefix, which is what makes a single mount enough; ~/.cache carries uv's own
# downloads (a CPython and the pinned griffe) and /root/.npm the npm cache, for the same
# reason.
#
# THE ~/.cache MOUNT EARNS ITS KEEP A SECOND WAY, and it is the reason it is worth
# knowing it is here: `gg_fetch` (scripts/ci/fetch.sh) stages every large toolchain
# archive under ~/.cache/tcab/downloads and leaves the PARTIAL file there when a transfer
# is cut short. So a build that dies eight hundred megabytes into the 1.05 GB Swift
# toolchain — which is what a flaky link does to a twelve-minute download — resumes on the
# next `make images` instead of starting that download again. The installers delete their
# own archives once the tree they feed has verified itself, so a build that succeeds
# leaves the mount holding nothing but the caches named above.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup,id=rustup-gg,sharing=locked \
    --mount=type=cache,target=/src/target,id=gg-target \
    --mount=type=cache,target=/root/.local,id=gg-toolchains \
    --mount=type=cache,target=/root/.cache,id=gg-toolchain-downloads \
    --mount=type=cache,target=/root/.npm \
    # musl-tools for the link; ca-certificates and curl because every installer fetches
    # a pinned release; ruby because the Ruby arm reflects with YARD, and unlike the
    # other ten arms its interpreter is a distribution package rather than something an
    # installer can lay down under $HOME (install-gg-toolchains.sh installs the pinned
    # YARD into it and fails by name if the interpreter is absent). python3 is already in
    # this base image and is named anyway: the Rust, Swift and C++ reflectors are Python
    # scripts, and depending on it silently is how a base-image change becomes a mystery.
    # unzip is for the C# arm alone and only since its guest stopped being committed: the
    # Mono WASI runtime pack it is relinked from ships as a `.nupkg`, which is a zip, and
    # every other fetch in both installer lists is a tarball. ~400 KB, and without it the
    # build toolchain installer below fails four minutes in.
    apt-get update && apt-get install -y --no-install-recommends \
        musl-tools ca-certificates curl python3 ruby unzip \
    && rm -rf /var/lib/apt/lists/* \
    && ./scripts/ci/install-gg-toolchains.sh \
    # And the C# arm's BUILD toolchains, which are deliberately not on that list: a whole .NET SDK
    # and an unpruned wasi-sdk, ~1.4 GB, needed to relink Mono's IL interpreter into this arm's guest
    # component. That component is not committed any more (nothing gg embeds is), so the cargo build
    # below produces it. Without this line the arm's build.sh falls back to fetching both into its
    # own .build/ — which still works and still costs the download, but lands outside the
    # /root/.local cache mount and is therefore paid again on every image build.
    && ./scripts/ci/install-gg-build-toolchains.sh \
    # The pinned `typescript` the ECMAScript arms reflect through is a workspace
    # devDependency, so the catalogue step needs the workspace installed. It is the
    # repo-root install, not a package-scoped one: npm ci validates the whole workspace
    # against the lockfile.
    && npm ci \
    # Refresh the COPYed sources' mtimes before building, for the reason the services
    # stage above states at length — and with one extra consequence here. `target/` is a
    # cache mount that survives across builds and across branches, and it holds a
    # previous build's gg together with the eleven catalogues that build reflected. Those
    # catalogues are `crates/gg/build.rs`'s output, and cargo decides whether to re-run a
    # build script by comparing mtimes against the inputs it declared — every guest
    # package's sources among them. Sources newer than the artifacts is what makes that
    # comparison come out right, so this is what stops the image baking a gg whose
    # description of a language came off another branch's SDK.
    && find /src -path /src/target -prune -o -type f -exec touch {} + \
    && TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" scripts/build-gg-static.sh /gg \
    # AND THE REFERENCE DOCUMENTS THE BACKEND SERVES, projected by the binary one line
    # above. This is the second consumer of this stage, and the reason the header now says
    # "driver AND backend": `tcab-backend` serves gg's model-facing surface at
    # /gg/reference, cannot depend on test-cabinet-gg (oxc + tiktoken-rs, and the eleven
    # language toolchains this stage installs to build it), and reads twelve JSON documents
    # at run time instead. Producing
    # them HERE, from the gg this same build linked, is what makes the console's reference
    # and the harness a run actually executes one vintage of one checkout — the property a
    # committed artifact plus a drift gate only approximated.
    #
    # It runs the static-musl binary under this glibc base, which is exactly what static
    # means, and it needs nothing else: every arm's signature catalogue is compiled into
    # that binary by crates/gg/build.rs, so `reference --out` opens no file, resolves no
    # toolchain and reaches no network. Same RUN as the build so the documents land in this
    # stage's layer beside /gg rather than costing another one.
    && /gg reference --out /gg-reference

# ── Package store stage (driver only) ────────────────────────────────────────
# The driver seeds each run's repository, and a `packages`-declaring case has its
# requested `@clockwyrks/*` runtime libraries vendored into the run repo at seed
# time (crates/core seeding → `.vendor/packages/`). Those libraries are read from a
# host package store, so the driver image bakes one exactly as the base run image
# does: `npm ci` over the npm workspace (the repo-root `.dockerignore` re-includes
# the packages slice), then `scripts/stage-tcab-packages.mjs` builds the shippable
# libraries and stages them under /opt/tcab-packages.
FROM docker.io/library/node:24-bookworm-slim AS tcab-packages
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
    && node scripts/stage-tcab-packages.mjs /opt/tcab-packages

# ── Audio store stage (driver only) ──────────────────────────────────────────
# The driver stages each run's declared audio packs into its run container out of a
# host audio store (crates/core `audio_stage` → `/opt/audio`), so the driver image
# carries one. The store is assembled by scripts/stage-audio-store.mjs, which reads
# the private audio object store with the read-scoped R2 presign credentials, so it
# is published ONCE as its own data-only image (containers/audio-store/Dockerfile)
# and copied in from there. `COPY --from=` reads no build context, so this build
# needs no audio credential, no Node step and no npm install, and a clean clone can
# build every service image.
#
# `AUDIO_STORE_IMAGE` is declared globally above, because an ARG a `FROM` resolves
# has to be. A tag that cannot be resolved fails the build here rather than shipping a
# driver whose every full-stack, game-jam, sfx-sample and music run fails at
# container start.
#
# WHICH STORE depends on who builds. The pipeline passes the store it pushed at the same
# commit, so a deployed driver bakes the store of its own commit. A build on a
# developer's machine should not depend on a registry, and an audio change should be
# testable before it is published, so `deployments/local/Makefile` builds the store from
# the checkout (its `audio-store` target) and passes THAT ref in here. Any other build of
# this target should do the same.
FROM ${AUDIO_STORE_IMAGE} AS audio-store

# ── Shared slim runtime ──────────────────────────────────────────────────────
# The base for the four services that render nothing and shell out to nothing:
# arena, artifacts, auth and dispatcher. ca-certificates covers their outbound HTTPS
# (the Kubernetes API, the backend/auth over TLS, telemetry export). No Chromium and
# no fonts.
FROM docker.io/library/debian:bookworm-slim AS runtime-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── arena ────────────────────────────────────────────────────────────────────
# The arena service runs adversarial matches and tournaments (CPU-bound in-process
# wasm) on demand. It is STATELESS — it holds no database and no disk, fetching every
# controller input from the backend and persisting finished tournaments + replays
# back to it over HTTP. So it mounts no volume (no PVC) and needs only the binary
# and a CA bundle.
FROM runtime-slim AS arena
COPY --from=build /out/tcab-arena /usr/local/bin/tcab-arena
ENV TCAB_ARENA_BIND=0.0.0.0:8791
EXPOSE 8791
ENTRYPOINT ["tcab-arena"]

# ── artifacts ────────────────────────────────────────────────────────────────
# The artifact service receives each run's produced tree from the driver and serves
# it to the console off a persistent volume. It forwards a driver's per-job token to
# the backend and a reviewer's token to auth, both over TLS. State (the artifact
# store) is mounted at runtime — a PersistentVolumeClaim in the cluster —
# so the image carries none; deployments/k8s/base/artifacts.yaml sets the matching
# TCAB_ARTIFACTS_ROOT.
FROM runtime-slim AS artifacts
COPY --from=build /out/tcab-artifacts /usr/local/bin/tcab-artifacts
ENV TCAB_ARTIFACTS_BIND=0.0.0.0:8790
EXPOSE 8790
ENTRYPOINT ["tcab-artifacts"]

# ── auth ─────────────────────────────────────────────────────────────────────
# The auth service does no reference rendering, so — unlike the backend — it ships no
# Chromium and no fonts. State paths are mounted at runtime (a PersistentVolumeClaim
# in the cluster, a named volume locally); the compose file and
# deployments/k8s/base/auth.yaml set the matching TCAB_AUTH_DATABASE_URL value.
FROM runtime-slim AS auth
COPY --from=build /out/tcab-auth-service /usr/local/bin/tcab-auth-service
ENV TCAB_AUTH_BIND=0.0.0.0:8789
EXPOSE 8789
ENTRYPOINT ["tcab-auth-service"]

# ── dispatcher ───────────────────────────────────────────────────────────────
# The dispatcher is a thin, long-running controller: it claims queued jobs from the
# backend and creates one driver Job per claim through the Kubernetes API. It runs
# unprivileged, needs NO container engine of its own, and binds no socket.
FROM runtime-slim AS dispatcher
COPY --from=build /out/tcab-dispatcher /usr/local/bin/tcab-dispatcher
# Run as an unprivileged user: the dispatcher needs only API access (its
# ServiceAccount token), never host privileges.
RUN useradd --create-home --uid 1000 dispatcher
USER dispatcher
WORKDIR /home/dispatcher
ENTRYPOINT ["tcab-dispatcher"]

# ── backend ──────────────────────────────────────────────────────────────────
# The stock `tcab-backend` binary ships no browser, but the backend renders
# reference screenshots at ingest by shelling out to the bundled Playwright driver
# (`packages/browser-driver/driver.mjs`). This stage therefore layers the binary on a
# Node runtime that also carries that driver, its Playwright dependency, and a
# Playwright-managed Chromium (plus the shared libraries and fonts it needs) — the
# same toolchain the driver uses in development — and points TCAB_BROWSER_DRIVER /
# PLAYWRIGHT_BROWSERS_PATH at them so ingest renders out of the box. Set
# TCAB_REFERENCE_BROWSER to an explicit Chromium binary only to override that baked
# browser (the backend forwards it to the driver as TCAB_CHROMIUM_EXECUTABLE).
FROM docker.io/library/node:24-bookworm-slim AS backend

# Where the Playwright-managed Chromium is installed, in both the build RUN below
# and at runtime — the driver discovers the cached browser through this path, so it
# must be stable and identical across both.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Just the driver, the sibling ES modules it imports (the `ttc` reporter kit and
# the `validation` runtime), and its manifest (never the host's node_modules): its
# Playwright dependency and Chromium are installed fresh below so the image is
# self-contained. driver.mjs imports these by relative path, so a missing sibling
# is a runtime ERR_MODULE_NOT_FOUND at render time — keep this list in sync with
# driver.mjs's `import` statements.
COPY packages/browser-driver/package.json packages/browser-driver/driver.mjs packages/browser-driver/ttc.mjs packages/browser-driver/validation.mjs /opt/browser-driver/

# ca-certificates covers the backend's outbound HTTPS (R2, deploy hook); the font set
# is what test cases render with (the slim base ships none — see
# containers/README.md). ffmpeg transcodes each run's proof clip from the `.webm`
# Playwright records to an H.264 `.mp4` when the public snapshot is built
# (crates/backend snapshot.rs `transcode_webm_to_mp4`), so the gallery plays on every
# browser — webm/VP8 does not on iOS/Safari. Only the snapshot path uses it; live
# proof serving is untouched. The npm install skips Playwright's own browser download
# so only the single Chromium we ask for lands, in PLAYWRIGHT_BROWSERS_PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && cd /opt/browser-driver \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
  && npx --yes playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /out/tcab-backend /usr/local/bin/tcab-backend

# gg's reference documents — `index.json` plus one per program language — projected by the
# gg binary the stage above linked, and served verbatim at GET /gg/reference[/{language}]
# for the console's gg Reference section. They ship as FILES beside the binary rather than
# compiled into it for the same reason the Playwright driver above does: the backend must
# not link the crate that produces them (test-cabinet-gg pulls oxc and tiktoken-rs, and
# building it needs the eleven language toolchains the gg-build stage installs), and a file
# the same build produced cannot disagree with it the way a committed artifact could.
#
# NOTE WHAT THIS COSTS: it makes the backend image depend on the gg-build stage, so building
# `--target backend` now builds gg — eleven program-language toolchains, every arm's
# catalogue reflected and every arm's artifacts compiled. Previously only the driver leg
# paid that. It is the price of the console showing exactly what a model is shown, on all
# eleven arms, with no second copy anywhere; and the two legs run concurrently in CI, so it
# costs the backend leg's wall clock rather than the workflow's.
COPY --from=gg-build /gg-reference /opt/gg-reference/

# State paths are mounted at runtime (a PersistentVolumeClaim in the cluster, a
# named volume locally). The compose file and deployments/k8s/base/backend.yaml set
# the matching TCAB_BACKEND_DATABASE_URL / _STORE / _CHECKOUT values.
# TCAB_BROWSER_DRIVER points the render path at the baked driver regardless of the
# process's working directory, and TCAB_GG_REFERENCE the reference endpoints at the
# documents COPYed above — without it the backend would look under the checkout it
# ingests from, which in this image is a mounted volume that has no build output in it.
ENV TCAB_BACKEND_BIND=0.0.0.0:8787 \
    TCAB_BROWSER_DRIVER=/opt/browser-driver/driver.mjs \
    TCAB_GG_REFERENCE=/opt/gg-reference

EXPOSE 8787
ENTRYPOINT ["tcab-backend"]

# ── driver ───────────────────────────────────────────────────────────────────
# The dispatcher creates one driver Job per run; each driver pod runs THIS image,
# resolves the run from the backend, and — under TCAB_DRIVER_RUNTIME=kubernetes —
# spawns a single untrusted *sandbox* pod through the Kubernetes API, exec's the
# harness session into it, streams the run's live events/preview back to the
# backend, uploads the produced tree to the artifact service, and exits. It needs
# NO Docker/Podman daemon and runs unprivileged.
#
# The driver does NOT publish runs (publishing is a separate, explicit backend
# operation), so it ships none of the publish CLIs (gh/wrangler). It DOES drive a run
# end to end *in this process*, and that path shells out to three tools:
#   - `git`, to seed each run's fresh repository (crates/core seeding `git init`/
#     `add`/`commit`); a missing git fails every run at "failed to seed run
#     repository".
#   - a shell + `node`/`npm`, to run an end-to-end case's manifest build steps
#     (`npm ci`, `npm run build`) against the produced source the sandbox returned.
#   - `node` + the bundled Playwright driver and a Playwright-managed Chromium, to
#     load-check the build and screenshot it for the per-view checks — the SAME
#     toolchain the backend bakes to render references at ingest. A missing browser
#     degrades a run to a build-only signal rather than failing it, but without Node
#     the build steps can't run at all.
FROM docker.io/library/node:24-bookworm-slim AS driver

# Where the Playwright-managed Chromium is installed, in both the build RUN below
# and at runtime — the driver discovers the cached browser through this path, so it
# must be stable and identical across both.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Just the driver, the sibling ES modules it imports (the `ttc` reporter kit and
# the `validation` runtime), and its manifest (never the host's node_modules): its
# Playwright dependency and Chromium are installed fresh below so the image is
# self-contained. driver.mjs imports these by relative path, so a missing sibling
# is a runtime ERR_MODULE_NOT_FOUND at render time — keep this list in sync with
# driver.mjs's `import` statements.
COPY packages/browser-driver/package.json packages/browser-driver/driver.mjs packages/browser-driver/ttc.mjs packages/browser-driver/validation.mjs /opt/browser-driver/

# Install git and the font set, then the driver's Playwright dependency and a
# Playwright-managed Chromium with the OS libraries it links against
# (`playwright install --with-deps`). ca-certificates covers the driver's outbound
# HTTPS (the Kubernetes API, the backend/auth and artifact service over TLS,
# telemetry export); git seeds each run's repository; the font set is what test cases
# render with (the slim base ships none — see containers/README.md). The npm install
# skips Playwright's own browser download so only the single Chromium we ask for
# lands, in PLAYWRIGHT_BROWSERS_PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && cd /opt/browser-driver \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
  && npx --yes playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /out/tcab-driver /usr/local/bin/tcab-driver

# Bake the static-musl gg harness in (built in the gg-build stage above). core,
# running in this driver pod, reads it from here and copies it into each sandbox run
# pod, so a Kubernetes gg run installs LOCALLY with no release download or network
# egress. World-readable (a+rX via the 0755) so the unprivileged `node` user reads it.
COPY --from=gg-build /gg /usr/local/lib/tcab/gg
RUN chmod 0755 /usr/local/lib/tcab/gg

# The host package store the seeder vendors a `packages`-declaring case's runtime
# libraries out of (crates/core `TCAB_PACKAGES_DIR`). World-readable so the
# unprivileged `node` user below can read it during seeding.
COPY --from=tcab-packages /opt/tcab-packages /opt/tcab-packages
RUN chmod -R a+rX /opt/tcab-packages

# The host audio store a run's declared audio packs are staged out of (crates/core
# `TCAB_AUDIO_STORE`). World-readable for the same reason as the package store: the
# driver reads it as the unprivileged `node` user below while starting a run.
COPY --from=audio-store /opt/tcab-audio /opt/tcab-audio
RUN chmod -R a+rX /opt/tcab-audio

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token), never host privileges. The Node base already ships a
# non-root `node` user (uid 1000) — reuse it rather than minting another at the
# same uid (which would collide). The Playwright browsers installed above are
# world-readable, so this user can launch them, and its home is writable for the
# build/seed scratch and Node's caches.
USER node
WORKDIR /home/node

# Default to the Kubernetes runtime; the dispatcher sets the TCAB_K8S_* specifics
# and the per-job env (id, token, run request) when it creates each driver Job.
# TCAB_BROWSER_DRIVER points the load-check at the baked driver regardless of the
# process's working directory.
ENV TCAB_DRIVER_RUNTIME=kubernetes \
    TCAB_BROWSER_DRIVER=/opt/browser-driver/driver.mjs \
    TCAB_GG_BINARY=/usr/local/lib/tcab/gg

ENTRYPOINT ["tcab-driver"]

# ── publisher ────────────────────────────────────────────────────────────────
# The dispatcher creates one publisher Job per *publish* (a parallel queue to the
# run path); each publisher pod runs THIS image, resolves its publish job from the
# environment the dispatcher set, downloads the reviewed run's source tree from the
# artifact service, performs the GitHub-repo + Cloudflare Pages release (the same
# two steps a local `tcab publish` drives, via test_cabinet_core::BackendPublisher)
# while streaming progress to the backend, reports the terminal result, and exits.
#
# Unlike the driver stage (which renders builds to screenshot them and therefore
# carries Playwright + a Playwright-managed Chromium), the publisher renders
# NOTHING — it only releases. So it DROPS the entire browser layer and instead
# carries the three tools the release path shells out to:
#   - `git`, to commit the model's working tree into each run's seeded repository
#     and push it to the run's public repo (crates/core publish.rs
#     `commit_implementation` sets a per-repo `user.name`/`user.email`, so no
#     global git identity is needed here; the push authenticates through `gh`'s
#     credential helper — see below — so no git credential helper is configured).
#   - `gh`, the GitHub CLI, for the idempotent `gh repo view` gate, `gh repo
#     create --public` (the empty repo), and — via `gh auth git-credential` — the
#     credential helper the implementation push authenticates through (crates/core
#     publish.rs `release_code`/`push_implementation`; create and push are kept
#     separate so the push can retry through GitHub's post-create permission lag).
#     Installed from GitHub's official apt repository so it is a current, supported
#     build rather than Debian's older packaged one.
#   - `wrangler`, Cloudflare's CLI, for `wrangler pages deploy <dir> --project-name
#     <p> --branch=<run>` (crates/core publish.rs `release_playable_build`). It is
#     an npm package and the base is already Node, so it is installed globally and
#     PINNED below; the release invokes the bare `wrangler` on PATH.
# `gh`/`wrangler` authenticate from the Job's env (GH_TOKEN / CLOUDFLARE_API_TOKEN,
# wired by the deployment overlay), and the git push borrows `gh`'s token via its
# credential helper; the binary itself never reads those tokens.
FROM docker.io/library/node:24-bookworm-slim AS publisher

ARG WRANGLER_VERSION

# ca-certificates covers the publisher's outbound HTTPS (the backend/auth and
# artifact service over TLS, GitHub and Cloudflare APIs, telemetry export); git
# commits each run's working tree before push; gnupg + the GitHub apt key let us
# pull `gh` from GitHub's official repository (a current, supported build). The
# pinned wrangler is installed globally so the release invokes the bare `wrangler`
# on PATH. Everything is removed from the layer that no longer needs it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       curl \
       gnupg \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && npm install -g --no-audit --no-fund "wrangler@${WRANGLER_VERSION}" \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /out/tcab-publisher /usr/local/bin/tcab-publisher

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token + the per-publish-job token), never host privileges. The Node
# base already ships a non-root `node` user (uid 1000) — reuse it rather than minting
# another at the same uid (which would collide). Its home is writable for the
# downloaded source-tree scratch (TCAB_WORK_DIR) and the CLIs' caches/config.
USER node
WORKDIR /home/node

ENTRYPOINT ["tcab-publisher"]
