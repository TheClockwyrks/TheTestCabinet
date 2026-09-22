# Devcontainer

A VS Code devcontainer for developing The Test Cabinet. It provides the Rust
toolchain (with `rustfmt`, `clippy`, and the host architecture's
`*-unknown-linux-musl` target for portable static builds), Node.js, Ruby, `uv`,
the Tauri v2 system libraries for the desktop shell, `markdownlint-cli2` for the
docs, the Cloudflare `wrangler` CLI that `tcab publish` uses to deploy run builds
to Cloudflare Pages, and the `k3d`, `kubectl`, and `docker` (client-only) tooling
the [local service stack](#host-docker-access-the-local-service-stack) runs on.

On top of that, the image **bakes in the toolchains of gg's eleven
program-language arms**: `purs` and `esbuild`, a JDK and TeaVM's jars, the Kotlin
compiler, the `wasm32-unknown-unknown` standard library, the Swift toolchain and
its WebAssembly SDK, wasi-sdk, .NET with Roslyn, uv, and the pinned YARD. That is
roughly **1.9 GB installed** and a good deal more downloaded to produce it, so
expect the first _pull or build_ of the image to take a while — but a first
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
an _optimisation_ rather than the thing that makes the build work — builders disagree
about when to reach for it — so the root [`.dockerignore`](../.dockerignore) admits the
same `.devcontainer/` paths as well (see the Podman note under
[First-time setup](#first-time-setup)). The one toolchain
outside all of this is Ruby itself, which is a distribution package and so is
installed by `system/apt.sh`.

That script also declares the shared libraries an arm's compiler expects the
machine to supply — ICU, which Roslyn's .NET runtime `dlopen`s at startup — for
the reason it declares `iproute2` and Ruby: a package that arrives as somebody
else's transitive dependency is a package that leaves when that dependency
does. A run image owes the same libraries to the same compilers and vendors
them under `/opt/gg` instead, since it has no package manager at run time; see
[the toolchain builder](../containers/README.md#the-gg-toolchain-builder).

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

| Host                                          | `docker-compose.local.yml`        | `.env`              |
| --------------------------------------------- | --------------------------------- | ------------------- |
| Docker on Linux (the default)                 | `docker-compose.ubuntu.yml`       | `.env.ubuntu`       |
| Rootless Podman on Linux (NixOS, a DGX Spark) | `docker-compose.nixos.yml`        | `.env.podman`       |
| Docker on macOS — Docker Desktop or OrbStack  | `docker-compose.macos-docker.yml` | `.env.ubuntu`       |
| Podman on macOS (`podman machine`)            | `docker-compose.macos-podman.yml` | `.env.macos-podman` |

One macOS row covers Docker Desktop and OrbStack both: OrbStack is a drop-in
Docker-API runtime, and where this file cares — a daemon in a managed VM, no UID
remapping, a synthesised SSH-agent socket — the two behave identically. Copy the
pair for your row:

```sh
cd .devcontainer
cp docker-compose.ubuntu.yml docker-compose.local.yml
cp .env.ubuntu .env
```

…or let [`setup-host.sh`](setup-host.sh) pick the row and copy it for you:

```sh
.devcontainer/setup-host.sh                 # detect this host
.devcontainer/setup-host.sh macos-podman    # or name the variant
                                            # (ubuntu | nixos | macos-docker | macos-podman)
.devcontainer/setup-host.sh --print         # say what it would do and stop
```

The script is a convenience on three rows; the copies are equally correct there.
On the **macOS + Podman** row it does what a copy cannot: it reads off your machine
which of its two podman services compose will talk to and writes that service's
socket directory and user-namespace mode into `.env` (a copy gets the rootless
defaults, which are right for a machine made by `podman machine init` and wrong
for one set `--rootful`), and it checks that the machine is big enough to build
this workspace in and that the checkout is somewhere the machine can share into
the VM.

**The row follows the engine VS Code uses, not the engines the host has.** A DGX
Spark ships Docker and has podman installed beside it; which one a devcontainer
runs on is `"dev.containers.dockerPath"` in VS Code's settings, and the script
cannot see that, so on a host with both it declines to guess and asks you to name
one. The rows are not interchangeable: the Docker row carries no `userns_mode`,
and copied onto a rootless-podman host it produces a checkout owned by
`root:root` (directories) and `root:nogroup` (files) inside the container — the
signature of a `docker-compose.local.yml` that predates a move from Docker to
podman. `setup-host.sh nixos --force` and a **Rebuild Container** fixes it.

**Re-run it after a pull that changes these templates.** Your two files are
copies, so they do not follow the repository. A stale `docker-compose.local.yml`
silently drops whatever the committed one has gained — the host runtime socket
moved into these files in the same change that added the Podman row, so a copy
older than that loses the local service stack without saying anything.
`setup-host.sh --force` replaces both.

Then run **Dev Containers: Reopen in Container** in VS Code.

None of the four rows names an architecture. Each install script that fetches a
per-platform download resolves it from the machine the build runs on, so the image
builds for whatever architecture the container runtime gives it. x86_64 and
aarch64 are both supported; on anything else the first script with no build for it
ends the build and names the architecture.

> **Podman may read a different ignore file, and both are now correct.** Since the gg
> toolchains were baked in, this image builds from the **repository root** and narrows
> that context with [`ubuntu.dockerfile.dockerignore`](ubuntu.dockerfile.dockerignore)
> — a _per-dockerfile_ ignore file, which is a **BuildKit** rule. Buildah has its own
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

### Podman on macOS

Podman on macOS _is_ `podman machine`: a Linux VM you own and configure, rather
than one a runtime hides from you. Everything that makes this row different from
the Docker row above follows from that, and from one rule worth stating plainly —
**a bind mount's source is a path on your Mac, which the VM sees only because the
machine shares it.** Not a path in the VM, and not merely a suggestion: podman
checks, and a source it cannot see ends the whole `up` with
`Error: statfs <path>: no such file or directory` before any container exists.
That rule is why the checkout has to live under `$HOME`, and why the host runtime
socket gets in by a different door than on every other row.

**Install both halves.** VS Code drives the devcontainer through compose, and
Podman's compose is a separate binary:

```sh
brew install podman podman-compose
```

Then point the Dev Containers extension at them. Both settings are
**machine-scoped**, so they belong in your _User_ `settings.json` and cannot be
committed here for you:

```json
"dev.containers.dockerPath": "podman",
"dev.containers.dockerComposePath": "podman-compose"
```

**Size the machine before you build in it.** The image alone is ~1.9 GB of gg's
toolchains on top of a Rust and Node toolchain, and what you then run inside it is
`cargo build --workspace`. A stock machine is 2 CPUs and 2 GB of RAM, and it does
not report a resource problem — it OOM-kills `rustc` partway through a build, or
fills the disk during the toolchain layer. The disk can only ever grow, so be
generous once:

```sh
podman machine stop
podman machine set --cpus 8 --memory 16384 --disk-size 200
podman machine start
```

`setup-host.sh` warns when the machine it finds is smaller than roughly that.

**Keep the checkout inside what the machine shares.** `podman machine` mounts your
home directory into the VM, and a bind mount is resolved against the Mac. A clone
outside that fails the same way the socket does — `statfs …: no such file or
directory`, and no container. Either keep the repository under `$HOME`, or hand
the machine the path when you create it: `podman machine init -v /path:/path`.
`setup-host.sh` warns when it sees a checkout outside `$HOME`.

**Rootless or rootful, both work — but `.env` has to say which.** `podman machine
init` makes a rootless machine, and the VM runs _both_ podman services whatever the
machine was set to: root's, with its socket at `/run/podman/podman.sock`, and the
`core` user's at `/run/user/<uid>/podman/podman.sock`. `podman machine set
--rootful` only changes which one the Mac's `podman` talks to by default — see the
`Default` column of `podman system connection list` — and that is the service
compose creates the container on. Two settings in this row have to name the same
service, which is why they live in `.env` rather than in the compose file:

- `PODMAN_SOCKET_DIR` is that service's runtime directory in the VM, the source of
  the named volume below. Give the rootless service root's directory and the `up`
  ends with `reading contents of volume "…_host-podman-run": permission denied`,
  because the rootless service cannot read it; give a rootful container the
  rootless socket and it arrives owned by a user the container cannot become.
- `PODMAN_USERNS` is `keep-id:uid=1000,gid=1000` on the rootless service — the same
  setting the Linux Podman row uses, so the socket arrives owned by the image's
  `ttc` — and `host` on a rootful one, where podman refuses `keep-id` outright
  (it is rootless-only) and `host` spells out what a rootful container gets
  anyway: no user namespace.

`setup-host.sh` reads both off the default connection and writes them; the
template's defaults are the rootless machine's. If you switch the machine between
the two, re-run it with `--force` and then **remove the stale volume** — its
options were fixed when it was created, so compose reuses it as-is and fails on
the next `up`. The script names the command when it sees one; by hand:

```sh
podman rm $(podman ps -aq --filter volume=thetestcabinetdevcontainer_host-podman-run)
podman volume rm thetestcabinetdevcontainer_host-podman-run
```

The devcontainer itself is content with either service. The optional
[local service stack](#host-docker-access-the-local-service-stack) is not: `k3d`
needs a rootful runtime, so on a rootless machine everything in this container
works except `make -C deployments/local local-up`.

**The workspace is writable whatever the numbers are.** The checkout arrives over
Apple's virtiofs, and that filesystem reports every file as owned by _whoever is
asking_ — `stat` as `core` in the VM says `core`'s ids, `stat` as uid 4242 in a
container says `4242:4242` — and lets any of them write, because the permission
check happens on the Mac as your account. So the ownership problem the Linux
Podman row solves with `keep-id` does not exist here, `DEVCONTAINER_UID`/`GID`
stay at the image's default `1000:1000` regardless of your Mac account's `501:20`,
and `"updateRemoteUserUID": false` in [`devcontainer.json`](devcontainer.json)
keeps them that way. (An earlier version of this row built the image with the
Mac account's numbers on the theory that virtiofs passed ownership through; it
does not.)

**The runtime socket arrives on a named volume, not a bind mount.** The
[local service stack](#host-docker-access-the-local-service-stack) needs the
host's runtime socket at `/var/run/docker.sock`, and the other three rows bind it
straight in. That is exactly what the rule at the top of this section forbids
here: the socket's VM path is not a Mac path, and naming it as a bind source ends
the `up` with `statfs …: no such file or directory`. Nor is the Mac-side socket
`podman machine inspect` prints a substitute — it is a live endpoint rather than a
file, so sharing its inode over virtiofs shares nothing the guest can connect to.

A **named volume** is the one kind of mount whose path the runtime resolves on its
own side. `docker-compose.macos-podman.yml` declares one with the bind-backed
local driver (`type: none`, `o: bind`, `device: ${PODMAN_SOCKET_DIR}`), so the
bind happens inside the VM where that path is exactly what it looks like, and
nothing is checked against your Mac. It lands at `/run/host-podman` in the
container, and [`tools/docker-socket-access.sh`](tools/docker-socket-access.sh)
links `/var/run/docker.sock` at the socket inside it — so `docker`, `k3d` and
`deployments/local`'s Makefile all find it where they already look.

**SSH agent forwarding does not go through a bind mount on this row** — see
[SSH agent forwarding](#ssh-agent-forwarding).

## Host Docker access (the local service stack)

The local service stack (`make -C deployments/local local-up`) runs `k3d` and
builds the service images against the **host's** Docker daemon —
Docker-outside-of-Docker. The **host override** bind-mounts the host runtime
socket to `/var/run/docker.sock` inside the container — it lives there rather than
in `docker-compose.yml` because how a host exposes that socket is a property of
the host, and the [macOS + Podman row](#podman-on-macos) cannot bind one at all
(it routes the socket in through a named volume instead) — and the image ships the
`docker`
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

This works out of the box on a standard setup. Three notes cover the rest:

- **Non-default socket path**: set `DOCKER_SOCKET` in `.env` to the host path
  before opening the container. The Docker rows default to `/var/run/docker.sock`
  and the Linux Podman row to rootless podman's own `/run/user/1000/podman/podman.sock`
  — the runtime that created the container, and the only one its user namespace
  can be granted; a host that also runs Docker (a Spark) has a `root:docker`
  `/var/run/docker.sock` that arrives inside owned by nobody and stays unusable.
  It is a path on the host that runs the runtime, and podman rejects one it
  cannot see — on macOS that means the Mac, under a directory `podman machine`
  shares, which is why the [macOS + Podman row](#podman-on-macos) reaches its
  socket through a named volume and sets `PODMAN_SOCKET_DIR` rather than this.
- **Nothing mounted**: `tools/docker-socket-access.sh` says so at container start.
  Usually a `docker-compose.local.yml` copied before this mount moved into the
  host overrides — refresh it with `.devcontainer/setup-host.sh --force`.
- **Socket permissions** are aligned automatically at container start by
  `tools/docker-socket-access.sh` (run from `postStartCommand`), regardless of
  the host socket's owning group — so you do not need to match `DOCKER_GID` by
  hand. If `make local-up` still reports it cannot reach the daemon, confirm the
  host daemon is running and that `docker ps` works **from a fresh terminal**
  inside the container.

## Browsers

Chromium is baked into the image, because the front-end commit gate
(`packages/case-harness`'s suite), the validator's browser driver and the Rust
suite's served validator-project tests all launch it through Playwright, and
`npm ci` installs Playwright without downloading any browser. Two scripts
install it, at the `PLAYWRIGHT_VERSION` `docker-compose.yml` pins:

- `system/browser-deps.sh` installs the system libraries Chromium links
  against, as root. The package list is Playwright's own, resolved for the
  distribution the image is built on, which is why these packages are absent
  from `system/apt.sh`.
- `tools/browsers.sh` downloads Chromium itself, as the container user, into
  `~/.cache/ms-playwright`, then starts it headless and renders a page, so a
  browser that cannot run in this image fails the build rather than the commit
  gate.

Keep that pin equal to the `playwright` in `packages/case-harness` and
`packages/browser-driver`: Playwright resolves a browser build per client
version. In a container built before the pin moved, running both by hand
installs the new build without waiting for a rebuild:

```sh
sudo bash .devcontainer/system/browser-deps.sh
bash .devcontainer/tools/browsers.sh
```

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

The `build-portable-*` aliases are pinned to `x86_64-unknown-linux-musl`, so they
are a cross build on an aarch64 container and need an x86_64 musl cross toolchain
that `apt.sh` does not install. For a static binary that runs here, use
`scripts/build-gg-static.sh`, which targets the host architecture.

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
Two of the four host variants bind a host socket to that path: the Linux Podman
one from `$SSH_AUTH_SOCK`, and the macOS Docker one from
`/run/host-services/ssh-auth.sock`, which Docker Desktop and OrbStack both
synthesise inside their own VM for exactly this. The Linux Docker row binds nothing and
leans on the extension's own forwarding, the same as the row below.

The macOS Docker row deliberately does **not** interpolate the host's
`$SSH_AUTH_SOCK` the way the Linux Podman row does. On macOS that variable names
a per-boot random path (an `~/.ssh/agent/s.*` socket, or a launchd `Listeners`
socket), the compose `up` VS Code runs inherits it, and a bind source the daemon
cannot find is silently created _as a directory_ — so one reboot later the
container refuses to start with `not a directory: Are you trying to mount a
directory onto a file`, leaving a junk directory at the stale path to delete.
The synthesised socket never goes stale because the runtime resolves it on its
own side of the VM boundary. If a runtime ever serves it elsewhere, set
`SSH_AGENT_SOCKET` in `.env` — a dedicated name, because the ambient variable
leaking into the interpolation was the bug.

**macOS + Podman cannot have such a path.** Forwarding an agent this
way means bind-mounting a live unix socket, and on macOS the Mac's own agent
socket (under `/private/tmp/com.apple.launchd.*/Listeners`) sits on the far side
of virtiofs, which shares files rather than socket endpoints; `podman machine` has
no counterpart to the path the Docker runtimes invent. Use the Dev Containers
extension's own agent forwarding instead — it runs over the extension's channel
rather than the filesystem, so it needs nothing in the compose file, and
[`system/.bashrc`](system/.bashrc) leaves `SSH_AUTH_SOCK` alone when no bridged
socket exists. If you would rather not depend on it, `git` over HTTPS with the
`gh` CLI (which the image ships) works on every row.
