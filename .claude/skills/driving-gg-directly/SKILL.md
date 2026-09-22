---
name: driving-gg-directly
description: Read this skill before running gg outside The Test Cabinet — "try model X on this issue with gg", "drive gg from this session", "run gg against a tasks/ file". gg is normally launched by core inside a run container; this is the recipe for launching the bare binary from a dev box with a hand-written invocation, in responses-as-code or tool-calling mode, and reading its telemetry. Verified in the devcontainer on 2026-09-22.
---

# Driving gg directly

gg is a standalone binary: `gg --config <invocation.json>`, one credential in
the environment, NDJSON telemetry on stdout. Nothing in the run path needs
`core`, a run container, or a test case. The `prompt` field is simply the first
user message, so an issue file from `tasks/` works as the whole brief.

Authoritative references: the invocation contract is `GgInvocation` in
`crates/core/src/gg.rs`; the configuration surface is
`apps/docs/src/content/docs/gg/configurations.md`; the launch refusal rules are
the header of `crates/gg/src/validate.rs`. This skill is the shortest path
through them, not a replacement.

## The recipe

1. **Build.** `cargo build -p test-cabinet-gg` (about a minute when the arm
   artifacts are cached; the first build on a fresh machine reflects eleven
   toolchains and takes much longer). The binary lands at
   `$CARGO_TARGET_DIR/debug/gg`, which in the devcontainer is
   `/cargo-target/the-test-cabinet/debug/gg`, **not** `target/`.
2. **Check the sandbox arms.** `PATH="$HOME/.local/bin:$PATH" gg selfcheck`
   drives every language's bootstrap turn with no model. On 2026-09-22 ten arms
   passed here; `rust` failed for want of the `wasm32-wasip1` target. Use
   `typescript`, `javascript` or `python` unless you have fixed that.
3. **Isolate a workspace.** gg writes `.gg/replay.ndjson` and `.gg/hooks/`, and
   reads `.gg/skills/`, under `workspaceDir`. `.gg` is not gitignored, and the
   file tools are deliberately not confined to the workspace. Always run in a
   worktree: `git worktree add /workspaces/gg-wt-<model> -b gg/<model>`. One
   worktree per model also makes the comparison a `git diff` between branches.
4. **Resolve model windows.** gg keeps no model table and refuses to launch
   without a `modelWindows` entry for every bound model. Run
   `scripts/model-windows.sh <id>...` to print the `modelWindows` and
   `modelModalities` objects from OpenRouter's public models endpoint.
5. **Write the invocation** from a template in `templates/`. Fill `sessionId`,
   `workspaceDir`, `prompt`, `modelId`, and paste the two objects from step 4.
6. **Launch.**

   ```sh
   set -a; source .env; set +a          # OPENROUTER_API_KEY lives in the repo .env
   export PATH="$HOME/.local/bin:$PATH" # purs, node, esbuild for the sandbox arms
   /cargo-target/the-test-cabinet/debug/gg --config inv.json > run.ndjson
   ```

   Exit `0` is a session that ended by its own `finish` call, `3` is a run
   stopped by one of the configured ceilings, `1` is a harness or operator error
   (a refused configuration prints every offending value on the telemetry
   stream, so fix them all in one pass).

### Validate a configuration for free first

gg's launch validation runs before the first model call, so any edit to a
template can be checked without a key or a spend: set `modelId` to `mock/test`
(any `mock/…` id selects the offline scripted client), give it any window, point
`workspaceDir` at a scratch directory, and launch. A refused configuration
prints every offending value; an accepted one runs the mock's canned turns. In
tool-calling mode the mock runs to a clean exit `0`. In responses-as-code mode
it exits `3` after five `missing_completion_no_program` turns, because the mock
answers with tool calls rather than programs: that is the mock's limitation,
and the launch having been accepted is the result you were after.

## The issue study

The setup used to trial a model on an open `tasks/` issue. One run per model
per issue, in a worktree, on a branch named for the model.

### The configuration

`templates/invocation.study.json` is the profile, and
`scripts/issue-invocation.sh <model> <language|tools> <tasks-file> <worktree>`
fills it: it resolves the model window, pastes the issue in as the prompt with
the standard one-line preface (implement, run the gates, commit with a
Conventional Commits message, call `finish`), names the session
`gg-<issue>-<model>-<mode>`, and moves the responses-as-code block in or out.
What the profile grants:

- The standard filesystem, shell and tasks capabilities, as in the two minimal
  templates.
- `subagents` at `maxDepth` 3 with the root profile listed in its own roster, so
  the agent can spawn copies of itself, and `maxParallel` 8.
- `compaction` on `self-summarization` at a `summaryHeadroom` of `0.2`.
- `context-window-override` at a `windowLimit` of 400,000 tokens, so a
  million-token model is measured against 400k and reaches a compaction boundary
  at roughly 256k.
- `maxCost` 25 USD. The OpenRouter key in `.env` has a 50 USD daily ceiling, so
  two sessions fit in a day and a third needs the ceiling raised.

Both arms have been launched against `mock/test` from this template: the tools
arm runs to exit `0` and the responses-as-code arm to the expected exit `3`.

### The language ladder

Run responses as code first, PureScript, then TypeScript, then JavaScript, then
tool calling. Large models have tended to do better under PureScript and small
ones markedly worse, so the order is a capability probe as much as a preference.

1. Generate the invocation for the top rung and launch in the background with
   stdout to a file.
2. Watch the first two to four turns. The model is driving the rung when its
   `turn_outcome` events are `completed` and `shell`, `tool_call` or file
   events follow: it is producing programs the sandbox accepts. It is not when
   the turns are `response_rejected`, compile errors, or
   `missing_completion_no_program` back to back.
3. To move down a rung, kill the process, reset the worktree
   (`git -C <wt> checkout -- . && git clean -fdx -e .gg && rm -rf <wt>/.gg`),
   regenerate the invocation and relaunch. Keep each abandoned `run.ndjson`;
   the failed rungs are part of the assessment.
4. Otherwise let it run to `session_ended`.

### After the run

- Exit `0` with the work committed: dispatch an Opus 5 review agent on the
  worktree. It reviews the diff against the issue's done-when list, runs the
  gates, fixes what it finds, and commits the fixes as their own commit so the
  model's work and the corrections stay separable.
- Exit `3` on the `cost` limit, or any exit with uncommitted work: commit what
  the model left under a message that says so, then have the Opus 5 agent finish
  the remaining items and commit those separately.
- Write up the model: which rung it ran on and why the rungs above failed, the
  `session_summary` figures (turns, cost, compactions, subagents), how much of
  the done-when list it reached on its own, and what the reviewer had to fix.

## Reading the telemetry

Every line is one event with a `type` tag (snake_case) and the run's
`sessionId`. There is no CLI reader; use `jq`.

```sh
jq -r 'select(.type=="assistant_message") | .content' run.ndjson   # the model's prose
jq -r 'select(.type=="shell") | .command' run.ndjson               # every command it ran
jq -r 'select(.type=="tool_call") | .name' run.ndjson | sort | uniq -c
jq -c 'select(.type=="usage") | .tokens' run.ndjson                # per-turn token deltas
jq -c 'select(.type=="session_summary") | .summary' run.ndjson     # totals, once, at the end
jq -r 'select(.type=="response_rejected")' run.ndjson              # a reply gg refused to run
```

For a live watch: `tail -f run.ndjson | jq -r 'select(.type=="shell") | .command'`.
The `.gg/replay.ndjson` journal in the workspace is the durable session record
and survives a hung run.

## What the templates configure

Both templates are the `GgCapabilitySet::minimal` shape written out in full,
because gg substitutes nothing: an enabled capability must carry its arm and
every required param, and a missing one refuses the launch.

- `templates/invocation.rac.json` — responses-as-code, TypeScript. The model
  answers each turn with one program; `operations` is the grant, `tools` is
  inert. Change `language` to `python` or `javascript` freely; every arm shares
  the same surface.
- `templates/invocation.tools.json` — tool calling. `tools` is the grant,
  `operations` is inert, and no `responses-as-code` entry is present.

Switching a profile between the two is exactly that difference, so an A/B is a
copy with one block moved.

Both templates leave `skills` and `memories` out (they are on in the console's
default profile). Add them from the authoring catalog in
`crates/core/src/gg.rs` (`build_authoring_catalog`) if a study wants them.

### Ceilings worth keeping

`maxParallel` and `replayMaxBytes` are required. The rest are unarmed unless
written. For an unfamiliar model keep `maxCost` (USD, run-wide), `maxTurns`,
`maxRuntimeSecs` and `maxConsecutiveErrors`; the templates set all four.

### Things gg does not do

- No reasoning or effort parameter is sent. A model runs at its provider default.
- The only provider is OpenRouter. A model not listed there cannot be run.
- The shell runs as your user with no sandbox. The templates arm the built-in
  `guard-destructive-shell` hook on `pre-shell`; add an `agent-stop` command
  hook (`cargo test`, `npm run build`) when the issue has a gate worth holding
  the model to. Shapes are in `apps/docs/src/content/docs/gg/hooks.md`.

## Prompting an issue

Paste the `tasks/` file verbatim into `prompt`, preceded by one line saying the
workspace is the repository the issue describes and that the session ends by
calling `finish` once the change is complete and the gates named in the issue
pass. Anything you would put in a system prompt goes in the profile's
`customInstructions`; follow the `agent-prompts` skill for that text.

## Models resolved on 2026-09-22

All eight support tools and reasoning on OpenRouter. Re-run
`scripts/model-windows.sh` before a launch; catalog figures move.

| Model id                       | Window    | Input modalities          |
| ------------------------------ | --------- | ------------------------- |
| `xiaomi/mimo-v2.6-pro`         | 1,048,576 | text, image, video, audio |
| `x-ai/grok-4.7`                | 500,000   | text, image, file         |
| `z-ai/glm-5.3-flash`           | 1,310,720 | text, image, video        |
| `z-ai/glm-5.3`                 | 1,310,720 | text                      |
| `deepseek/deepseek-v4.1-flash` | 1,048,576 | text, image               |
| `qwen/qwen3.8-max-0902`        | 1,000,000 | text, image, video        |
| `tencent/hy4-preview`          | 1,048,576 | text                      |
| `moonshotai/kimi-k3`           | 1,048,576 | text, image, video        |
