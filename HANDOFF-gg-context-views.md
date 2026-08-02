# HANDOFF — gg context views (responses-as-code)

**Status:** specification, pinned. Every implementing agent reads this file first and
implements exactly the names, signatures and caps below. Where this file and an
agent's judgement disagree, this file wins; if this file is *wrong*, say so in the
commit body rather than silently diverging.

## The problem

Under tool calling, everything that enters an agent's context window arrives as a
discrete, attributable message: one tool result per tool call, carrying the source
band it is charged to and — for a `read_file` — the workspace path as its selector
tag. gg can therefore say *which file* cost *how many tokens*, evict one file view
by path, persist the set of open views across a succession, and re-seed named files
after a compaction.

Under [responses as code](apps/docs/src/content/docs/gg/responses-as-code.md) none of
that holds. A whole program's output collapses into **one** ephemeral `user` message
tagged `GgContextSource::ToolOutput` (`crates/gg/src/agent.rs:6903`), containing the
call roster, the refusals, the error — and every line the program logged. A program
that does

    console.log(fs.readTextFile("specs/rules.md"));
    console.log(JSON.stringify(summary));

has just put a file and a computed summary into the window as one anonymous blob.
It is charged to `tool_output`, carries no label, cannot be evicted by path, is
invisible to per-file attribution, is not persisted, and is not re-seeded after a
compaction. `crates/gg/src/persistence.rs:36-38` records the consequence in as many
words: a persistent code-mode profile records and restores nothing.

## The change, in one sentence

`console.log` stops being a channel into the prompt; a program instead **registers
views**, and gg emits **one message per view** into the next prompt — the exact
counterpart of one tool result per tool call.

---

## 1. The view model

A view is a piece of material an agent has declared should be **visible** to it. Each
agent owns a set of open views. A view has a **kind**, a **selector** (its key), and a
body.

### 1.1 The two kinds

| Kind | Selector (key) | Band (`GgContextSource`) | Body |
| --- | --- | --- | --- |
| **file** | `(path, region)` | `FileView` (existing) | what the read returned, plus any image |
| **text** | `label` | `TextView` (**new**) | the string the program supplied |

Two kinds is the whole taxonomy, and it is closed on purpose. Everything on disk is a
file; everything a program can compute is a string. A directory listing, a `shell`
result, a subagent's answer, a computed diff, a table the program assembled — every
one of them is a **text view**. Adding a third kind for any of those would give the
model a taxonomy question to answer before it could show gg anything, in exchange for
a distinction nothing downstream reads.

**Images are not a third kind.** An image is a *file view of an image file*: the view
item carries the picture, exactly as the native `read_file` path already does
(`context.rs:959` `push_file_view_with_retention` takes `images`). This replaces the
current arrangement where a program's `readFile` of a mockup rides out on the turn's
feedback with a budget of four. See §5.4.

### 1.2 The file-view key is `(path, region)`, not `path`

Two pages of one file are two views and must coexist — `view.openFile("a.ts", {offset:
1, limit: 200})` and `view.openFile("a.ts", {offset: 201, limit: 200})` are a program
paging through a file, not a program changing its mind. Re-opening the **same** page
supersedes it (§1.3). `view.close("a.ts")` and the existing `evict_file_view { path }`
both operate on the **path**, closing every page of it — that is the established
semantics of `ContextModel::evict_file_views` and it does not change.

`region` is `None` for a whole-file read, which is what `FileRegion::covered`
(`context.rs:186`) already returns, so a whole-file view and a paged view of the same
file are distinct keys and the whole-file one supersedes itself on re-read.

### 1.3 Re-opening a selector supersedes it

This is the "handle any that were modified" half of the requirement, and it is a
**deliberate divergence** from the native path, which appends a fresh view per read
("A `read_file` result is a snapshot of the file *as it was read*, and nothing later
rewrites it. Each read appends its own view." —
[context-visibility.md](apps/docs/src/content/docs/gg/context-visibility.md)). That
rule is right for `read_file`, which names an **action**. `view.openFile` names an
**intent** — *this file should be visible* — and re-stating an intent replaces it. A
program that loops over changed files and re-opens each one must not pile up a
duplicate per turn, or the precise accounting this whole feature exists to deliver is
worse than what it replaced.

The native tool-calling `read_file` path is **not changed**. Only the view API
supersedes.

Superseding obeys the window's append-only rule
([context-visibility.md](apps/docs/src/content/docs/gg/context-visibility.md), "The
window renders as an append-only prompt"), with one refinement this feature needs:

- **The existing item was pushed in an earlier turn** (it has been sent to the model,
  and a provider has cached the prefix): leave it in place, retag it to
  `GgContextSource::History` + `Retention::Ephemeral` and clear its label — exactly
  what `ContextModel::supersede_source` (`context.rs:744`) already does for mutable
  blocks — and append the new copy at the tail.
- **The existing item was pushed in the current turn** (`ContextItem::turn ==
  self.turn`, i.e. this same program opened it a moment ago and nothing has been sent):
  **replace it in place**. There is no cached prefix to protect and no history worth
  recording; a program that opens a view in a loop and refines it must not leave a
  corpse per iteration.

A view opened and then closed within one program reaches the window not at all.

### 1.4 Views mutate the live window immediately

`LoopToolApi` owns the `ContextModel` by value for the duration of the program
(`agent.code.rs:846`), so a view call mutates it there and then. There is no staging
buffer to reconcile at turn end. This is what makes a mid-program `view.close(...)`
of a view opened earlier in the *same* program behave the way a model would expect,
and it keeps the ordering right: the assistant message carrying the program, then the
view messages, then the turn report.

---

## 2. The model-facing API

A new API object, **`view`**, following the repo's namespaced-object convention
(`OBJECT_FOR_MODULE` in `packages/gg-sandbox/src/catalogue.ts`).

```ts
view.openFile(path: string, options?: { offset?: number; limit?: number }): FileRead
view.openText(label: string, body: string): void
view.close(selector: string): number
view.current(): OpenView[]
```

```ts
type OpenView = {
  kind: "file" | "text";
  selector: string;
  tokens: number;
  region?: { offset: number; limit: number };  // paged file views only
};
```

- **`openFile`** reads the file *and* opens a view of it. It returns the same
  `FileRead` variant `fs.readFile` returns, so a program that wants both the bytes and
  the view pays for one read, not two.
- **`openText`** opens or replaces the text view keyed by `label`.
- **`close`** closes every view whose selector matches — for a file that is every page
  of the path — and returns how many it closed. Closing a selector that is not open is
  `0`, not a failure.
- **`current`** lists what is open. It is named `current` and not `list` because every
  API object already carries a `list()` that lists the object's *functions*
  (`packages/gg-sandbox/src/shim.ts:371`).

### 2.1 Gating

The `view` object is **always bound**, whatever the capability set says — the same
carve-out `harness` already has, and for the same reason: a run that enables no tools
at all must still be able to show its model something. `openText`, `close` and
`current` are therefore ungated.

`view.openFile` is bound **only when the `read_file` tool is** — it is a read, and a
run with reading withheld must not get one through a side door. This mirrors the
existing helper-catalogue pattern (`readTextFile` declares `requires: "read_file"`).

### 2.2 `fs.readFile` is unchanged and still does not open a view

The separation is the point, and the prompt must teach it in one line: **`fs.readFile`
gets bytes for your program; `view.openFile` shows a file to you.** A program that
reads forty files to grep them still puts nothing in the window.

---

## 3. `console.log`

`console.*` **keeps working, keeps being captured, and no longer reaches the prompt.**

- The guest shim, the `feedback.log` membrane function, and the host-side caps in
  `crates/gg/src/sandbox/membrane/capture.rs` are all **unchanged**. Logs still cross
  the membrane and still accumulate in `SandboxOutcome::logs`.
- Logs still reach [telemetry](apps/docs/src/content/docs/gg/telemetry.md), the
  operator's stream, the replay record and the console UI. Nothing an operator or an
  analysis could previously see is lost.
- `logs` and `logsSuppressed` are **removed from the turn feedback** — from
  `CodeResultContext` (`crates/gg/src/prompts.rs:740`) and from
  `crates/gg/templates/code-result.hbs`.
- `program_report()` (`agent.code.rs:422`) still quotes the last log line. That string
  is the operator's one-line stream summary, not model-facing, and it stays.

In its place the feedback carries a **counted nudge**, rendered only when the program
logged at all:

> Your program logged 12 line(s). Logs are not shown to you — they go to the run's
> operator. To put something in front of yourself, open a view:
> `view.openText(label, body)` for a value you computed, `view.openFile(path)` for a
> file.

This is the same disclosed-rather-than-silent discipline the rest of the sandbox
follows: a model whose output vanished must be told, once, in the turn where it
happened, or it will read the silence as evidence its program never ran.

**No configuration toggle.** This is not two settings of one mechanism — the two
arrangements disagree about what a context message *is*, and a param that forked the
context model would fork the accounting, the attribution, the persistence and the
compaction behaviour with it. One contract.

---

## 4. Caps

Over a cap is a **catchable `ToolError` with code `limit-exceeded`, naming the cap** —
never a silent truncation. A refused view is reported in the turn's feedback, so the
model can split, trim, or write the material to a file and open a file view of it
instead. Truncating the model's only output channel behind its back is the failure
mode this whole feature exists to remove.

| Cap | Value | Applies to |
| --- | --- | --- |
| `MAX_TEXT_VIEW_BYTES` | 65,536 (64 KiB) | one `openText` body |
| `MAX_VIEW_LABEL_BYTES` | 200 | one `openText` label |
| `MAX_OPEN_TEXT_VIEWS` | 50 | text views open at once, per agent |
| `MAX_VIEW_OPS_PER_PROGRAM` | 100 | `openFile` + `openText` + `close` calls in one program |

An empty label is `invalid-argument` (a view with no selector cannot be closed,
superseded or attributed). An empty body is **allowed** — it is how a program states
that something it was showing is now empty, and refusing it would make that
unexpressible.

The existing `IMAGE_BUDGET = 4` (`capture.rs:77`) continues to bound pictures per
turn, now counted against image-bearing **file views** rather than against bridged
reads.

---

## 5. Implementation

### 5.1 Contract — `crates/core/src/gg.rs`

- Add `GgContextSource::TextView` **after** `FileView` (the order fixes the graph's
  band order and its palette index). Doc it as agent-composed material a program put
  in its own window, distinct from `FileView` (workspace material) and `ToolOutput`
  (gg's own reporting).
- Bump `pub const ALL: [GgContextSource; 10]` → `; 11` (`gg.rs:2395`) and add the
  variant in position. Three doc comments in this file also state the count "ten" in
  prose — fix them.
- `GgContextAction` (`gg.rs:2885`): add `CloseTextViews`. Keep `EvictFileViews` as is;
  a `view.close` of a path routes to `EvictFileViews`, of a label to `CloseTextViews`.
- Regenerate: `npm run gen:contract`. This rewrites `packages/run-record/src/gg.ts`
  (the variant appears **twice** — in `GgTelemetryKind` and again in the inlined union
  inside `GgTelemetryEvent`) and the JSON Schemas under `apps/docs/public/schema/`.
  `packages/run-record/` is `@generated` — never hand-edit it.
- No new telemetry event. A view is a context item, so it already flows through the
  `context_message` pool (which carries `label`) and `context_breakdown` (which carries
  the band). That is exactly the data the graph and the attribution need.
- No replay-contract change. `GgReplayPromptItem` already carries `source`, `label` and
  `region`; a text view is `source: "text_view"`, `label: <selector>`, `region: null`.

### 5.2 The context model — `crates/gg/src/context.rs`

New public surface:

```rust
pub fn open_text_view(&mut self, label: String, body: String) -> ViewOpened;
pub fn open_file_view_deduped(
    &mut self, path: String, region: Option<FileRegion>,
    content: String, images: Vec<ImageContent>,
) -> ViewOpened;
pub fn close_text_views(&mut self, label: Option<&str>) -> EvictionResult;
pub fn open_text_views(&self) -> Vec<OpenTextView>;   // for persistence
pub fn open_views(&self) -> Vec<OpenViewInfo>;        // backs `view.current()`
```

- Both openers go through one private `supersede_view(source, selector, region)` that
  implements §1.3: find items with the same `(source, label, region)`; if the newest
  match has `turn == self.turn`, remove it outright; otherwise retag it to
  `History`/`Ephemeral` and clear its label. Then push the new item.
- `ViewOpened { superseded: bool, replaced_in_turn: bool, tokens: usize }` so the turn
  report can say what happened.
- `close_text_views` mirrors `evict_file_views` (`context.rs:1373`) exactly, including
  **sparing `Retention::Pinned` items**.
- `code_heading` (`context.rs:1467`): `TextView => Some("View")`. The body a text view
  renders is `View: {label}\n----\n{body}` so the model can tell its views apart; the
  file heading stays `File`.
- Envelope: a view is pushed as `Message::user(body)` via `push_labeled`, **not** as
  `Message::tool_result`. A code turn's assistant message carries no `tool_calls`, so a
  `tool`-role message would quote a dangling id and an OpenAI-shaped provider would
  reject the whole request — this is already documented at `agent.code.rs:944-956` and
  is why compaction's re-seed (`compaction.rs:951`) uses `push_labeled` too.
- Retention is `Ephemeral` for both kinds.

Tests in `context.test.rs` (or a new `context.views.test.rs` if that file is getting
long — the repo's `.test.rs` policy is in `.claude/skills/coding/SKILL.md`).

### 5.3 WIT + host — `crates/gg/wit/gg-sandbox.wit`, `crates/gg/src/sandbox/`

A **new `views` interface**, imported into `world sandbox`. It is a carve-out like
`session` and `docs`: its functions are **not** gg tool names and must **not** be added
to `ALL_TOOL_NAMES`. The WIT header states the rule — every function on a *tool*
interface maps one-to-one to a tool name, and `boundTools()` is checked against
`ALL_TOOL_NAMES` by `crates/gg/src/sandbox.test.rs`. Putting these on `files` or
`context` would break that bijection; making them real tools would hand a native
tool-calling session an `open_file_view` that duplicates `read_file`.

```wit
interface views {
  use types.{tool-error};
  use files.{file-read};

  open-file-view: func(path: string, offset: option<u32>, limit: option<u32>)
      -> result<file-read, tool-error>;
  open-text-view: func(label: string, body: string) -> result<_, tool-error>;
  close-view: func(selector: string) -> result<u32, tool-error>;
  current-views: func() -> list<open-view>;

  record open-view { kind: view-kind, selector: string, tokens: u64,
                     region: option<view-region> }
  enum view-kind { file, text }
  record view-region { offset: u32, limit: u32 }
}
```

- `crates/gg/src/sandbox/membrane/views.rs` (new; `mod views;` in `membrane.rs:63`).
  `open_file_view` routes through `MembraneState::dispatch` against the **`read_file`**
  tool name, so it keeps the deadline guard, the enabled-set backstop, the roster
  entry, telemetry and replay capture. `open_text_view` / `close_view` /
  `current_views` bypass `dispatch` (its enabled-set guard is wrong for a non-tool) and
  are **never refused for a spent wall-clock budget** — the same carve-out `finish` has,
  and for the same reason: they perform no work and a turn that cannot report is worse
  than one that reports late.
- `ToolApi` (`sandbox/invoker.rs:88`): four new typed methods. `FakeToolApi`
  (`sandbox/fake.test.rs`) must implement them or nothing compiles.
- `LoopToolApi` (`agent.code.rs:1381`): `open_file_view` via `self.serviced(READ_FILE_TOOL,
  …)` followed by the `context.open_file_view_deduped` push — the one place the code
  path deliberately *does* now push a `FileView`, reversing the comment at
  `agent.code.rs:818-822`, which must be rewritten rather than left contradicting the
  code. The other three touch `self.context` directly.
- Cap enforcement (§4) lives in `LoopToolApi`, which is where the `ContextModel` is,
  and returns `ToolError`s the membrane lowers.
- Track per-program view activity on `MembraneState` for the turn report: opens,
  supersedes, closes, refusals.

### 5.4 Guest SDK — `packages/gg-sandbox/`

`src/membrane.d.ts` (declare `test-cabinet:gg/views`), `src/types.ts` (`OpenView`,
`ViewKind`), `src/tools/views.ts` (the four wrappers, each with a **mandatory
model-facing JSDoc** — `tools/signatures.mjs:222` errors without one), `src/catalogue.ts`
(a `VIEW_ENTRIES` array parallel to `SESSION_ENTRIES`, plus `view` in
`OBJECT_FOR_MODULE`), `src/shim.ts` (`MODULES` registration and the always-bound
`view` object in `buildScope`, with `openFile` gated on `read_file`).

`tools/signatures.mjs` needs a `views` branch beside its `session` branch, and
`crates/gg/src/sandbox/signatures.rs` a matching struct plus a `gate` projection in
`catalogue_functions()` (`gate: Some("read_file")` for `openFile`, `None` for the other
three).

Then **rebuild and commit both artifacts**: `packages/gg-sandbox/build.sh`, producing
`crates/gg/src/sandbox/gg-sandbox.component.wasm` and
`crates/gg/src/sandbox/signatures.json`. `componentize-js@0.21.0` is reachable via
`npx` in this environment (verified). Note the rebuild is **not** byte-reproducible —
the component snapshots its own build instant — so a `.wasm` diff proves nothing on its
own; the gates that do prove something are `sandbox.test.rs`'s instantiation and
`bound-tools` tests.

**`bound-tools` must not change.** These are not tools; if the bijection test starts
failing, the functions were put on a tool interface by mistake.

### 5.5 Turn feedback + prompt

- `CodeResultContext` (`prompts.rs:740`): drop `logs` / `logsSuppressed`; add
  `logged_lines: u64` (drives the §3 nudge) and a `views` section —
  `views_opened: Vec<CodeViewView { kind, selector, tokens, superseded }>`,
  `views_closed: Vec<String>`, `view_refusals: Vec<String>`.
- `code-result.hbs`: remove the `Output:` block; add the views block and the nudge.
  A program that opened no views and logged nothing keeps saying `No output recorded.`
- `system-code.hbs` + the `OBJECTS` table at `agent.rs:8564`: add the `view` row
  (`"view"`, `"show yourself a file or a value — the only way material enters your
  context"`). The prompt's worked example must open a view rather than `console.log` a
  value, and must state the `fs.readFile` vs `view.openFile` split from §2.2.
  The gated-example machinery in `agent.rs` picks the example from the bound toolset —
  keep that property; `view.openText` is always bound, so the tool-free example can use it.
- `code_headings` in the prompt (the list built from `code_heading`) picks up `View`
  automatically — verify it does rather than assuming.

### 5.6 Persistence, compaction, replay

- **Persistence** (`crates/gg/src/persistence.rs`): code-mode agents now push file
  views, so `open_file_views()` starts returning them and RaC persistence begins
  working with no change — **verify this and say so**, and delete the note at
  `persistence.rs:36-38` that says a code-mode profile records nothing.
  Text views are persisted **with their bodies**. The module's "record the reference,
  never the bytes" principle exists because a file's on-disk truth can move under a
  stored snapshot; a text view has no on-disk truth to go stale against, so the
  principle does not transfer. Document that reasoning where the principle is stated.
- **Compaction**: `clear_ephemeral` drops text views like every other ephemeral item,
  and `compact`'s `files` argument re-seeds files only. Text views therefore **do not
  survive a compaction** — document it in `compaction.md` and say what to do instead
  (write it to a memory or a file). Do **not** extend the `compact` request to name
  views; that is a separate feature.
- **Replay**: no contract change (§5.1). Confirm a text view round-trips through
  `record_prompt_frame` (`replay.rs:1044`) and the playback UI.

### 5.7 UI — `packages/ui/src/app/pages/runs/gg/`

`apps/web`, `apps/desktop` and `apps/site` contain **no** gg context code; they mount
the shared app from `@test-cabinet/ui`.

1. `ContextFillGraph.tsx` — four parallel tables: `CONTEXT_SOURCES:46` (insert
   `text_view` after `file_view`), `CONTEXT_SOURCE_LABELS:60` (`"Agent views"`),
   `CONTEXT_SOURCE_COLORS:79` (a new hue distinct from `file_view`'s `#4cc9c0`), and
   `SOURCE_CAPABILITIES:97` (**no** entry — text views are ungated).
2. `GgPanels.module.scss:62` — `$context-palette` is keyed by **numeric index**, so
   inserting a band at position 5 shifts every later index. Re-key the whole map and
   match `CONTEXT_SOURCE_COLORS`; this is the one table that fails silently.
3. `ggContextAttribution.ts` — `SOURCE_LABELS:110`, and generalize the
   `ref.source === "file_view"` branch at `:329`. The `byFile` grain becomes **`byView`**,
   keyed by selector and carrying `kind: "file" | "text"`; `unattributedFileTokens`
   becomes `unattributedViewTokens`. Update `mergeGgAttributions:405`.
4. `GgAgentsSummary.tsx` — `AttributionView:80` and `ATTRIBUTION_VIEWS:82` rename
   `"files"`/`"Files"` → `"views"`/`"Views"`; the `ContextBreakdown` switch at `:967`
   and the footnote at `:992` follow.
5. `useGgRunState.ts:764` — `contextActionLabel` is an exhaustive switch with no
   `default`, so the new `GgContextAction` arm is a compile error until added. **This
   file contains a raw NUL byte: search it with `rg -a` or matches read as zero.**
6. `RequestsView.tsx:41` — `band()` does an unguarded record lookup, so an unrecognised
   source renders blank. Add the `?? source` fallback `GgModuleViews.tsx:692` already
   has. This is a latent defect, worth fixing here.
7. `GgReplayView.tsx` / `replayModel.ts:829-846` — `fileViewLabel` is file-specific by
   name and appends an `offset+limit` window that is meaningless for a text view.
   Rename to `viewLabel` and append the region only when there is one.
8. `ContextFillGraph.test.tsx:23,127` — the `SOURCE_ORDER` fixture and the
   length-equality assertion.

### 5.8 Docs

The documentation site is the source of truth and these pages will otherwise state the
opposite of the shipped behaviour:

- `gg/responses-as-code.md` — the `console.*` bullet (L45-47) and "What a code turn
  costs the context window" (L522-547) both currently document the behaviour this
  change removes, including "a program's `readFile` does **not** push a file view" and
  the picture carve-out. Rewrite both; add a views section; keep the page's habit of
  recording *why* a reversal happened, as its own "A reversal" section does.
- `gg/context-visibility.md` — the new band; the view model and its supersede rule
  (§1.3) beside the existing append-per-read rule for `read_file`, with the distinction
  spelled out.
- `gg/compaction.md` — text views do not survive a compaction (§5.6).
- `gg/agent-managed-context.md` — `view.close` beside `evict_file_view`.
- `gg/prompts.md` — the `view` object.
- `packages/gg-sandbox/README.md` — the new interface and the wrapper count.

---

## 6. Gates

Every one of these must pass before the final commit, and the report must say which
were run and what they said:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets
cargo nextest run --workspace
./scripts/ci/contract-drift.sh
npm run typecheck && npm run lint && npm run test && npm run build
```

The owner validates by **exercising the feature**, not by reading the diff, so the
final report must say how to drive it: the config to enable, the program to write, and
the screen that shows the new band.

## 7. Out of scope

Naming these so no agent quietly adds them: a configuration toggle for the old
`console.log` behaviour (§3); a third view kind (§1.1); extending the `compact` request
to name views (§5.6); changing the native tool-calling `read_file` view semantics
(§1.3); a new telemetry event for a view being opened (§5.1).
