# Devcontainer

A VS Code devcontainer for developing The Test Cabinet. It provides the Rust
toolchain (with `rustfmt`, `clippy`, and the `x86_64-unknown-linux-musl` target
for the portable `tcab` build), Node.js, Ruby, `uv`, the Tauri v2 system
libraries for the desktop shell, `markdownlint-cli2` for the docs, the
Cloudflare `wrangler` CLI that `tcab publish` uses to deploy run builds to
Cloudflare Pages, and the `k3d`, `kubectl`, and `docker` (client-only) tooling
the [local service stack](#host-docker-access-the-local-service-stack) runs on.

On top of that, the image **bakes in the toolchains of gg's eleven
program-language arms**: `purs` and `esbuild`, a JDK and TeaVM's jars, the Kotlin
compiler, the `wasm32-unknown-unknown` standard library, the Swift toolchain and
its WebAssembly SDK, wasi-sdk, .NET with Roslyn, uv, and the pinned YARD. That is
roughly **1.9 GB installed** and a good deal more downloaded to produce it, so
expect the first *pull or build* of the image to take a while — but a first
**create** no longer does, which is the point of baking them.

They are not optional and they are not only for gg's tests. Each arm's
**signature catalogue** — the whole of what a model is told that arm's sandbox
offers — is reflected out of that arm's own SDK by that arm's own documentation
tool (`tsc`, griffe, YARD, `purs`, javadoc, the Kotlin front end, rustdoc,
`swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn), and
`crates/gg/build.rs` does that reflection **as a step of building the crate**
rather than reading a committed copy. So a container missing them cannot build
the workspace, cannot lint it, and fails the pre-commit hooks that run both. A
prerequisite for working in the repository at all belongs in the image.

The mechanism is the same one Node and Rust use — a thin
[`languages/gg/install.sh`](languages/gg/install.sh) copied in and run by
[`ubuntu.dockerfile`](ubuntu.dockerfile)'s last layer — with one wrinkle worth
knowing about, because it is what the rest of this repository's `.dockerignore`
conventions would otherwise make surprising. These toolchains are pinned by the
**repository** (each arm's `packages/gg-sandbox-*/<lang>-version.sh`, installed
by [`scripts/ci/install-gg-toolchains.sh`](../scripts/ci/install-gg-toolchains.sh),
which every other surface that builds gg runs too), so the image build has to be
able to read the repository: its build context is the **repo root**, and
[`ubuntu.dockerfile.dockerignore`](ubuntu.dockerfile.dockerignore) — a
per-dockerfile allowlist that applies to this build and no other — narrows that
context to the ~230 kB slice the installers actually read. Every `COPY` in the
Dockerfile is therefore written relative to the repo root. That per-dockerfile file is
an *optimisation* rather than the thing that makes the build work — builders disagree
about when to reach for it — so the root [`.dockerignore`](../.dockerignore) admits the
same `.devcontainer/` paths as well (see the Podman note under
[First-time setup](#first-time-setup)). The one toolchain
outside all of this is Ruby itself, which is a distribution package and so is
installed by `system/apt.sh`.

The `postCreateCommand` still runs the installer, now as a **reconciler**: an
image built before a pin moved is stale, and the way you find that out otherwise
is `rustc` refusing another release's `.rlib` with E0514 halfway through a build.
The installer is idempotent — it compares what is installed against each pin and
touches the network only on a mismatch — so it costs about 0.2 s when the image
is current, and re-downloads one arm when it is not.

If a create is interrupted, or you want to repair a container by hand, run it
again yourself, followed by the npm install it deliberately leaves alone (see
[Building inside the container](#building-inside-the-container)):

```sh
scripts/ci/install-gg-toolchains.sh
npm ci
```

## First-time setup

The devcontainer references two host-specific files that are not committed —
`docker-compose.local.yml` and `.env` — so each host can pick how it runs
without affecting the repository. Create them from the committed variants before
opening the container.

For Docker on a mainstream Linux host (the default):

```sh
cd .devcontainer
cp docker-compose.ubuntu.yml docker-compose.local.yml
cp .env.ubuntu .env
```

For rootless Podman (for example on a NixOS host):

```sh
cd .devcontainer
cp docker-compose.nixos.yml docker-compose.local.yml
cp .env.podman .env
```

Then run **Dev Containers: Reopen in Container** in VS Code.

> **Podman may read a different ignore file, and both are now correct.** Since the gg
> toolchains were baked in, this image builds from the **repository root** and narrows
> that context with [`ubuntu.dockerfile.dockerignore`](ubuntu.dockerfile.dockerignore)
> — a *per-dockerfile* ignore file, which is a **BuildKit** rule. Buildah has its own
> order (`--ignorefile`, then `<containerfile>.containerignore`, then
> `<containerfile>.dockerignore`, then the context directory's `.containerignore` and
> `.dockerignore`), and a rebuild driven by VS Code through `podman-compose` did not
> land on the file beside the Dockerfile: it applied the **root**
> [`.dockerignore`](../.dockerignore) and ended the build on its first `COPY`:
>
> ```text
> no items matching glob ".../.devcontainer/system/apt.sh" copied
> (1 filtered out using /…/.dockerignore): no such file or directory
> ```
>
> The root allowlist now re-includes the five `.devcontainer/` paths this Dockerfile
> copies, so the build no longer depends on which ignore file the builder reaches for,
> and no workaround is needed; the block in that file explains what admitting them
> costs the images that `COPY . .`. The two builders still do not produce an identical
> image. Podman reads the wider root allowlist, and the difference lands on the one
> `COPY` that names a bare directory — `COPY ./packages` — so that layer carries a few
> MB of guest-package and UI sources rather than the version files and pins the narrow
> slice admits, and the 1.9 GB toolchain layer beneath it takes an unrelated
> `packages/ui` edit as a cache miss. If that ever matters, build it yourself with the narrow file and let compose
> reuse the tag:
>
> ```sh
> podman build --ignorefile .devcontainer/ubuntu.dockerfile.dockerignore \
>   -f .devcontainer/ubuntu.dockerfile -t <the tag compose expects> .
> ```
>
> `scripts/ci/build-context.sh` checks this Dockerfile's `COPY` sources against **both**
> allowlists, so the two cannot drift back apart unnoticed.

## Host Docker access (the local service stack)

The local service stack (`make -C deployments/local local-up`) runs `k3d` and
builds the service images against the **host's** Docker daemon —
Docker-outside-of-Docker. The compose file bind-mounts the host runtime socket to
`/var/run/docker.sock` inside the container, and the image ships the `docker`
client (plus the `buildx` plugin) the Makefile shells out to (build/save the
images, and inspect this devcontainer to resolve the host path of the repo it
mounts into the k3d node so the backend can ingest the catalog); `k3d` talks to
the socket directly. The service-image Dockerfiles are BuildKit Dockerfiles
(`--mount=type=cache` Rust build caches), so the build goes through `buildx`; the
Makefile points `DOCKER_CONFIG` at a credsStore-free config dir for the builds so
BuildKit does not trip over the devcontainer's credential helper (the base images
are all public). The
cluster's API server is published on a host port, which `kubectl` in here reaches
at `host.docker.internal` (mapped via the compose file's `extra_hosts`); the
Makefile's `cluster`/`kubeconfig` targets repoint the kubeconfig there.

This works out of the box on a standard setup. Two knobs cover the rest:

- **Non-default socket path** (e.g. rootless Podman at
  `/run/user/1000/podman/podman.sock`): set `DOCKER_SOCKET` in `.env` to the
  host path before opening the container.
- **Socket permissions** are aligned automatically at container start by
  `tools/docker-socket-access.sh` (run from `postStartCommand`), regardless of
  the host socket's owning group — so you do not need to match `DOCKER_GID` by
  hand. If `make local-up` still reports it cannot reach the daemon, confirm the
  host daemon is running and that `docker ps` works **from a fresh terminal**
  inside the container.

## Building inside the container

Two of the eleven signature catalogues `crates/gg`'s build script reflects come
out of the pinned `typescript` in the npm workspaces, so a checkout that has
never been installed cannot build the Cargo workspace either. It is the one gg
prerequisite the image cannot bake — the workspaces are part of the checkout,
which is a bind mount that exists only once the container is running — so the
`postCreateCommand` runs `npm ci` right after reconciling the toolchains. If that
was interrupted, or you deleted `node_modules` at some point, run it again by
hand. The build script says so by name if you forget.

```sh
cargo build --workspace        # CLI, core, and the Tauri desktop shell
cargo nextest run --workspace  # the repo's test runner (see .config/nextest.toml)
cargo test --workspace --doc   # doctests — nextest does not run these
cargo build-portable           # static musl tcab            (see https://docs.testcabinet.ai/development/building/)
cargo build-portable-backend   # static musl tcab-backend    (definition/run store + API + run queue)
cargo build-portable-dispatcher # static musl tcab-dispatcher (claims queued runs → one driver Job each)
cargo build-portable-driver    # static musl tcab-driver     (the per-run executor)
cargo build-portable-artifacts # static musl tcab-artifacts  (serves produced run trees)
npm install && npm run build    # the TypeScript workspaces
```

## Running benchmarks

The devcontainer is for development. The supported way to run the full stack
locally is the k3d **local service stack** (`make -C deployments/local local-up`),
which builds the images and drives the host Docker daemon over the bound socket
(see [Host Docker access](#host-docker-access-the-local-service-stack) above and
[development/running](../apps/docs/src/content/docs/development/running.md)).

Driving a single run-container image directly with `tcab run` also needs a
container runtime. Because the host daemon socket is now bound in by default, a
`tcab` built here can reach it; otherwise build the portable binary
(`cargo build-portable`) and run `tcab` on the host, where Podman or Docker is
available natively.

## Local observability

The Grafana LGTM stack
([`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm): an
OpenTelemetry collector + Tempo/Mimir/Loki + Grafana) **no longer runs in this
devcontainer.** It now runs **in the cluster** as the local k3d overlay's
`components/observability` — the same stack staging and prod use — so local
development observes telemetry through exactly what a deployment runs. The
services that run in the cluster export to it automatically; nothing in the
devcontainer needs configuring.

Bring the cluster up and observe it:

```sh
make -C deployments/local local-up        # stands up the stack (incl. LGTM) on k3d
make -C deployments/local local-grafana   # forward Grafana + the OTLP collector to localhost
```

`local-grafana` opens **Grafana at <http://localhost:3000>** (anonymous admin —
no login) and forwards the OTLP collector to `localhost:4318` (HTTP/protobuf) and
`:4317` (gRPC). A binary you run **outside** the cluster — a `cargo run` here in
the devcontainer, a host-side `tcab` CLI or desktop app, or the browser web
console — exports to the in-cluster stack by pointing its
`OTEL_EXPORTER_OTLP_ENDPOINT` (`VITE_OTEL_EXPORTER_OTLP_ENDPOINT` for the
browser) at `http://localhost:4318` while `local-grafana` is running. The Rust
binaries and the browser export over OTLP **HTTP/protobuf** (`:4318`). See the
per-process `.env.*.example` files at the repo root (and `apps/web/.env.example`
for the web console), and [Observability](https://docs.testcabinet.ai/development/observability/).

## SSH agent forwarding

If the host exposes its SSH agent at `/tmp/ssh-agent.sock`, the `postStartCommand`
bridges it to `/tmp/devcontainer-ssh-agent.sock` and the shell config points
`SSH_AUTH_SOCK` at it, so `git push` over SSH works from inside the container.
