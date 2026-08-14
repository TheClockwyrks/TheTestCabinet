# gg: one language-agnostic system prompt + an opening turn that actually runs

Repo: `/workspaces/the-test-cabinet`, crate `crates/gg`. Branch `rel/v0.7.0`.
Authoritative policy for every sentence a model reads:
`.claude/skills/agent-prompts/SKILL.md` (read it in full before touching a template).
Repo code policy: `.claude/skills/coding/SKILL.md`. Docs policy:
`.claude/skills/documentation/SKILL.md`.

This document is the owner's decision. Where it conflicts with a doc comment, a
test, or `gg-docs-plan.md` in the repo root, **this document wins and the other
is updated to match** — several long rationales in the tree argue for the design
being replaced, and those rationales are now wrong, not evidence against the
change.

---

## 0. What changes, in one paragraph

The eleven per-language responses-as-code system prompts become **one**
language-agnostic template that describes capabilities and never describes how to
call anything. Everything a model needs about the *shape* of a program in its own
language survives as **one gated segment of at most three paragraphs**. In place
of the prose that was deleted, gg synthesizes an opening turn that **executes a
real program** in the agent's language — one that searches every module the agent
was granted — so the model's window opens with a valid program it wrote (by
proxy) and view(s) listing every function it can call with a one-line brief each.
A synthesized opening turn is not an agent turn, and a synthesized opening turn
that fails to run is an internal gg error that refuses the run.

---

## 1. The opening turn executes

### 1.1 What it is today (`crates/gg/src/bootstrap.rs`)

`seed_bootstrap` reads two docview bodies **in Rust**, pushes an assistant message
holding `ProgramLanguage::open_docs_views_statement(&names)` as text, and calls
`ContextModel::open_docview` directly. Nothing compiles, nothing runs, and a key
that renders nothing is silently skipped. All three properties are replaced.

### 1.2 What it becomes

`seed_bootstrap` becomes `async fn seed_bootstrap(...) -> Result<usize, String>`
and:

1. Computes **the module list**: every module this agent was granted, i.e. the
   same set `agent::module_views(...)` (`agent.rs:10428`) publishes into the
   prompt. Reuse that computation rather than deriving a second answer; if it
   needs a shared helper, extract one.
2. Computes **the bootstrap docview keys**: unchanged — `BOOTSTRAP_CALLS`
   (`DOCS_SEARCH`, `VIEWS_OPEN_DOCS_VIEW`) resolved by operation through
   `bootstrap_keys`.
3. Generates **one whole program** in the agent's language through a new
   `ProgramLanguage` method (§1.3) that searches each module and opens each
   docview key.
4. **Prepares** it (`sandbox::prepare_program`) through a process-wide cache
   keyed by `(language id, source)` (§1.5), then **runs** it
   (`sandbox::run_prepared_program`) on `tokio::task::spawn_blocking`, with the
   agent's real `ProgramScope` (its granted capabilities, its granted operations,
   no code modules, its `RunEnding`) and the agent's `SandboxLimits`, no deadline.
5. Pushes the **program source** as the assistant message — as today, so the
   model's first example of a well-formed reply is one that provably ran — and
   the views the program opened are the ones its own calls placed.

Order is unchanged: immediately after the build prompt, before hooks, autoload
and persistence restore; skipped on a carried window and outside code mode.

### 1.3 The per-arm source generator

Add to `ProgramLanguage` (`crates/gg/src/sandbox/language.rs`):

```rust
fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String;
```

It returns **a whole program** — a compilable, runnable one — that calls the
arm's spelling of `docs.search` once per entry in `modules` (an exact,
whole-module lookup: empty query, that module as the module filter, an explicit
limit of `MAX_SEARCH_LIMIT`) and the arm's spelling of `views.openDocsView` once
per entry in `docs`. Resolve both spellings from the arm's own catalogue with
`spell(self, DOCS_SEARCH)` / `spell(self, VIEWS_OPEN_DOCS_VIEW)`, exactly as
`open_docs_views_statement` already does; put the syntax in a `pub(super)` free
function beside it so a syntax-sharing arm passes its own resolved names.

`open_docs_views_statement` **stays** — the built-in family skills' on-use scripts
call it (`skills.builtin.rs:418`). Do not concatenate the two: a program is one
module / one `main` / one translation unit on several arms.

Implement for all eleven arms plus the test fixture. The generated program must be
idiomatic for the arm (it is the model's first example of its own output) and must
handle the arm's failure model the way the arm's segment of the prompt says to —
on a `Result` arm it propagates, on a throwing arm it lets the failure escape.

### 1.4 The API the bootstrap program runs against

New `BootstrapApi` in `bootstrap.rs` implementing `ToolApi`
(`crates/gg/src/sandbox/invoker.rs:222`), holding `ContextModel` + `DocsRuntime`
by value and handing them back after the run.

- `search_docs` — real: `DocsRuntime::search`, then place the page as a search
  view under **that module's own selector** (§1.6), and return the page.
- `open_docs_view` — real: mirror `LoopToolApi::open_docs_view`
  (`agent.code.rs:3195`) including `types_to_open` and the agent's `DocViewTypes`.
- `begin_api_call` / `end_api_call` — no-ops. This is not the agent's activity and
  must not appear in the agent-surface or API telemetry as though it were.
- Every other method — a refusal `ToolOutcome`. gg authored the program, so none
  is reachable; generate them with a local macro rather than 40 hand-written
  bodies. A refusal reaching the host is a bug, so it must also make the run fail
  (§1.7): record that one was reached and treat it as the internal error it is.

### 1.5 The prepared-program cache

A process-wide `Mutex<HashMap<(GgProgramLanguage, u64 /* source hash */),
PreparedProgram>>` (or equivalent) consulted only by the bootstrap. Justification
to write into the code: the compiled arms invoke a real toolchain per
preparation, the bootstrap program's source is a pure function of
`(language, module set, docview keys)`, and a run with a dozen agents would
otherwise pay a dozen identical compiles. Keying on the source is what keeps this
from being the cross-program caching `PreparedProgram::component`'s doc comment
correctly forbids: two different programs never share an entry.

### 1.6 Search views, and why the bootstrap's do not supersede each other

`ContextModel::open_search_view` keys every search view under the single constant
`SEARCH_RESULTS_VIEW`, so N searches leave one view. That is right for an agent's
own searches (a search names a mutable intent) and wrong for the bootstrap, whose
N module listings must all survive.

Change `open_search_view` to take the selector. The model's own searches keep
passing `SEARCH_RESULTS_VIEW` and keep superseding exactly as they do now; the
bootstrap passes **the module's own path**, so each module's listing is its own
view, superseding only a re-listing of the same module. Update the doc comments on
`open_search_view` and `SEARCH_RESULTS_VIEW` to say both halves. Verify
`close_view`/`view.close` by selector reaches a bootstrap view, and that the
heading `item_heading` renders for a module selector.

### 1.7 It is not a turn, and a failure is gg's

**Not a turn.** It runs before the `for turn in …` loop, so it consumes no turn
index. It must additionally not: call `record_turn`, `begin_turn`, `TurnTimer`,
`ProgramLibrary::record`, the loop guard, any usage/cost accounting, or emit a
`TurnStarted`/`TurnOutcome`/`TurnTiming`/`CodeExecution` event. There is no model
call, so there is no usage. Pin this with a test.

**A failure is internal.** Any of: the program fails to prepare; the sandbox
returns any error; the program's own execution reports a failure; a call inside it
is refused; a `BootstrapApi` method other than the two reachable ones is called;
or zero views are placed — is an `Err(detail)` from `seed_bootstrap`, routed by
`drive` into the established idiom for "gg broke standing this agent up":
`setup_broke` (`agent.rs:8899`) — an operator-facing `log("error", …)`, the fault
latch raised, `STATUS_INTERNAL_ERROR`. Delete the "nothing here is fallible"
doctrine from the module doc; the owner has reversed it.

### 1.8 The design decision this reverses, stated plainly

`bootstrap.rs`'s current module doc says seeding a call per capability "would put
the whole immediate function surface back in front of the model on turn one" and
that the search round trip "is the thing being measured, not an overhead to be
optimized away". The owner has decided the opposite: an agent sees every function
it may call, with a one-line brief each, before its first real turn — both because
it is what makes a language-agnostic prompt possible and because a model that has
already seen one valid program is likelier to write the next one. Rewrite that
section of the doc to say what is now true. Do not leave the old rationale
standing beside the new behaviour.

---

## 2. One system prompt

### 2.1 Files

- Delete `crates/gg/templates/system-code.{cpp,csharp,java,javascript,kotlin,
  purescript,python,ruby,rust,swift,typescript}.hbs` → one
  `crates/gg/templates/system-code.hbs`.
- Delete the eleven `code-nothing-shown.*.hbs` → one
  `crates/gg/templates/code-nothing-shown.hbs`. They are five lines each and
  differ in one clause; the same conditional mechanism covers them, and collapsing
  them is what lets `PromptDialect` go away entirely.
- `PromptDialect` and `ProgramLanguage::prompt()` are deleted. Both templates join
  `prompts.rs`'s `TEMPLATES`. `system_template_name(language)` picks between
  `system-tools` and `system-code` on mode alone.
- `default_system_prompt_template_code()` loses its language parameter.

### 2.2 How a language reaches the one template

Register an `eq` helper on the Handlebars engine (`handlebars_helper!`) and gate a
language segment with `{{#if (eq language.id "rust")}}`. `SystemContext` gains a
`language` view carrying `id`, `displayName` and `checker` (`Option`, from
`ProgramLanguage::checker()`), and nothing else — **no prose field**: a sentence a
model reads lives in a `.hbs` file, which is the rule that survives this change
unchanged.

Every fenced example inside a language segment keeps that arm's own language tag,
so `rust.examples.test.rs` and its three siblings keep compiling exactly the
snippets their arm is shown.

### 2.3 What the language segment may say — at most three paragraphs per arm

Only what a model cannot find by searching and cannot be told at the moment it
matters:

1. **The shape of a reply** — top-level statements, a module with `main`, a
   translation unit defining `main`, the body of a function gg declares. Not
   discoverable, needed before the first line.
2. **The failure model** — what a failed call does (returns, throws, raises) and
   the one name that catches it, when the arm has one.
3. **How a call's optional arguments are written**, and how a module is reached
   (already in scope / written in full / imported), when the module list's own
   `import` field does not answer it.

Everything else in today's segments goes, by one of these routes:

- **To the error, where it belongs.** Library and package sets (the whole
  `{{#if libraries}}` section on nine arms) are deleted from the prompt; instead,
  a **compile failure's feedback names the arm's available set**, built from
  `catalogue().libraries` (already structured data — no new prose per arm), inside
  the existing diagnostic bound. Same for any cap whose breach gg detects: keep it
  in the prompt **only** if the error or result that reports the breach does not
  already carry it, and prefer adding it there to keeping it here.
- **Deleted outright.** Every "N consequences worth knowing" bullet list, every
  "N absences worth knowing", every sandbox-construction detail (`this guest`,
  `TeaVM`, `opal`, `wasm32-unknown-unknown`, "the WebAssembly component this
  sandbox then evaluates"), every cross-arm comparison ("as it is on every
  language gg drives", "the strongest check any of these languages gives you"),
  every host-injection mechanic the model cannot act on, and every "prefer X to Y"
  and "do not do Z".

The eleven segments are held to a hard ceiling by a test: **no segment renders
longer than three paragraphs.** Pick the ceiling's exact form (paragraph count
and/or a character bound) when you write the test, and make it fail loudly.

### 2.4 What the shared body says

The shared body is today's shared text, policy-cleaned. Non-negotiable rules it
must still state (the four `REQUIRED_RULES` are behaviour, not decoration):
programs are synchronous; views are the only way to read a value; a computed value
is discarded; what you ask for arrives on the next turn; a program that fails
revokes its own ending.

Apply the policy worklist in full. The largest items, all present in all eleven
templates today:

- **Narrative.** "Your window already holds a worked example of the second half…",
  "…that is deliberate", "because a program that failed did not finish the work its
  summary claims", "Use this when a program was nearly right…". Say the thing; drop
  the reason a human would want.
- **Emphasis.** Today's bold spans run 6–17 per template against `system-tools`'s
  zero. Reserve bold for the few genuinely critical words.
- **Need to know.** An agent with no delegation is not told other agents exist; no
  agent is told a board is shared run-wide, that memories are curated by others,
  that tasks are enforced as a DAG, or that a run withheld capabilities it can
  nonetheless compile a call to. That last one is the withheld-capability paragraph
  in all eleven templates: **it stays only if it is true and actionable for the
  arm being rendered** — on the arms where a withheld call compiles, a model that
  does not know this reads a runtime capability failure as a bug. Gate it on
  `language.checker` rather than stating it for every arm.
- **Handlebars conditionals over "if X".** The skills bullets ("if it carries
  code…", "if it carries an on-use script…") are the clearest case: gg knows both
  per skill. `{{#each skills}}` must emit only the branches that are true of that
  skill, which means `SystemContext`'s skill view carries those two flags.
- **Just-in-time.** The read-file line cap, the memory-description cap and the task
  ceiling: keep only what the corresponding error or result does not already say,
  and add it there instead where it does not.
- Fix in passing: the "then read the to recall previously recorded info" typo
  present in all twelve templates.

### 2.5 The gates that encode the old design

Update, do not work around:

- `sandbox/language.test.rs` — the pairwise `assert_ne!` that no two arms share a
  template, the `system-code.<id>` name assertion, and the JavaScript-is-not-
  TypeScript assertion all assert the design being deleted. Replace them with the
  new invariants: one template, every arm renders it, and each arm's render carries
  its own segment and no other arm's.
- `prompts.spellings.test.rs` — `judged_against` must now judge the one template
  against **every** arm's spellings pooled. That is the correct reading for a shared
  template, and it is stricter than today. A language segment may not name a
  catalogued call of any arm.
- `prompts.test.rs` — `REQUIRED_SECTIONS`, `render_system_for`, the per-arm checker
  assertions, the libraries assertions (delete: the section is gone), the
  TypeScript-only assertions, `REQUIRED_PHRASES`, `REQUIRED_RULES`.
- `sandbox/language/ruby.test.rs:33` (the Ruby version in prose) and
  `sandbox/language/cpp.surface.test.rs:723` (three C++ sentences) read
  `prompt().system_template` directly. Re-point them at a render, or delete them
  where the sentence they pin is deleted — `cpp.surface.test.rs`'s *toolchain*
  assertions are worth keeping on their own terms even where the prompt sentence
  goes; keep the test, drop the claim that it is measuring a template.
- New gates: the three-paragraph ceiling (§2.3); a bootstrap that runs on every
  arm and places views; a bootstrap failure that ends the run as an internal error;
  the bootstrap consuming no turn.

---

## 3. Everything downstream

- `scripts/gen-contract.mjs:40-106` — the directory scan and the
  `DEFAULT_GG_SYSTEM_PROMPT_TEMPLATES_CODE` map go; emit the single
  `DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE`. Regenerate
  `packages/run-record/src/gg-system-prompt.ts` and commit it —
  `scripts/ci/contract-drift.sh` fails otherwise.
- `packages/ui/src/app/pages/runs/gg/GgAgentEditor.tsx:266-292` — the per-language
  lookup becomes the single default; the "is this an override?" string comparison
  follows it. Update `ggConfigDraft.test.ts` and `GgConfigEditPage.test.tsx`.
- Docs (`apps/docs/src/content/docs/gg/`): `prompts.md` ("Template selection", "The
  code arm", the two template bullets), `languages/registration.md` (the dialect
  row, steps 11–12), each `languages/<arm>.md` "Prompt dialect" section, and
  `responses-as-code/views.md`'s "The opening turn" — which now describes a program
  that runs, what it searches, and that a failure of it fails the run.
- `.claude/workflows/gg-language-arms.js:79,295` instructs authoring a per-arm
  template; correct it.
- `gg-docs-plan.md` in the repo root is a superseded planning document for work
  already landed. Leave it alone.

---

## 4. Verification

The tree's own gates are the verification, and they are load-bearing here because
the change is mostly prose a compiler cannot check:

```
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
cargo test -p test-cabinet-gg
npm run gen:contract && bash scripts/ci/contract-drift.sh
npm run -w packages/ui test
```

(Confirm the exact commands against
`apps/docs/src/content/docs/development/building.md` — that document is
authoritative, not this list.)

Beyond green: the bootstrap must be shown to actually run on at least one
compiled arm and one interpreted arm, with the placed views asserted, not
inferred.
