# Handoff: one language-agnostic gg prompt + an opening turn that executes

**Branch:** `gg/language-agnostic-prompt` (cut from `rel/v0.7.0` at `e1cce943d`).
**Design:** stated on
[invariants](apps/docs/src/content/docs/gg/responses-as-code/invariants.md),
[prompts](apps/docs/src/content/docs/gg/prompts.md) and
[views](apps/docs/src/content/docs/gg/responses-as-code/views.md).
**State:** the design is **implemented and verified against every gate the repo
has**. What is left is the owner's review of two judgement calls (below), and the
separate branch ruling 1 describes.

---

## What is true right now

Every gate green, on the whole tree rather than on the crate:

| Gate | Result |
| --- | --- |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo doc -p test-cabinet-gg --no-deps` (warnings denied) | clean |
| `cargo nextest run --workspace` | green |
| `cargo test --workspace --doc` | green |
| `npm run -w packages/ui test` | green |
| `npm run lint:specs` (markdownlint + cspell) | 0 errors, 1252 / 1815 files |
| `gen:contract` + `contract-drift.sh` | regenerated and committed |

The prior handoff predicted a long list of test failures from gates encoding the
deleted design. **None of them failed** — those gates had already been rewritten
to the new invariant in `43d0e8b32`. What actually failed was four prompt gates,
and only after the policy repairs below.

## What the first pass got wrong, and what fixed it

The templates went out with **five statements a model reads that are false
against gg's own source**. Each was verified in the source before being changed,
and each is now covered by the gate that should have caught it:

1. **"give it either a prompt to work from or an issue to implement — one or the
   other."** `spawn_subagent` (`agent.rs:4569`) refuses a call with no `prompt`,
   and board issues auto-dispatch to their own top-level agents rather than being
   hand-dispatched. A model following that sentence earned a guaranteed
   `invalid-argument`.
2. **"You can read a workspace file, which arrives as a view of it."** A read
   hands text to the program and opens nothing; `views.open_file` is the call
   that adds the view (`sandbox/membrane/views.rs:13-19`). The sentence
   contradicted the prompt's own load-bearing rule three lines above it.
3. **"fails when it runs, naming the capability it needed."** The membrane's
   refusal is `` `{spelled}` is not available. `` and nothing more, and
   `membrane.rs:982-997` says at length that naming the capability is
   deliberately withheld. The prompt promised the one sentence the membrane
   refuses to write.
4. **"Hand over once per turn: the first hand-over is the one that runs."**
   `MAX_PROGRAM_CHAIN` is 4 and the **last** program in the chain is the turn's
   (`agent.code.rs:1396,1409`). Wrong on both counts, and the error that reports
   the ceiling already carries the number.
5. **"No function is named anywhere in it."** Two paragraphs later the same
   template renders `` Call `{{ending.finish}}` ``. A false absolute standing
   next to an instruction to call `finish` invites a model to doubt the ending
   call.

Alongside those, the policy worklist §2.4 left undone: narrative provenance
prose, three host-injection mechanics (Java/Kotlin import lifting, PureScript's
`Main` rename), two "prefer X" instructions, a "never a second overload"
absence, a "the wire" protocol detail, the ten-item "everything Rust allows"
reassurance list, and the just-in-time line-and-column promise.

**Three gates fired and were right; I reverted to them rather than weakening
them:**

- `a_read_only_memory_holder_is_told_the_memories_are_not_its_own` — the audit
  read "another agent's memories" as a need-to-know violation. The gate's own doc
  explains it is deliberate.
- `every_language_prompt_states_the_rules_a_program_runs_under` —
  `REQUIRED_RULES` wants the ending stated as `revoked`; the tightened sentence
  had dropped the word.
- `the_nothing_shown_notice_says_a_view_is_the_only_channel_back` —
  de-duplicating the notice had dropped "A view is the only way to see
  anything", which is the notice's whole point.

**One audit finding I declined:** rewording `Reading images is supported.` The
wording is shared with `system-tools.hbs`, where it is correct — in tool-calling
mode a read really does show the picture — and diverging the two modes churns six
assertions to replace a vague sentence rather than a false one. The
verified-false half ("arrives as a view of it") is gone.

## The two defects the bootstrap audit found

Both are real, both are fixed, and **both fixes are judgement calls the owner
should confirm**:

1. **`setup_broke` told operators a falsehood.** It emitted *"This is a gg
   defect, not a problem with the configuration"* — but two of its three callers
   are answers to a *configuration*: a system-prompt override that will not
   render is the operator's Handlebars, and the bootstrap now runs a real program
   under the operator's own `SandboxLimits`, so a `maxMemoryBytes` under the
   guest engine's floor ends the whole run under that sentence. It now reads *"gg
   could not stand this agent up as it is configured"*, which is true of all
   three, and the reasoning is written into the doc comment. **The blast radius
   is unchanged and deliberate** — the run still ends — because an agent that
   never got its surface produces a tree indistinguishable from one that had it
   and ignored it.
2. **The module listings do not survive a compaction, and the module doc claimed
   they did.** They are search views (`Retention::Ephemeral`), and
   `compaction::restore_docviews` re-derives the documentation band only. So a
   compacted window keeps the two discovery docviews and loses the surface
   listing they were opened beside. The doc now says so, and argues why it is a
   cost rather than a trap — the two that survive are the two needed to find the
   rest again. **If the owner disagrees, the fix is to re-derive the bootstrap's
   listings at a compaction boundary**, and that is a design change, not a doc
   change.

The audit's other findings were cosmetic or unreachable, and it returned a clean
bill on turn accounting, every failure path, the context/docs move including the
`JoinError` path, the prepared-program cache's soundness, the search-view
selector, and `bootstrap_keys`.

## Gates added on top of the design's §2.5 list

- **`two_grants_on_one_arm_open_on_different_function_lists`** — the cache guard
  §2.5 asked for explicitly. The wide agent seeds first so the narrow one runs
  against a warm cache, and every name the narrow agent does not bind must be
  absent from its window.
- **`the_bootstrap_consumes_no_turn` was vacuous** and now is not. It asserted
  `turn() == 0` on a window where nothing ever calls `begin_turn`, so it would
  have passed unchanged had the bootstrap emitted a full turn. It now opens turn
  1 after seeding and asserts the two bands are separable.

## Stale prose swept across the tree

Three sweeps over `packages/` + `scripts/`,
`apps/docs/src/content/docs/gg/`, and `crates/gg/` doc comments. The
load-bearing ones: two references to `crates/gg/templates/system-code.cpp.hbs`, a
file that does not exist; `sandbox/language.rs`'s `bootstrap_program` doc stating
the wrong order (it is pushed, *then* run); `docs.rs`'s "there is no directory"
doctrine, which the bootstrap now reverses by design; and ~30 places claiming the
system prompt renders the library set or the signature catalogue.
`python.substrate.test.rs`'s test was renamed off "the prompt" and its one
external reference moved with it.

## What is left

1. **Owner review of the two judgement calls above.**
2. **Ruling 1 — invert the program contract.** See
   [[gg-programs-are-whole-programs]]. A gg program must be whatever bytes the
   model sent, compiled as-is. Violators: Rust (`rust.source.rs:104`), Java
   (`java.source.rs:138`), TypeScript/JavaScript (`typescript.prepare.rs:68`),
   Kotlin (`kotlin.source.rs:106`). Scope injection must go on **all eleven**
   arms. **Consequence for this branch:** nine language segments say some form of
   "gg's own surface needs no import", true today and false after that change;
   the segments and the module list's `import` field get one more pass there.
   **Docviews still do not say how to import a symbol** — `ModuleDoc.import` /
   `ModuleView.import` exist but are `None` on every arm and
   `#[allow(dead_code)]`. That gap costs nothing while gg does the importing and
   becomes load-bearing the moment it stops, so it belongs to that branch, not
   this one.

Not audited, and outside this branch (they belong with the D1–D11 docs work):
which documentation generator each arm uses; whether `first_sentence` was deleted
and a 120-character brief cap enforced; whether the register gate over the
normalized catalogue exists; whether PureScript's docs name each parameter; and
whether the static-SDK inversion landed on TypeScript, JavaScript, Python and
Ruby.
