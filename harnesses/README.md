# Harnesses

Each agent harness The Test Cabinet drives is defined here, one directory per
harness, named with the harness's stable slug — the same slug used by the agent
harness layer in `crates/core`, by run records, and by the site.

```
harnesses/
├── claude/harness.toml       # one manifest per harness
├── codex/harness.toml
├── cline/harness.toml
├── antigravity/harness.toml
├── goose/harness.toml
├── kilo/harness.toml
├── opencode/harness.toml
└── pi/harness.toml
```

A harness is **not** baked into a container image. Every run executes in the
shared [base image](../containers/README.md) and the harness's CLI is installed
into that container **at run time**, just before the harness session, by running
the manifest's `install` command. Installing at run time means a run always gets
the harness's most recently published version, rather than whatever was current
when an image was last built. This mirrors how a test case prepares its workspace
with an [init command](../apps/docs/src/content/docs/components/core/execution.md#init).

## Manifest

Each `harness.toml` declares:

| Field | Meaning |
| --- | --- |
| `slug` | Stable slug; must match the directory name and a slug the agent harness layer knows. |
| `name` | Human-readable name, shown by `tcab harnesses`. |
| `binary` | The CLI binary a run probes (`<binary> --version`) and invokes. The installer must put it on the run user's `PATH`. |
| `install` | Shell command run inside the run container, before the session, to install the CLI. |

The `install` command runs through `sh -c` as the container's unprivileged run
user, with the same environment the session uses — the base image's `PATH`
already carries the user-level npm prefix (`~/.npm-global/bin`) and
`~/.local/bin`, so both `npm install -g` and curl-piped installers work without
root. It is bounded by the run's maximum runtime, the same cap that bounds the
harness session, so a hung install can never run unbounded. A non-zero exit or a
timeout aborts the run before a harness session is spent.

Supporting files (for example an install script too involved for a one-line
command) live alongside the manifest in the harness's directory.

## What stays in code

A manifest is the **declarative** half of a harness: its identity and how to
install it. The **imperative** half — how the CLI is invoked non-interactively,
how its token usage is parsed, and how its raw output is translated into
normalized events — lives in the adapter for that slug in
`crates/core/src/harness_registry.rs`, because it is logic rather than
configuration. Adding a brand-new harness therefore means both a manifest here
and an adapter (plus a `HarnessSlug` variant) there. See
[Agent Harnesses](../apps/docs/src/content/docs/components/core/harnesses.md).
