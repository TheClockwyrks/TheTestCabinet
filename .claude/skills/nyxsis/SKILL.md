---
description: Required reading when configuring this repository for Nyxsis or changing anything Nyxsis reads from it, such as the .nyxsis/ folder (project.toml, mirrors.toml), the declared commands, cloud claims or build deadline, .copier-answers.yml, the devcontainer's compose file and its variables, forwardPorts, the cargo wrapper, or the pipeline's test results.
name: nyxsis
---

<!-- cspell:words Nyxsis nyxsis junit -->

# What this repository carries for Nyxsis

## Overview

Nyxsis manages the fleet's projects and their workspaces: it builds and starts
a workspace's devcontainer, runs its commands, forwards its ports, reads its
issues, mirrors and test results, and keeps it on the template it was rendered
from. Everything it learns about this
repository it reads from the files below, so configuring the repository for
Nyxsis means editing them. This skill states each file's shape, its default
where the repository declares nothing, and what Nyxsis does with it.

Read it before adding or changing any of them, and before changing anything
they name: a `make` target a declared command runs, the devcontainer's
compose file, or the pipeline's test steps.

## The one rule

Every change leaves the repository building and running with no Nyxsis
component present. A developer who has never run Nyxsis clones it, opens the
devcontainer and runs every gate as before. Nothing below may become something
the repository needs Nyxsis to build or run.

## The `.nyxsis/` folder

`.nyxsis/` at the repository's root is the one place for what only Nyxsis
reads. What it holds are facts about the repository itself, true whoever works
on it: how long its devcontainer takes to build, the commands it is worked
with, the issues it keeps, the repositories that mirror it. Nothing else in the
repository is written for Nyxsis alone: keep anything new Nyxsis should read
in this folder, and name Nyxsis nowhere outside it but in this skill and where
`CLAUDE.md` and `.claude/README.md` point at it. A `.nyxsis/` folder anywhere
but the root is read by nothing.

Every file in it is TOML and every file and top-level key is optional. What the
repository leaves out takes the default stated below.

## `.nyxsis/project.toml`

The project declaration. It is at most 16 KiB, and is read from the checkout
as it stands, so a workspace follows the branch it is on: a bring-up reads it
when the build begins, and each report of the workspace reads its commands
afresh. A file that cannot be read as TOML is malformed for every key; a
malformed value of one key is reported with the reason and leaves the other
keys read. A top-level key this skill names nowhere is ignored. The `[cloud]`
table alone is read from the default branch instead, as [its section](#cloud)
states.

```toml
build_timeout_seconds = 5400

[[command]]
name = "test"
run = ["cargo", "nextest", "run"]
timeout_seconds = 1800

[[command]]
name = "docs"
run = ["npm", "run", "-w", "apps/docs", "dev"]
background = true
ports = [4321]
```

### `build_timeout_seconds`

A positive whole number of seconds bounding the devcontainer's build and start
together, on a workspace's creation and on every rebuild. Where none is
declared, or the value is malformed, the bound is 21600 seconds, and a malformed
value is reported in the bring-up's output. A bring-up reaching its deadline
fails at the stage it was in. Raise it when the image grows slower to build.

### `[[command]]`

One table per command the project is worked with, which Nyxsis offers as the
workspace's commands. Each runs with no shell from the checkout's root inside
the running devcontainer, as the account the container runs as, and starting
one is refused while the container is not running. Its keys:

| Key | Shape | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Letters, digits and hyphens, starting with a letter or a digit, unique within the file | Required | What the command is listed and addressed by |
| `run` | A list of at least one word, none empty | Required | The command's words, run with no shell |
| `background` | `true` or `false` | `false` | Whether the command runs until stopped rather than to completion |
| `ports` | A list of the container's port numbers, 1 to 65535 | None | The ports a background command serves; background commands only |
| `timeout_seconds` | A positive whole number | 7200 | The bound on a command running to completion; such commands only |

A command running to completion is an operation of the workspace, carrying its
output and ending with its exit status: zero succeeds, any other fails naming
it.

A background command runs until it is stopped, its program exits or the
container stops, inside a persistent terminal multiplexer so it keeps running
with nothing attached and can be attached to. At most one instance of each
runs. Starting it from an application that forwards ports forwards each of its
`ports` to that device, and those forwards end when the command ends. A
development server or a documentation site is a background command with its
port in `ports`:

```toml
[[command]]
name = "web"
run = ["npm", "run", "-w", "apps/web", "dev"]
background = true
ports = [5173]
```

A table with a key other than these five, `ports` on a command running to
completion or `timeout_seconds` on a background one is malformed. A malformed
command is reported with its reason, and the rest of the file, its other
commands among it, is still read.

Since `run` takes no shell, a command needing pipes, `&&` or variables runs a
script the repository carries, or names `bash` and `-c` as its first words.

### `[cloud]`

The cloud resources the project deploys to, which Nyxsis reads for their
health, state and cost and shows on the project's Cloud page. Unlike the rest
of the file, the table is read by the controller from `.nyxsis/project.toml` on
the primary remote's default branch, and read again whenever that branch's head
moves, so a claim takes effect with a commit there and needs no workspace
checked out. Without the table, or with the table empty, the project claims
nothing.

```toml
[cloud]
resource_groups = ["example-prod-rg"]
r2_buckets = ["example-assets"]
pages_projects = ["example-docs"]
```

- `resource_groups`: the Azure resource groups, by name, matched in every
  subscription Nyxsis reads. A managed cluster in a claimed group claims its
  node resource group with it, so that group is not listed.
- `r2_buckets`: the Cloudflare R2 buckets, by name, matched in every account
  the fleet's Cloudflare login reaches.
- `pages_projects`: the Cloudflare Pages projects, by name, matched the same
  way.

Each key is optional and a list of at most 32 names, each a non-empty string
named once and matched without regard to case. Claim every group, bucket and
Pages project holding something the project deploys, its cluster, registry,
storage and key vault among them, since what no claim names is read as no
project's. A table holding another key, a key that is not a list of names, or
one listing more than 32 names or a name twice is malformed: it is reported on
the project with the reason and claims nothing, and the file's other keys are
read. A file that cannot be read at all is reported with the reason, and the
claims last read from it stand.

The project's Cloud page lists each claimed name under Claims with its kind and
the subscriptions or accounts it matched in, or Unmatched where nothing read
holds it, and names any other project claiming it too, in whose figures it
also counts. Below that it shows, for what the claims hold, each cluster with
its power and provisioning states, its Kubernetes version and its node pools,
each registry with its repositories, each storage account with its capacity and
containers, each key vault's secrets and certificates by expiry, the R2 buckets
and Pages projects, the month's spend per resource group, and every Azure
resource of the claimed groups with its availability. A project claiming
nothing says "The project claims no cloud resources."

## `.nyxsis/issues/`

The project's issues, one Markdown file each, which the issues server
(`nyxsis-issues`) writes as a session files and changes them. The `repo-tasks`
skill states how an issue is filed and written.

## `.nyxsis/mirrors.toml`

The repositories that receive this repository's code some other way, read from
its default branch rather than from a checkout. It holds one `[[mirror]]`
table with a `url` for each mirror, at most 16 mirrors:

```toml
[[mirror]]
url = "https://github.com/example/project"
```

Without the file the repository has no mirrors. An empty file, or one with no
`mirror` tables, declares none. A file larger than 16 KiB, one that is not
TOML, one holding a key other than `mirror` and `url`, one naming more than 16
mirrors, an empty `url`, a `url` carrying a credential or one repository named
twice is malformed and declares no mirrors, its reason naming the rule broken.

This repository's pipeline pushes to the mirror declared here too:
`scripts/ci/mirror.sh` refuses a target the file does not declare, so moving the
mirror means changing its `url` here and the `url` that `.azure/project/jobs.yml`
passes to `.azure/tcab/mirror-job.yml` together
(see the GitHub mirror section of `development/building.md`).

## `.copier-answers.yml`

Copier writes this file on every render and update; edit it only to resolve an
update's conflict. Its `_src_path` and `_commit` record the template this
workspace was rendered from and the version it was last rendered or updated
against, which is what Nyxsis reports the workspace's drift and applies its
updates against. The other keys are the answers to the template's questions,
which an update renders the newer version from. Never hand-edit `_commit` to
claim a version: the files would not match it.

## The devcontainer

Nyxsis builds and starts the workspace's container itself, on whichever
machine of the fleet the workspace lives, so what the container needs from the
machine arrives through variables rather than through files of this
repository.

- `.devcontainer/devcontainer.json` names a compose file in
  `dockerComposeFile` and the service in it. What the container is built and
  run with lives in that compose file. Add a second container there as a
  second service.
- The compose file reads these variables, each through `${NAME:-default}` so a
  variable left unset takes the file's own default:

  | Variable | What it carries |
  | --- | --- |
  | `DEVCONTAINER_USERNS` | The user namespace mapping the container runs under, `host` by default, `keep-id:uid=1000,gid=1000` under rootless Podman, which maps the host's account onto the image's |
  | `DEVCONTAINER_RUNTIME_SOCKET` | The host's container runtime socket, bound in |
  | `DEVCONTAINER_RUNTIME_TCP` | The runtime's TCP endpoint where no socket can be bound in, as on a Mac |
  | `DEVCONTAINER_RUNTIME_CREDENTIAL` | The credential the container presents to that endpoint |
  | `DEVCONTAINER_SSH_AUTH_SOCK` | The host's SSH agent socket, bound in |
  | `DEVCONTAINER_SSH_AGENT_TCP` | The SSH agent's TCP endpoint where no socket can be bound in |

  A Nyxsis bring-up states each of them for the machine it runs on. An editor's
  Reopen in Container reads them from `.devcontainer/.env`, which is ignored
  by git and copied from `.env.podman` on Linux or `.env.macos` on a Mac.
  On a Mac the runtime is reached at `host.containers.internal:17386` and the
  SSH agent at `host.containers.internal:17385`.
- A bring-up whose configuration reads too few of these variables is refused
  before the build, naming the variable: one reading no `DEVCONTAINER_USERNS`
  on a rootless runtime, or no `DEVCONTAINER_RUNTIME_CREDENTIAL` where the
  container reaches the runtime over TCP. A variable counts as read when its
  name appears as a whole word in `devcontainer.json` or a compose file it
  names. Keep every one of them read when editing the compose file.
- The compose file states `x-podman.in_pod: false`, so podman-compose creates
  no pod beside the `keep-id` mapping, which Podman refuses. Keep it.
- The image's account is `dev` at uid and gid 1000 on every machine, created
  by the published image the devcontainer is built on, so the image takes no
  build argument naming a host's ids. The user namespace maps a host's account
  onto it.
- The runtime socket's group is resolved when the container starts, and the
  container user joined to it then, so the image carries no group id of any one
  host.
- The container publishes the host's SSH agent at
  `/tmp/devcontainer-ssh-agent.sock`, whether the socket is bound in or bridged
  over TCP, and shells point `SSH_AUTH_SOCK` at it. Reach the agent through
  that path, never through where the runtime bound the host's socket.
- The ports `devcontainer.json` lists under `forwardPorts`, each a port number
  or a `"service:port"` string, are offered as forwards to the operator's
  device, each under the `label` that `portsAttributes["<port>"]` gives it.
  Any other port is still forwarded by number. Declare the ports the project
  serves on, with a label saying what serves there:

  ```json
  "forwardPorts": [5173],
  "portsAttributes": { "5173": { "label": "Web app" } }
  ```

- `az`, `gh` and `wrangler` are on the `PATH` of every process the container
  starts, a shell's and a command run with no shell alike, which is what offers
  their logins in the workspace. Keep each installed into a directory every
  process's `PATH` holds, such as `~/.local/bin`, not one a login shell adds.
- `cargo` on the container's `PATH` is a wrapper,
  `~/.local/bin/cargo`, which the published toolchain image the devcontainer
  is built on installs ahead of the toolchain's own. It runs `build`, `check`, `clippy`,
  `doc`, `test` and `nextest` under a permit from the fleet's agent, so the
  workspaces on one machine take turns building. It does so only where the
  agent has placed its executable at
  `/nyxsis/harness/bin/<platform>/nyxsis-agent` in the container and the
  session names its workspace in `NYXSIS_WORKSPACE`, and runs cargo as it is
  otherwise, and under `NYXSIS_PERMIT_CORES`, which a command already holding a
  permit carries. Run cargo by name as anywhere else, and keep `~/.local/bin`
  ahead of `~/.cargo/bin` on every `PATH`, or cargo runs past the wrapper.

## The pipeline's test results

Nyxsis reads a run's test results from the artifacts the pipeline publishes.
Each test gate writes its JUnit report, and each job running one publishes the
reports as the artifact `test-results-<job>-<attempt>`, one folder per gate
named by the gate's id holding its report as `junit.xml`:

```text
test-results-rust-1/
  rust-test/junit.xml
```

They are published whether the tests passed or failed, and where a job ran
more than once its latest attempt's results are the run's. A test is known
across runs by the gate that ran it and the class name and name its report
gives it, and a test nextest records as failing and then passing on a retry is
flaky. An artifact larger than 32 MiB, or holding a report that is not JUnit,
is left unread, and a run that published none records no test results.

A gate whose runner writes a JUnit report, cargo nextest's, vitest's and
pytest's among them, writes it as `junit.xml` in the artifact directory the
gate runner gives it, `target/gate-artifacts/<id>/` on the pipeline, whose step
names that directory. `scripts/ci/collect-test-results.sh`, run at the end of
each such job whether its gates passed or not, copies every report into
`target/test-results/<id>/junit.xml`, which the job publishes. Keep a new test
gate on that path so its results are read from its first run.
