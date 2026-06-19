# Devcontainer

A VS Code devcontainer for developing The Test Cabinet. It provides the Rust
toolchain (with `rustfmt`, `clippy`, and the `x86_64-unknown-linux-musl` target
for the portable `tcab` build), Node.js, the Tauri v2 system libraries for the
desktop shell, and `markdownlint-cli2` for the docs.

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
cargo build-portable           # static musl tcab         (see https://docs.testcabinet.ai/development/building/)
cargo build-portable-worker    # static musl tcab-worker  (run it on the host, drive it from the web UI)
cargo build-portable-backend   # static musl tcab-backend (definition/run store + API)
npm install && npm run build    # the TypeScript workspaces
```

## Running benchmarks

The devcontainer is for development. Running a benchmark needs a container
runtime to launch the per-harness images, which the container does not provide by
default. Either:

- build the portable binary (`cargo build-portable`) and run `tcab` on the host,
  where Podman or Docker is available; or
- expose a runtime to the devcontainer yourself (for example by mounting the
  host's Podman/Docker socket) — the container user is already added to the
  `DOCKER_GID` group for this case.

## Local observability (opt-in)

The compose file ships an opt-in `lgtm` service running the
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one
stack (OpenTelemetry collector + Tempo/Mimir/Loki + Grafana). It lets you
inspect the traces, metrics, and logs the workspace binaries emit during
development. It does nothing until a process points
`OTEL_EXPORTER_OTLP_ENDPOINT` at it, and it only starts the next time you
**Dev Containers: Rebuild Container**.

After a rebuild, open the **Grafana UI at <http://localhost:3000>** (anonymous
admin — no login). To start exporting, uncomment `OTEL_EXPORTER_OTLP_ENDPOINT`
in the relevant `.env.*` file, choosing the address by where the process runs:

- **Inside the container** (backend, web console): `http://lgtm:4318`.
- **On the host** (worker, `tcab` CLI, desktop app, browser):
  `http://localhost:4318`.

The Rust binaries and the browser export over OTLP **HTTP/protobuf** (`:4318`);
the gRPC port (`:4317`) is published too if you wire up a gRPC exporter. See the
per-process `.env.*.example` files at the repo root (and `apps/web/.env.example`
for the web console) for the exact variables.

## SSH agent forwarding

If the host exposes its SSH agent at `/tmp/ssh-agent.sock`, the `postStartCommand`
bridges it to `/tmp/devcontainer-ssh-agent.sock` and the shell config points
`SSH_AUTH_SOCK` at it, so `git push` over SSH works from inside the container.
