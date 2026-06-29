# Devcontainer

A VS Code devcontainer for developing The Test Cabinet. It provides the Rust
toolchain (with `rustfmt`, `clippy`, and the `x86_64-unknown-linux-musl` target
for the portable `tcab` build), Node.js, the Tauri v2 system libraries for the
desktop shell, `markdownlint-cli2` for the docs, the Cloudflare `wrangler`
CLI that `tcab publish` uses to deploy run builds to Cloudflare Pages, and the
`k3d`, `kubectl`, and `docker` (client-only) tooling the
[local service stack](#host-docker-access-the-local-service-stack) runs on.

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
cp docker-compose.podman.yml docker-compose.local.yml
cp .env.podman .env
```

Then run **Dev Containers: Reopen in Container** in VS Code.

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

```sh
cargo build --workspace        # CLI, core, and the Tauri desktop shell
cargo test --workspace
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
