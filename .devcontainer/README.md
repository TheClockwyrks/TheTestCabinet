# Devcontainer

A VS Code devcontainer for developing The Test Cabinet. It provides the Rust
toolchain (with `rustfmt`, `clippy`, and the `x86_64-unknown-linux-musl` target
for the portable `tcab` build), Node.js, the Tauri v2 system libraries for the
desktop shell, `markdownlint-cli2` for the docs, and the Cloudflare `wrangler`
CLI that `tcab publish` uses to deploy run builds to Cloudflare Pages.

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

The devcontainer is for development. Running a benchmark needs a container
runtime to launch the run-container image, which the container does not provide by
default. Either:

- build the portable binary (`cargo build-portable`) and run `tcab` on the host,
  where Podman or Docker is available; or
- expose a runtime to the devcontainer yourself (for example by mounting the
  host's Podman/Docker socket) — the container user is already added to the
  `DOCKER_GID` group for this case.

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
