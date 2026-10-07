---
description: Required reading when configuring this repository for Nyxsis or changing anything Nyxsis reads from it, such as the .nyxsis/ folder (project.toml, mirrors.toml), the declared commands, issues, clean command or build deadline, .copier-answers.yml, the devcontainer's compose file and its variables, forwardPorts, the cargo wrapper, or the pipeline's test results.
name: nyxsis
---

<!-- cspell:words Nyxsis nyxsis junit -->

# What this repository carries for Nyxsis

## Overview

Nyxsis manages the fleet's projects and their workspaces: it builds and starts
a workspace's devcontainer, runs its commands, reclaims its build output,
forwards its ports, reads its issues, mirrors and test results, and keeps it
on the template it was rendered from. Everything it learns about this
repository it reads from the files below, so configuring the repository for
Nyxsis means editing them. This skill states each file's shape, its default
where the repository declares nothing, and what Nyxsis does with it.

Read it before adding or changing any of them, and before changing anything
they name: a `make` target the clean command runs, the devcontainer's compose
file, or the pipeline's test steps.

## The one rule

Every change leaves the repository building and running with no Nyxsis
component present. A developer who has never run Nyxsis clones it, opens the
devcontainer and runs every gate as before. Nothing below may become something
the repository needs Nyxsis to build or run.

## The `.nyxsis/` folder

`.nyxsis/` at the repository's root is the one place for what only Nyxsis
reads. What it holds are facts about the repository itself, true whoever works
on it: the command that removes its build output, the commands it is worked
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
when the build begins, and each report of the workspace reads its commands and
its issues afresh. A file that cannot be read as TOML is malformed for every
key; a malformed value of one key is reported with the reason and leaves the
other keys read.

```toml
clean = ["make", "clean"]
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

[issues]
format = "files"
root = "tasks"
```

### `clean`

A list of words, at least one and none empty, run as one command with no shell
inside the workspace's running devcontainer to reclaim its build output. The
render declares `clean = ["make", "clean"]`, so the `clean` target of the
`Makefile` is what is reclaimed: extend that target when the project grows
build output of its own, rather than naming paths here. Without `clean`, or
with it malformed, the workspace is reported as having no build output to
reclaim, a malformed one with the reason.

### `build_timeout_seconds`

A positive whole number of seconds bounding the devcontainer's build and start
together, on a workspace's creation and on every rebuild. Where none is
declared, or the value is malformed, the bound is 7200 seconds, and a malformed
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

### `[issues]`

The issues the project keeps. Without the table Nyxsis reads no issues.

- `format`: the issues format the root is read by. `"files"` is the one format.
- `root`: the issues root, a folder relative to the checkout's root, `tasks`
  where the table states none.

Under the `files` format each Markdown file below the root other than a
`README.md` is one issue. A file under a `done/` folder is done, one under a
`blocked/` folder is blocked, and any other is open. The folders between the
root and the file, `done/` and `blocked/` left out, are the issue's area. Its
key is its path relative to the root with every `done/` and `blocked/` segment
removed and `.md` dropped, so moving an issue between states keeps its key,
and its title is the text of its first heading, or the file's stem where it
has none. The board is read from the checkout as it stands, so a workspace
states the issues of its branch, and a project's issues roll up from the
boards of all of its workspaces. A malformed table is reported with the reason
and the file's other keys are read.

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
  | `DEVCONTAINER_UID` | The user id of the account the container user is created with |
  | `DEVCONTAINER_GID` | That account's group id |
  | `DEVCONTAINER_USERNS` | The user namespace mapping the container runs under, `host` by default, `keep-id:uid=<uid>,gid=<gid>` under rootless Podman |
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
  `~/.local/bin/cargo`, which `.devcontainer/languages/rust/permit-wrapper.sh`
  installs ahead of the toolchain's own. It runs `build`, `check`, `clippy`,
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
