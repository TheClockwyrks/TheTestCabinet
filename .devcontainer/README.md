# The devcontainer

Every workspace of this project runs in this container. It is declared in
`docker-compose.yml`, built from `ubuntu.dockerfile`, and started with
`devcontainer build` and `devcontainer up`, or by an editor's **Reopen in
Container**.

`devcontainer.json` names that compose file and the `dev` service in it, and
carries what belongs to an editor: the folder the container works in, the
extensions and the lifecycle commands. Everything about how the container is
built and run is the compose file's, because a compose file states it for
every service the project comes to hold rather than for the one the JSON knew
about: a project that grows a database or a second container beside the
workspace declares it there and changes nothing about how the first one starts.

What differs from one machine to the next is in `.env` beside the compose
file, copied from `.env.podman` or `.env.macos` before the first start. See
[Host files](#host-files).

The pipeline does not build this image. Its gates run inside the purpose-built
CI images under [`ci/images/`](../ci/images/README.md), which carry what a
check reads and nothing else and are built by a pipeline of their own. What
those images share with this one is the versions: they read their pins out of
the `x-devcontainer-build-args` anchor of `docker-compose.yml`, so a gate
passes in the pipeline exactly when it passes here.

## What the image carries

- The Rust toolchain `rust-toolchain.toml` pins, with `rustfmt`, `clippy` and
  `cargo-nextest`, and `mold`, the linker cargo links a glibc build with. See
  [Linker](#linker). A wrapper named `cargo` in `~/.local/bin` runs the heavy
  subcommands in turn with the machine's other workspaces. See
  [The cargo wrapper](#the-cargo-wrapper).
- This architecture's musl target and `musl-tools`, for static builds. See
  [Static builds](#static-builds).
- Node and npm, which the web app, the documentation site, the prose gates and
  Prettier run on.
- Three browser engines, which the web app's browser tests are driven against,
  and whose Chromium the case-harness suite, the validator's browser driver and
  the Rust suite's served validator-project tests launch. See
  [Browsers](#browsers).
- `make`, `python3`, `shellcheck`, `uv` and a pinned `pre-commit`, which is
  what runs the gates.
- The Claude Code and Codex CLIs, because a harness session runs inside the
  devcontainer of the workspace it belongs to. Both are in `~/.local/bin`, on
  the `PATH` the Dockerfile gives every process in the image, because a session
  is started by an `exec` naming `claude` or `codex` with no shell in between
  to add a directory to it. `ai/claude.sh` and `ai/codex.sh` each run the
  command from there once, so an install that put it anywhere else fails the
  build rather than the first session. `ai/claude-managed-settings.json` is
  copied to `/etc/claude-code/managed-settings.json`, Claude Code's managed
  settings, and sets bypass permissions mode as the default for every session
  in the image with the mode's disclaimer accepted. Claude Code grants that
  mode from its managed settings, a user's settings or a `--settings` file
  alone, and ignores it in a checkout's `.claude/settings.json`, so the
  image's file is what makes a session run unattended whichever configuration
  directory it points the harness at.
- `k3d`, `kubectl`, `kubelogin`, the Azure CLI, and the `docker` and `podman`
  clients, which drive the host's container runtime rather than an engine of
  their own.
- `helm`, at the `HELM_VERSION` `tools/k8s.sh` pins, which installs a
  cluster's prerequisites from their charts. No CI image carries it, because
  no gate installs a chart.
- `git`, `ssh`, `tmux`, `lazygit` (aliased to `gg`), `jq` and `ripgrep`.
- gg's eleven program-language toolchains and the build toolchains of its C#
  guest, about 3.4 GB under `~/.local/share`, installed by the repository's own
  installers from the pins beside each arm. Building `crates/gg` reflects a
  signature catalogue out of every arm's SDK, so without them
  `cargo build --workspace` fails. See [gg's toolchains](#ggs-toolchains).
- `ruby`, the one gg toolchain that is a distribution package; `libicu-dev`,
  which the C# arm's Roslyn needs to start; `ffmpeg`, which
  `scripts/build-sample-pack.mjs` normalizes audio with; `cmake`; and
  `iproute2`, `lsof` and `procps` for the local cluster tooling. `system/apt.sh`
  says why each is declared rather than assumed.
- `wrangler`, the Cloudflare CLI `tcab publish` deploys a run's playable build
  with, at the `WRANGLER_VERSION` `tools/wrangler.sh` installs, in `~/.local/bin`
  for the same reason the coding-agent CLIs are.

Every version is pinned. The toolchain versions are the build arguments in the
`x-devcontainer-build-args` anchor of `docker-compose.yml`, which the `dev`
service merges; the tools without one are pinned in the script that installs
them. gg's toolchains are pinned in each arm's
`packages/gg-sandbox-*/<lang>-version.sh`, the one pin the pipeline, the run
images and this image all install from, with the Rust arm's deferring to
`rust-toolchain.toml`. A gate whose toolchain is absent fails and names the
command that installs it, so a toolchain missing here is a check that says so
rather than one that quietly passes.

`post-create.sh` populates the `contracts/` submodule, which every build compiles
against, and the `test-suites/` submodule, the suites checkout the local backend
ingests (not `cold-storage/`, which is optional and about 2 GB),
installs the git hook through `scripts/setup-hooks.sh`, places cargo's target
directory (see [Where cargo builds](#where-cargo-builds)) and installs the npm
workspace's locked dependencies when the container is created.
A folder that `git init` has not been run in yet takes the rest and says the
hook was skipped. Nothing runs in the background afterwards: when it returns,
the container builds the whole workspace.

## Architecture

Every script reads `dpkg --print-architecture` out of the image it installs
into rather than a build argument, because Podman supplies none, and fails
loudly on an architecture it has no mapping for.

Every script that downloads a binary by hand runs it once, immediately after
installing it. `kubectl`, `k3d`, `docker`, `lazygit`, `cargo-nextest` and
`mold` all install just as happily when they are built for the other CPU, and
would first fail against a cluster, in the test gate, or under your fingers.
The three browser engines are started once for the same reason, by
`tools/browsers.sh`. A
wrong-architecture `node` fails unrecognizably, because `npm`'s shebang leaves
the failed exec to glibc:

```text
/home/<user>/.local/bin/node: 1: Syntax error: ")" unexpected
```

The release archive `languages/rust/cargo-nextest.sh` downloads is checked
against the checksum `docker-compose.yml` pins beside `NEXTEST_VERSION` for
this architecture, `NEXTEST_SHA256_AMD64` or `NEXTEST_SHA256_ARM64`, before the
binary is taken out of it, and nextest is never built from source.
`languages/rust/mold.sh` checks mold's archive the same way, against
`MOLD_SHA256_AMD64` or `MOLD_SHA256_ARM64` beside `MOLD_VERSION`.

## Linker

Cargo links the two glibc targets, `x86_64-unknown-linux-gnu` and
`aarch64-unknown-linux-gnu`, with `mold`. A test build links one binary per
crate at once, and `mold` links each in a fraction of the time GNU `ld`
takes. It carries debug info through, so a failed test reports the
same panic and backtrace.

`languages/rust/mold.sh` installs `mold` beside `cargo`, with `cc-mold`, a
driver that runs `cc -fuse-ld=mold`. The image's environment names that driver
as each target's linker:

```sh
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=cc-mold
CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=cc-mold
```

The image sets them, so a terminal, the editor's language server and an `exec`
naming `cargo` all link alike. Every other target, such as a musl one, links
with what its own configuration names. Unsetting the variable for a command
links it with GNU `ld`:

```sh
env -u CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER \
  -u CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER cargo build
```

## The cargo wrapper

`languages/rust/permit-wrapper.sh` places a wrapper named `cargo` in
`~/.local/bin`, which the Dockerfile puts on the `PATH` ahead of
`~/.cargo/bin`, so every program that runs `cargo` by name reaches it first. It
runs the toolchain's cargo, at `$CARGO_HOME/bin/cargo` or
`~/.cargo/bin/cargo`, with the arguments it was given.

The subcommand is the first argument that is not an option, after a leading
`+toolchain`. `build`, `check`, `clippy`, `doc`, `test` and `nextest` wait
for a permit from the fleet's agent, which the machine's workspaces share, and
start with the permit's share of the cores in their environment. That happens
only where the agent's executable is in the container and the session the
agent started names its workspace. Every other subcommand, a terminal opened by
hand and a container without the executable run cargo as it is. The permit is
advisory: a command the agent grants none within the wait runs without one, so
a machine whose agent is down builds as it always did.

The CI images do not run the script. A pipeline job runs no agent, and a job
that caches the crate registry repoints `CARGO_HOME`.

## Browsers

Three browser engines are installed, which is what lets a test drive a real one
rather than a DOM implementation: **Chromium**, **Firefox** and **WebKit**.

WebKit is there in place of Safari. Apple publishes Safari for macOS and iOS
only, so no version of it can be installed on Linux, and WebKit is the engine
Safari is built on. Playwright builds it from the same upstream source, which
is what makes a layout or rendering difference show up in here rather than
first on somebody's Mac. Nothing in this image is Safari, and a check that
passes against WebKit is evidence about Safari rather than proof.

Two scripts install them, at the `PLAYWRIGHT_VERSION` `docker-compose.yml` pins:

- `system/browser-deps.sh` installs the system libraries the engines link
  against, as root. The package list is Playwright's own, resolved for the
  distribution the image is built on, which is why these packages are absent
  from `system/apt.sh`.
- `tools/browsers.sh` downloads the engines themselves, as the container user,
  into `~/.cache/ms-playwright`. It then starts each one headless and renders a
  page in it, so an engine that cannot run in this image fails the build rather
  than the test gate.

That pin is one of two. It decides which build of each engine lands in
`~/.cache/ms-playwright`, and `apps/web/package.json`'s `playwright` decides
which build the app's tests ask for, because Playwright resolves an engine per
client version. A bump therefore moves both, and
`ci/gates/web-browser-test.py` reads the two and fails with both values
when they disagree, rather than leaving the mismatch to surface inside the
browser provider.

The `playwright` in `packages/case-harness` and `packages/browser-driver`
follows the same pin, for the same reason: those launch the Chromium the image
holds, and a different client version asks for a build that is not there.

Both scripts run at build time, so a machine opening the container downloads
nothing. The engines occupy a little over a gigabyte in `~/.cache/ms-playwright`,
and the libraries are on top of that. In a container built before the pin moved,
running both by hand installs the new engines without waiting for a rebuild:

```sh
sudo bash .devcontainer/system/browser-deps.sh
bash .devcontainer/tools/browsers.sh
```

## gg's toolchains

gg drives a model in one of eleven program languages, and what a model is told
about each one is a signature catalogue that `crates/gg/build.rs` reflects out
of that arm's own SDK, with that arm's own documentation tool, on every build of
the crate. The toolchains are therefore a prerequisite of building the
workspace, and a prerequisite of working in the repository is a prerequisite of
the image rather than an hour of downloads after the container is created.
`languages/gg/install.sh` installs them in the image's last layer, and its
header says why it delegates rather than installs:

- `scripts/ci/install-gg-toolchains.sh` installs the eleven arms, about 1.9 GB:
  the pinned YARD on the image's `ruby`, the `wasm32` standard library, `purs`
  and `esbuild`, a JDK with TeaVM and the Kotlin compiler, wasi-sdk, .NET with
  Roslyn, the Swift toolchain, and the package-manager-delivered build tools
  the arms' artifact builds resolve offline.
- `scripts/ci/install-gg-build-toolchains.sh` installs what building the C#
  guest needs and no run does, about 1.4 GB under `~/.local/share/tcab/gg-build`:
  a whole .NET SDK and an unpruned wasi-sdk.

They are the same two installers the pipeline's `scripts/ci/gg-ci-toolchains.sh`
and the driver image's gg stage run, so the one pinned list serves every surface
that builds gg. Everything lands under the container user's home, which is
where the reflectors look first and all that three of the arms can use, so the
layer runs as that user and `"updateRemoteUserUID": false` in
`devcontainer.json` is load-bearing: a uid rewrite at start would orphan it.

The layer is last, and its own, so a pin moving under `packages/`, an installer
changing or a new arm arriving rebuilds it and nothing above it, and a failed
download from one of its half-dozen upstreams is retried with everything else
cached. Each installer checks what is there against its pin and touches no
network when they match, so in a container built before a pin moved, running
both by hand reconciles it without waiting for a rebuild:

```sh
scripts/ci/install-gg-toolchains.sh
scripts/ci/install-gg-build-toolchains.sh
```

The one prerequisite of a gg build that is not in the image is the npm
workspace, because two of the eleven catalogues are reflected with the pinned
`typescript` in it, and it lives in the checkout. `post-create.sh` installs it.

## The build context

The image is built from the repository root rather than from this directory,
because the toolchain installers read their pins out of the repository and the
repository is not mounted while an image builds. Every `COPY` in
`ubuntu.dockerfile` is therefore written from the root, and the last layer
stages a partial repository at `/tmp/scripts/gg-repo` for the installers: the
installers and the shell they source, gg's own build shell, every arm's pins
and the files those pins read, and `rust-toolchain.toml`. `scripts/ci/tcab-lib.sh`
resolves the repository root from its own path, which is what lets the slice
stand in for a checkout. The `RUN` that installs deletes it, so the image ships
no stale half repository to read a pin out of.

The root `.dockerignore` is an allowlist, and it decides what the build sees:
it admits the directories under `.devcontainer/` the Dockerfile copies, the
installers, gg's shell, the guest packages and `rust-toolchain.toml`. A source
it keeps out fails the build at that `COPY` with the path not found, under
Docker and Podman alike. The files under `packages/` are copied one by one
rather than as a directory, because a directory copy takes everything the
allowlist admits, and would put the arms' whole sources into the toolchain
layer's cache key; the price is that a new arm names its version file in the
Dockerfile, and the build fails on the installer's own `source` line until it
does.

## Static builds

A binary linked statically against musl carries no dynamic loader, so it runs
on a distribution that ships none of the usual FHS layout, NixOS among them, as
well as on a mainstream one. `languages/rust/targets.sh` adds this
architecture's musl target, and `system/apt.sh` installs `musl-tools`, whose
`musl-gcc` is the linker such a build needs and the C compiler a crate
compiling C of its own calls:

```sh
cargo build --release --target "$(uname -m)-unknown-linux-musl"
```

`musl-tools` targets the architecture it is installed on and no other, so the
other architecture's musl target would be a cross build with nothing here to
link it. Each architecture's static binary is therefore built on a machine of
that architecture. The Rust CI image carries the same target and package.

## Where the workspace is mounted

`workspaceFolder` in `devcontainer.json` is the path this project works from
inside the container, and the `dev` service's first mount in
`docker-compose.yml` mounts the checkout there. Both are built from the
project's slug, so they are the same path whatever the checkout directory on
the machine is named.
Declaring only the folder would leave the mount at the checkout directory's own
name, which starts a container whose working directory does not exist. The two
files cannot see each other's half, so `scripts/check-devcontainer.py` holds
them together and the gate runs it on every commit.

## Where cargo builds

cargo builds into the checkout's `target/`, where `make clean` reaches it and
where `crates/core` looks for a locally built gg (`target/debug/gg`,
`target/release/gg`). Every machine in the fleet runs Podman with the checkout
bound in directly, so nothing moves the directory elsewhere; a developer who
wants it elsewhere sets `CARGO_TARGET_DIR`, which the scripts that look for a
built binary honour.

## What the compose file declares

| Key | Declares |
| --- | --- |
| `init: true` | An init process that reaps the processes the container's tools leave behind |
| `extra_hosts: host.docker.internal:host-gateway` | A route to the host's loopback, where a local cluster's API server is published |
| `userns_mode` | The user namespace, `host` unless `DEVCONTAINER_USERNS` names another |
| `command: sleep infinity` | What keeps the container alive; a compose service runs its own command |
| `x-podman.in_pod: false` | No pod for the project's services, which podman-compose otherwise creates and Podman refuses beside a `userns_mode` of its own; other compose providers ignore it |

## Host runtime access

The container runs no engine of its own. It drives the host's container runtime,
which is what lets `k3d` create a cluster whose nodes are siblings of this
container. That cluster is this workspace's local cluster, which the socket
below is for: `make -C deployments/local local-up` creates it and deploys the
project to it. Two paths are bound in, both read from the variables
[Host files](#host-files) states:

| Host path | Container path | Published at |
| --- | --- | --- |
| `DEVCONTAINER_RUNTIME_SOCKET`, default `/var/run/docker.sock` | `/run/host/runtime.sock` | `/var/run/docker.sock` |
| `DEVCONTAINER_SSH_AUTH_SOCK`, default `/dev/null` | `/run/host/ssh-agent.sock` | `/tmp/devcontainer-ssh-agent.sock` |

At every start `tools/host-runtime.sh` and `tools/ssh-agent.sh` publish them. A
bound socket is linked to its published path. A bound path that is not a socket,
which is `/dev/null` by default, is bridged over `DEVCONTAINER_RUNTIME_TCP` or
`DEVCONTAINER_SSH_AGENT_TCP` when that variable is set, and publishes nothing
when it is not. A host that guards the runtime's TCP endpoint also sets
`DEVCONTAINER_RUNTIME_CREDENTIAL`, which is given to this container alone and
which the bridge presents on every connection. `tools/docker-socket-access.sh`
then aligns the runtime socket's permissions with the container user, whatever
group owns it on the host. The image takes no build argument for that group,
which is known only once the socket is bound in, so it is aligned at every
start and the image is the same one whichever path starts the container.
A bridge runs detached from the command that started it, in a session of its
own, and socat is restarted whenever it exits, so it outlives the
`postStartCommand` exec and every exec after it.

If something cannot reach the runtime, confirm the host socket is up and that
`docker ps` works from a fresh terminal inside the container, because group
membership is picked up per login shell. `/tmp/host-runtime-bridge.log` says
what the runtime publisher did. Where the bridge reaches nothing that answers
as a runtime, what it says depends on whether the container was stated
`DEVCONTAINER_RUNTIME_CREDENTIAL`, as [Podman on macOS](#podman-on-macos)
describes.

`podman` in here is the remote client, which `CONTAINER_HOST` points at the
published socket. `docker buildx` only works against a real Docker daemon; on
Podman, build with `podman build`.

## Host files

What differs from one machine to the next is stated in variables the compose
file reads: the host user's ids, the user namespace the container runs in,
where the runtime socket and the SSH agent are, and whether the image carries
the CUDA toolkit. `.env` beside the compose file is where a machine states
them. Compose reads `.env` from the directory the compose file sits in, so the
values reach an editor's **Reopen in Container**, which sets no environment of
its own, and `devcontainer up` alike, and a variable already set in the
environment the container is started from wins over the file, which is how a
bring-up managed for the machine states them. `.env` is ignored by git, because
its values are the machine's, and is copied from one of the files committed
beside it, each of which says what it sets and why:

| Host | Before the first start |
| --- | --- |
| Rootless Podman on Linux | `cp .devcontainer/.env.podman .devcontainer/.env`, then put the ids `id` prints in it |
| Podman on macOS | `cp .devcontainer/.env.macos .devcontainer/.env`, then start the two bridges [Podman on macOS](#podman-on-macos) describes |

Rootless Podman maps the host user to root inside the container unless told
otherwise, and the `keep-id` mapping `.env.podman` states maps it onto the
container user instead, so files the container writes into the checkout stay
owned by that user on the host. The mapping and the ids the image creates the
user with are both built from `DEVCONTAINER_UID` and `DEVCONTAINER_GID`, so
`id` is checked once: a primary group that is `users` (100) rather than a
per-user group (1000) is the usual difference between a NixOS host and an
Ubuntu one. Enable Podman's socket once with
`systemctl --user enable --now podman.socket`, and run the devcontainer CLI
with `--docker-path podman`, because the `docker` client refuses a `keep-id`
user namespace before Podman sees it.

The variables and what the compose file defaults each to when nothing sets it:

| Variable | Default | Declares |
| --- | --- | --- |
| `DEVCONTAINER_UID`, `DEVCONTAINER_GID` | `1000`, `1000` | The ids the image creates the container user with |
| `DEVCONTAINER_USERNS` | `host` | The user namespace, `keep-id:uid=<uid>,gid=<gid>` on rootless Podman |
| `DEVCONTAINER_RUNTIME_SOCKET` | `/var/run/docker.sock` | The host's runtime socket, bound in; `/dev/null` where none can be |
| `DEVCONTAINER_SSH_AUTH_SOCK` | `/dev/null` | The host's SSH agent socket, bound in |
| `DEVCONTAINER_RUNTIME_TCP`, `DEVCONTAINER_SSH_AGENT_TCP` | unset | Where each is bridged from over TCP when it cannot be bound in |
| `DEVCONTAINER_RUNTIME_CREDENTIAL` | unset | What the runtime bridge presents to a host guarding that endpoint |
| `INSTALL_CUDA` | `false` | Whether the image carries the CUDA toolkit. See [GPU access](#gpu-access) |

## GPU access

A host with NVIDIA GPUs behind its container runtime hands them to the
container through the runtime rather than through anything installed here.
`docker-compose.nvidia.yml` asks for every GPU the host's Container Device
Interface specification names, and `nvidia/devcontainer.json` is the same
container as `devcontainer.json` with that override merged over the compose
file: an editor's **Reopen in Container** lists both and asks which, and
`devcontainer up --config .devcontainer/nvidia/devcontainer.json` starts it.
Nothing in the default configuration changes, so every other host, and a
bring-up managed for the machine, starts the container as before. Both
configurations are one compose project and one container, so opening one while
the other's container exists reuses that container: switching is **Rebuild
Container** in the editor, or `--remove-existing-container` on the CLI. The
specification is generated once on the host:

```sh
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
podman run --rm --device nvidia.com/gpu=all ubuntu nvidia-smi   # to check
```

`nvidia-smi` inside the container then reports the host driver, which is the
whole of what running a CUDA program built elsewhere takes: the CUDA wheels
PyTorch and the other Python model runtimes publish carry the runtime
libraries they need, so a workload that drives a model wants no toolkit.

Compiling CUDA is different, and `system/cuda.sh` installs a real toolkit for a
workload that does it. The toolkit is several GB and several minutes of build
time, so it is off unless `INSTALL_CUDA=true` is set in `.env` on a host whose
GPU it can use, and `.env.macos` pins it off because no GPU exists behind a
Mac's container runtime. It comes from NVIDIA's apt repository rather than from
Ubuntu's own package, which is too old for the Blackwell architecture, and
installs to `/usr/local/cuda`, which `/etc/profile.d/cuda.sh` puts on the
`PATH`. A workload that needs `nvcc` says so at its own preflight, so an image
built without the toolkit reports the reason rather than failing several layers
into a build.

## Podman on macOS

Podman on macOS runs containers in a Linux VM and resolves a bind source on the
Mac, so neither the VM's runtime socket nor the Mac's SSH agent socket can be
bound into a container. Both arrive over the Mac's loopback instead, which a
container reaches as `host.containers.internal`, and `.env.macos` states the
two endpoints.

The runtime is bridged by `tools/macos-host-runtime.sh`, run on the Mac before
the container starts. It forwards `127.0.0.1:17386` into the VM's podman socket
over the machine's own SSH connection:

```sh
bash .devcontainer/tools/macos-host-runtime.sh            # start; idempotent
bash .devcontainer/tools/macos-host-runtime.sh --status
bash .devcontainer/tools/macos-host-runtime.sh --stop
bash .devcontainer/tools/macos-host-runtime.sh --foreground   # for launchd
```

That port is full control of the podman machine for anything on the Mac that
can reach it. It binds loopback only and is not something to forward anywhere.

Every container in the podman machine reaches the Mac's loopback, so every one
of them reaches that port too. A Mac whose workspaces are managed for it guards
the port instead: what listens there admits only a connection presenting the
credential it stated the workspace's own container as
`DEVCONTAINER_RUNTIME_CREDENTIAL`, and `tools/host-runtime.sh` presents it.

On such a Mac the fleet's agent serves the runtime on a socket of its own,
`runtime.sock` in the agent's data directory under `~/.local/state`, and the
fleet configuration's bridge holds `127.0.0.1:17386`, forwarding it to that
socket.
`tools/macos-host-runtime.sh` is for a Mac with no such agent: a tunnel of its
own on the port would answer in the bridge's place and refuse the credential.
So while that socket exists it refuses to start or to run in the foreground,
exiting nonzero and naming the socket's full path and the bridge;
`DEVCONTAINER_AGENT_RUNTIME_SOCKET` names the socket where the agent keeps its
data elsewhere. `--status` and `--stop` still work, so a tunnel started earlier
can be stopped.

Inside the container, when the bridge reaches no runtime or nothing on it
answers as one, `tools/host-runtime.sh` says what to do on the Mac by whether a
credential was stated:

- A container stated `DEVCONTAINER_RUNTIME_CREDENTIAL` is told that the port is
  expected to be held by the fleet configuration's bridge to the agent's
  runtime socket, that a manual tunnel on the port refuses the credential, and
  how to find and stop whatever holds the port:
  `lsof -nP -iTCP:17386 -sTCP:LISTEN`, then `kill` the process it names if it
  is not that bridge.
- A container stated none is told to start the manual tunnel, or to stop and
  start it again where it is no longer attached to a running machine.

The SSH agent needs something on the Mac listening on `127.0.0.1:17385` and
forwarding to the agent socket, such as a launchd agent running:

```sh
socat TCP-LISTEN:17385,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:"$SSH_AUTH_SOCK"
```

Should `host.containers.internal` not resolve, point the two TCP variables in
`.env` at `192.168.127.254`, which is where podman machine's gvproxy answers
for the Mac; both scripts also try it before giving up. Podman only shares the
Mac's home directory into the VM, so the checkout has to live under `$HOME`.

## SSH agent forwarding

`system/.bashrc` points `SSH_AUTH_SOCK` at `/tmp/devcontainer-ssh-agent.sock`
once it exists, so `git push` over SSH works from inside the container. No
private key ever enters the container. Check it with `ssh-add -l`; the script
writes what it did to `/tmp/ssh-agent-socat.log`. If that reports no identities,
the bridge is fine and the host's agent is empty.

The image's SSH client is configured with `WarnWeakCrypto no` in
`/etc/ssh/ssh_config.d/50-warn-weak-crypto.conf`, which `system/apt.sh` writes,
so a connection to a forge offering no post-quantum key exchange prints no
warning about it.
