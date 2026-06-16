# Run Containers

These are the container images The Test Cabinet runs benchmarks inside. Every run
executes in an isolated container seeded with a fresh git repository, so a model
cannot reach the host or other runs' work (see `docs/execution.md`).

The current goal is web-UI test cases only, so there is exactly **one image per
agent harness** and nothing more.

## Layout

```
containers/
├── base/Dockerfile        # shared toolchain (git, Node build tools, run user)
├── claude/Dockerfile      # one image per harness, each FROM the base
├── codex/Dockerfile
├── cline/Dockerfile
├── antigravity/Dockerfile
├── goose/Dockerfile
├── kilo/Dockerfile
├── opencode/Dockerfile
├── pi/Dockerfile
└── build.sh               # builds the base, then each harness image
```

Each directory is named with the harness's stable slug — the same slug the agent
harness layer, run records, and site use.

## Base image

`base/` carries everything common to a run and nothing harness specific: `git`
(each run is a fresh repository), a Node.js build toolchain (test cases produce
web UIs that are built inside the container), Playwright with a headless Chromium
(test cases are browser games, so a model can drive and screenshot its own build
to verify it), and an unprivileged `node` user whose home is configured so each
harness image can install its CLI without root. Every harness image is `FROM` the
base via the `BASE_IMAGE` build argument.

Playwright is pinned to the same version as the harness's own
`packages/browser-driver`, and the Chromium build is cached in the run user's
`~/.cache/ms-playwright`, so a model that adds `playwright@1.56.1` to its project
reuses the cached browser rather than downloading one at run time.

## Building

Run on a machine with Docker (or Podman) available:

```sh
./build.sh                # base + all harness images
./build.sh claude         # base + just the claude image
DOCKER=podman ./build.sh  # build with Podman instead
```

Images are tagged `test-cabinet/base:latest` and `test-cabinet/<harness>:latest`.
Override `IMAGE_PREFIX` / `IMAGE_TAG` to change the namespace or tag.

## Runtime contract

The testing harness — not these images — owns how a container is run. Each image
only promises an environment that honors the following contract:

- **Working directory** is `/work`. The seeded repository is mounted there at run
  time; it is the harness's working directory.
- **Secrets** (API keys) are passed in **at run time as environment variables**
  and are never baked into an image or committed anywhere. The testing harness
  sets the variable the selected harness expects.
- **Network** is enabled at run time so the harness can reach model APIs and
  install packages. Isolation protects the host filesystem and other runs, not
  the network.
- **Lifecycle**: a container is started and left running (the base `CMD` keeps it
  alive), and the testing harness `exec`s the agent harness inside it, then stops
  the container when the run finishes.
- **User**: images run as uid 1000 (`node`). On a host whose checkout is owned by
  a different uid, the testing harness is responsible for reconciling ownership
  of the mounted repository.

## Status / validation

These definitions are authored but **not yet built or validated** — that requires
a Docker host. When validating on Linux, for each harness confirm:

1. The image builds (`./build.sh <harness>`) and the CLI resolves on `PATH`.
2. The CLI has a working **non-interactive / headless** invocation, and capture
   the exact flags.
3. The CLI's **token/usage reporting format** — this is the input the harness
   adapter normalizes into the run record's token classes.
4. Which **environment variable** carries the provider API key.

Once a harness is validated, **pin its version** in that Dockerfile (the installs
are currently unpinned, marked with `TODO(linux)`). The `claude` and `codex`
images use known auth variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); the
others' auth variables and headless flags are to be confirmed during validation.
The two curl-piped installers (`antigravity`, `goose`) have the least predictable
install/headless behavior and are the most likely to need adjustment.
