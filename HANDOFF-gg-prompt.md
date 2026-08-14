# Handoff: one language-agnostic gg prompt + an opening turn that executes

**Branch:** `gg/language-agnostic-prompt` (cut from `rel/v0.7.0` at `e1cce943d`).
**Design:** [`gg-prompt-design.md`](gg-prompt-design.md) in this repo root — authoritative, read it first.
**State:** the implementation's first pass is complete and **compiles**. It is **not verified**.

---

## What is true right now

`cargo check -p test-cabinet-gg --all-targets` is clean, and the commit's pre-commit hooks passed:
`cargo fmt --check`, **`cargo clippy` with warnings denied**, `cargo doc` with warnings denied,
and markdownlint.

**No test has been run**, and neither has `gen:contract` or the ui suite. The work
was produced by six parallel agents over disjoint files; the integration pass that reconciles their
seams, runs the gates and fixes the fallout **never started**. Treat every claim below as "written,
not proven".

## What landed

- **The eleven `system-code.*.hbs` are one `system-code.hbs`** (410 lines), and the eleven
  `code-nothing-shown.*.hbs` are one `code-nothing-shown.hbs` (37 lines). A language reaches its
  own segment through an `eq` helper on `language.id`; the context carries `language.{id,
  displayName,checker}` and per-skill `carriesCode` / `carriesOnUseScript` flags.
- **`PromptDialect` and `ProgramLanguage::prompt()` are deleted**; both templates are registered in
  `prompts.rs`'s shared `TEMPLATES`, and `default_system_prompt_template_code()` lost its language
  parameter.
- **`bootstrap.rs` is rewritten** (+701 lines) to *execute*: it generates a whole program through
  the new `ProgramLanguage::bootstrap_program(modules, docs)`, prepares it through a source-keyed
  cache, runs it on `spawn_blocking` via `sandbox::run_prepared_program` against a `BootstrapApi`
  that implements `search_docs` and `open_docs_view` for real and refuses everything else, and
  routes every failure into `setup_broke` (fault latch + `STATUS_INTERNAL_ERROR`).
- **All eleven arms + the fixture implement `bootstrap_program`.**
- **`ContextModel::open_search_view` takes a selector**, so the bootstrap's per-module listings
  survive instead of superseding one another under the single constant selector.
- **`scripts/gen-contract.mjs`, `packages/run-record`, `GgAgentEditor.tsx`** dropped the
  per-language template map, and the docs site was updated across `gg/prompts.md`,
  `gg/languages/*.md`, `gg/languages/registration.md` and `gg/responses-as-code/views.md`.

## What is left, in order

1. **Integration.** Run `cargo clippy --workspace --all-targets -- -D warnings` and
   `cargo test -p test-cabinet-gg`. Expect failures in the gates that encode the deleted design —
   `sandbox/language.test.rs`'s pairwise `assert_ne!` on templates, its per-arm
   `system-code.<id>` name assertion and its JavaScript-is-not-TypeScript assertion;
   `prompts.spellings.test.rs`'s `judged_against`; `prompts.test.rs`'s `REQUIRED_SECTIONS`,
   libraries and TypeScript-only assertions; `ruby.test.rs:33`; `cpp.surface.test.rs:723`.
   Clippy and `cargo doc` are already green, so this is a test-semantics pass, not a compile pass.
   Fix the tests to the NEW invariant — do not weaken a gate to make a suite pass.
2. **The just-in-time debt.** Design §2.3 deletes the `{{#if libraries}}` section from the prompt
   on the strength of a compile failure's feedback naming the arm's available set from
   `catalogue().libraries`. **That feedback change was never written.** Until it is, nine arms lost
   information and gained nothing. Check the templates agent's report for anything else it marked
   OWED TO JUST-IN-TIME.
3. **`npm run gen:contract` + `bash scripts/ci/contract-drift.sh`**, and commit the regenerated
   `packages/run-record/src/gg-system-prompt.ts`. CI fails on an uncommitted regeneration.
4. **The new gates** (design §2.5, none written yet): the opening turn executes and places its
   views on a compiled arm and an interpreted arm; it consumes no turn and emits no per-turn
   telemetry; every failure shape ends the run as an internal error; every arm's segment is at most
   three paragraphs; **two agents on the same arm with different grants open on different function
   lists** (this one was requested explicitly and covers the prepared-program cache).
5. **Adversarial verification** over the prompt's policy compliance, the bootstrap's turn
   accounting and failure paths, and stale references across the tree.

Deliberately **not** on this list, and deliberately not lost: docviews do not say how to import a
symbol (see the audit below). That gap pairs with the contract inversion in ruling 1 rather than
with this branch — it costs nothing while gg still does the importing, and becomes load-bearing the
moment it stops. Do it there, not here.

The workflow that produced this can be resumed rather than re-authored:

```
Workflow({scriptPath: "/home/vscode/.claude/projects/-workspaces-the-test-cabinet/5acdefbd-9e95-475d-92c4-968c7cc9b39c/workflows/scripts/gg-language-agnostic-prompt-wf_594e2094-3ab.js"})
```

Its Build phase is done; start it at Integrate. (The prior run id is `wf_594e2094-3ab`, but a
resume only replays cached agents within the same session, so on a fresh session re-run the later
phases directly.)

## Owner rulings made during this work

1. **Land this change first, then invert the program contract.** See
   [[gg-programs-are-whole-programs]] in the memory directory. A gg program must be **whatever
   bytes the model sent, compiled as-is** — no wrapper, no import hoisting, no scope injection. The
   agent writes the entry point its language requires *and* its own imports, including the SDK's.
   Violators found: Rust (`rust.source.rs:104` `wrap` + `refuse_main`), Java
   (`java.source.rs:138`, synthesizes `public final class`), TypeScript/JavaScript
   (`typescript.prepare.rs:68`, evaluated as a function body), Kotlin (`kotlin.source.rs:106`,
   hoists imports). Clean: C++, Swift, PureScript, Python, Ruby, C#. **Scope injection must go on
   all eleven arms**, not only those five — `-include-pch`, `global using`, `@_exported import` and
   pre-bound namespaces are the same defect.
2. **Consequence for this branch:** nine of the eleven language segments currently say some form of
   "gg's own surface needs no import", which is true today and false after that change. The
   segments and the module list's `import` field get one more pass then.

## Spec-consistency audit — cut short, findings so far

Checked against the external responses-as-code specification this design descends from:

- **Function docview pulls in type docviews, one level only — IMPLEMENTED.** `DocViewTypes` is
  `Off` / `ReturnOnly` (default) / `ReturnAndParameters`, per agent via the `docViewTypes` param;
  `docs.rs:120-126` states explicitly that it is not a depth and that a type view never opens
  another type view. `names_a_signature` (`docs.rs:722`) is the depth-one test and deliberately
  does not read a parameter's inline fields.
- **Docviews list how to import a symbol — ABSENT.** A function's docview body (`assemble`,
  `docs.rs:694`) is signature lines + per-parameter descriptions + prose. A type's (`declare`,
  `docs.rs:394`) is the declaration + prose + a line per member + the member functions the agent
  may call. **Neither names the module, and neither carries an import line.** The module is only
  inferable from the FQN key. `ModuleDoc.import` / `ModuleView.import` exist
  (`sandbox/signatures.rs:226,997`) but are `None` on every registered arm and marked
  `#[allow(dead_code)]`, because gg currently does the importing — see ruling 1. **These two
  changes belong together:** the moment agents must write real imports, the docview has to say what
  to write.

Not yet audited (the sweep was interrupted): which documentation generator each arm uses and
whether all documentation comes from SDK source; whether the `first_sentence` derivation was
deleted and a 120-character brief cap enforced; whether the register gate over the normalized
catalogue exists; whether PureScript's docs name each parameter; whether the static-SDK inversion
landed on TypeScript, JavaScript, Python and Ruby; and gg's deliberate divergence on docview
placement (gg's band is append-only and never moves, where the spec says a docview sits immediately
after the turn that opened it, like a text or file view).
