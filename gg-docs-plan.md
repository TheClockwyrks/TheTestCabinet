# gg documentation surface: design + implementation plan

**Branch:** `gg/multi-language` · **Scope:** all 11 registered program-language arms · **Status:** plan only, no code written.

Everything below is designed to rulings D1–D11. Where the brief, the ground-truth survey, or the adversarial critique conflicts with a ruling, the ruling wins silently and the conflict is not re-argued.

---

## 0. Owner decisions — authoritative

**This section supersedes §12 and any recommendation in the body that conflicts with it.** §12's eight forks are closed; they are kept below only as the rationale that produced these answers. Implementers read this section first.

### 0.1 Documentation form

- **No literal `\brief` / `@brief` tags anywhere.** They are noise. Documentation uses Doxygen's *implicit* structure: **the first line is the brief; the remaining lines are the detailed description.**
- **Every function, type, field and parameter has a brief.** A detailed description is **optional** and is added only when it provides actual utility.
- **The split is newline-based, never sentence-based.** `first_sentence` (`crates/gg/src/sandbox/signatures.rs:511`) is **deleted**, not repaired — no "grab the first sentence" derivation survives anywhere.
- **No entry's documentation may be a bare paragraph.** A doc comment whose first line is not a standalone brief is a gate failure.
- **The brief is capped at 120 characters.** A single line should never approach it, but it is enforced regardless.
- Length is **never** compared across arms (D11). C++ may legitimately need more words than Python.

### 0.2 Resolutions to §12

| # | Fork | Decision |
|---|---|---|
| 1 | Brief defect: repair or re-author | **Authored, newline-based, ≤120 chars, no `\brief`.** Delete the derivation. See §0.1. |
| 2 | How far the static-SDK inversion goes | **Full inversion on all four dynamic arms.** CI's inability to validate it does not matter. **The design must be documented in the TTC gg docs** (`apps/docs/src/content/docs/gg/`). |
| 3 | Module granularity | **Per related function family**, not per toggleable capability. |
| 4 | Search-ranking validation | **Option (a)** — the tiered scheme in §7 with no tuning surface, validated by the §10 discoverability gate alone. No committed relevance golden file. |
| 5 | Search results: value or view | **Search opens a view automatically**, and it is **its own view type** — not piggybacked on text views. A model would only ever hand results straight to a text view anyway, since search already offers filtering and keyword matching; a distinct view type also makes context spent on searching separately measurable. |
| 6 | Does `log` stay outside the catalogue | **No log function is exposed to models.** Remove every custom log function from the SDKs; the host WIT `log` that carries operator output is kept. The prompt must stop advertising the operator as a destination — see §0.3. |
| 7a | Host-memory backstop after the count caps went | **`MAX_COMPOSED_VIEW_BYTES_PER_TURN = 8 MiB` stays.** Removing the count caps left no ceiling of any kind — count or bytes — on how much one program can push into `ContextModel` in a turn, so a per-turn total on composed view bytes went in as a host-robustness guard. It does not qualify the ruling below: that ruling is about the NUMBER of views, and its rationale is the model's context window, i.e. tokens. 8 MiB is roughly 2M tokens, comfortably past any window gg drives, so the guard can only fire on runaway host memory and never on legitimate use. |
| 7 | Does a transitive placement charge a view op | **There is no cap on the number of views at all.** A cap on characters per text view stays; a cap on view *count* does not. The model's context window already is that limit. Delete `MAX_OPEN_TEXT_VIEWS` (`agent.code.rs:1664`) and `MAX_VIEW_OPS_PER_PROGRAM` (`agent.code.rs:1678`) with their refusal paths, and **extend the same removal to the image-view count cap** — `SandboxLimits::image_view_cap`, its per-agent `imageViewCap` param, and its carry onto `LoopToolApi` (`agent.code.rs:1095, 1160, 1667`). The per-image byte cap `IMAGE_ATTACH_CAP` is a size limit, not a count limit, and stays. |
| 8 | Java's search entry point | **A static function.** |

### 0.3 Accepted consequences, and one open item

Three concerns raised during design are accepted rather than mitigated:

- **A program can compile a call that search will never show it** (§1(d)). Accepted, **conditional on every toggleable function being namespaced or requiring an import** — the qualification is what keeps an unreachable call from looking like an ordinary one. Implementers must hold that condition on every arm.
- **CI cannot prove the static-SDK inversion** (§1(b)). Accepted.
- **Flat-name collisions with host-language names** (§11, stage 4: Ruby `Kernel#system`/`exec`/`fork`, Python `list`/`exec`, PureScript's `Prelude` clash, Java/Kotlin on-demand-import ambiguity). **Not an issue:** arms may legitimately spell a function differently, because search always returns language-specific documentation. The cross-arm name audit that §11 called a prerequisite is therefore **not** required — rename per arm as the language demands.

**Decision 6, resolved in full.** "Custom log function" covers two distinct things, and they are treated differently:

1. the **model-facing** SDK log function (`gg::log` / `gg.log` / `Gg.Log`), public on every arm and deliberately uncatalogued — **removed**;
2. the **host** `log` func in the WIT interface (`crates/gg/wit/gg-sandbox.wit:1026`), which is never bound into a program's scope and carries operator-facing run output — **kept**.

The governing rule is **the log function must not be exposed to models**. (2) satisfies it and stays.

A third consequence follows, and it is a **prompt** change rather than an SDK one. A model should never be deliberately emitting operator-facing output: most runs have only their result and metrics examined, not their event stream or output, so anything a model writes there is work spent for no reader. Therefore **models must not be instructed to emit operator output, and the prompt must not advertise the operator as a destination.**

Today it does, in **all 22 templates** (`crates/gg/templates/system-code.*.hbs` and `code-nothing-shown.*.hbs`), each carrying a variant of:

> `Effect.Console.log` / `console.log` / `println` / `WriteLine` **goes to the run's operator, not to you.**

The half of that sentence which earns its place is *"not to you"* — without it a model burns turns printing values it will never read. The half that must go is *"goes to the run's operator"*, which names a channel the model then has a reason to aim at. Reword all 22 to state only that the output is unreadable by the model and that views are the sole way to read a value. Rust's existing `` `println!` goes nowhere at all `` is the register to match. This lands in **stage 8** with the rest of the prompt rewrite (§10, §11).

---

## 1. Verdict

**Yes, this is doable across all 11 arms.** Nothing in the brief is blocked by a language. The extraction half already exists for every arm using that language's own standard reader, the docview is already a first-class view kind, the seeded-assistant-turn mechanism already ships with two callers, and the per-agent "may this agent call X" predicate already exists in exactly one place. The work is reshape, not invention.

Four things are **not** doable exactly as literally specified. In each case the nearest doable thing is named and is what this plan builds.

**(a) "All documentation comes from SDK source" — true, but the *enforcement* of its register cannot come from the extractors.** Every existing gate in the tree checks *presence*: `-Werror=documentation`, `-Xdoclint:all -Werror`, Roslyn `DocumentationMode.Diagnose`, `-Xexplicit-api=strict`, and the blank-checks in `crates/gg/src/sandbox/language/agreement.rs:521-674`. Not one of them can fail a 1,006-character second-person narrative. There is no length cap, no register check, no fenced-example cap anywhere in the tree. **Nearest doable thing:** a *third class of gate*, written once in Rust over the normalized catalogue rather than eleven times in eleven reflectors — §9. Without it the rewritten prose decays back to what it is today, and the decay is invisible to CI.

**(b) "Every SDK is static; calling a withheld function errors at runtime" — doable, but CI structurally cannot prove it.** Seven arms already behave this way. Four (TypeScript, JavaScript, Python, Ruby) build the program scope from the run's enabled set, and fixing them means rebuilding `crates/gg/src/sandbox/guests/{typescript,python,ruby}.component.wasm` (14.0 / 25.2 / 21.1 MB) **by hand** — `scripts/ci/contract-drift.sh` runs only the `signatures` half of each guest build and *fails the build at line 213* if a signature step touches `crates/gg/src/sandbox/checkers/`. The one existing drift check for a stale component, `boundTools() == ALL_TOOL_NAMES`, compares tool **names** and stays green against a component that still builds `ApiObject`s. **Nearest doable thing:** the inversion, plus a new committed **source-hash manifest per component** so a stale artifact fails by arm name instead of passing silently — §8.

**(c) "Docs provide MODULE information so agents know how to import" — the *import* framing is false on 10 of 11 arms; the *module* requirement is real and load-bearing.** gg injects the SDK into scope on ten arms (`use gg::prelude::*`, `-include-pch` + `using namespace gg`, `@_exported import`, `global using`, static import, scope injection); only PureScript writes a real import line. Per D9 this is **not** grounds to weaken the module requirement — module *structure* is a hard requirement independent of imports, and Kotlin's root package is a defect this plan fixes. **Nearest doable thing:** `module` is a **qualification and discovery** field, not an import instruction; the per-language prompt says how (or that nothing) is imported, and every FQN is module-qualified regardless. Ten arms' docs will say "in scope already" where PureScript's says `import Gg`.

**(d) "A search over an SDK the agent may not fully call" is an intentional inconsistency that will surface on the compiled arms.** D-brief requires the SDK to be static (all functions always exist) *and* search to return only functions the agent may use. On Rust/C++/Swift/C#/Java/Kotlin a program can therefore write, and the compiler will accept, a call to a function search will never show it. **This is correct and intended** — the compile-time surface is the language's, the discovery surface is the capability's — but it must be stated in the SDK header on every arm and in the prompt, or it reads as a bug. There is no nearer thing; it is a consequence of the two requirements being simultaneously true.

Two further honest notes carried into the design rather than argued:

- **D8 makes search quality load-bearing for capability usability.** A badly-ranked capability is invisible where the retired `REQUIRED_CALLS` guaranteed it could not be. The replacement gate in §10 is the mitigation and is treated as a first-class gate, not a nicety.
- **§5b (the idiomatic reshape + re-founded agreement gate) is the riskiest work in this plan by a wide margin**, and is sequenced last among the per-arm work for that reason.

---

## 2. Architecture

End to end:

```
SDK source doc comments  (authored: brief + optional detail, per arm's native doc dialect)
      │   packages/gg-sandbox*/  — 10 source trees, 11 arms (TS/JS share one)
      ▼
per-arm extractor        (unchanged tools: rustdoc JSON, clang AST, Roslyn, javadoc doclet,
      │                   Kotlin front end, swiftc symbol graph, purs docs, YARD, griffe, tsc)
      │   packages/gg-sandbox*/signatures.sh  →  exactly one file each
      ▼
normalized doc model     $OUT_DIR/signatures/<lang>.signatures.json   ("schema": 2)
      │
      ├─► register gate      crates/gg/src/sandbox/language/register.rs        (NEW — §9)
      ├─► coverage gate      crates/gg/src/sandbox/language/agreement.rs       (re-founded — §5b)
      │        against       crates/gg/src/sandbox/operations.rs               (NEW — the operation table)
      ▼
search index             crates/gg/src/docs/search.rs   (NEW; per-language OnceLock, gated per agent)
      │        shared core   crates/gg/src/search.rs     (NEW; lifted from memories.search.rs)
      ▼
RaC API                  WIT `docs` interface (crates/gg/wit/gg-sandbox.wit:687-704) grows
      │                  search / open / close / close-all; `list-functions` DELETED
      ▼
context views            crates/gg/src/context.rs — new GgContextSource::DocsView band,
      │                  append-only open-set (D1–D4)
      ▼
prompt + bootstrap       crates/gg/src/prompts.rs + 22 templates (no function names, D8)
                         + a synthesized opening assistant turn
```

### New Rust modules

| Path | What it holds |
|---|---|
| `crates/gg/src/sandbox/operations.rs` (+ `.test.rs`) | `Operation`, `OperationId`, `Binding`, `Applicability`, `OPERATIONS`. gg's own capability vocabulary — the successor of `MODEL_FACING_CALLS` (`language.rs:787`) and of every gate-shaped field currently living in the committed JSON. **This is where `capability: Option<&'static str>` is synthesized host-side** (§ below). |
| `crates/gg/src/search.rs` (+ `.test.rs`) | The shared substring/relevance core: keyword normalization, per-field scoring, breadth→frequency→stable-key ordering, excerpting. Lifted out of `crates/gg/src/memories.search.rs` and made generic; `MemoryStore::search` becomes a caller. |
| `crates/gg/src/docs/mod.rs` | `DocsRuntime` moved from `crates/gg/src/docs.rs`, keeping `bound()` verbatim. |
| `crates/gg/src/docs/search.rs` | The doc index (`DocIndex`, `DocIndexEntry`), tokenization, filters, pagination envelope. |
| `crates/gg/src/docs/render.rs` | `assemble` / `describe` / `declare`, moved and split into *function docview* and *type docview* renderers. |
| `crates/gg/src/docs/openset.rs` | The D1–D4 open-set algorithm and the D5 transitive rule. |
| `crates/gg/src/docs/mode.rs` | `DocViewTypes { Off, ReturnOnly, ReturnAndParameters }` + `resolve` + `id` + `Resolved{mode, unknown_params}` — shaped exactly like `MemoryStrategy` (`memories.rs:189-210`) and resolved exactly like `resolve_assistant_messages` (`healing.rs:542`). |
| `crates/gg/src/docs/suggest.rs` | Unchanged file, moved (currently `docs.suggest.rs`). Its `fold()` (line 88-96) is reused by search for identifier folding. |
| `crates/gg/src/sandbox/language/register.rs` (+ `.test.rs`) | The documentation **register** gate — §9. |
| `crates/gg/src/bootstrap.rs` | The synthesized opening assistant turn — §10. |
| `crates/gg/src/context.docviews.test.rs` | The D1–D4 behavioural gate, including the no-move assertion. |

### Existing files changed

| Path | Change |
|---|---|
| `crates/gg/src/sandbox/signatures.rs` | Schema v2: `SignatureCatalogue` gains `schema`, `modules`, one flat `functions` array; `ToolSignature`/`SessionSignature`/`ViewSignature`/`ProgramSignature`/`HelperSignature`/`MetaSignature` collapse into one `FunctionSignature`; `TypeDeclaration` gains `module`, `fqn`, `members[].kind`, `member_functions`. **`first_sentence` (line 511) and `summary_of` (line 643) are deleted** — see §9 / fork 1. `CatalogueFunction.library: bool` → `capability: Option<&'static str>`. |
| `crates/gg/src/docs.rs` | Becomes `docs/mod.rs`. `LIST_FUNCTION` (line 65) deleted; `list()` (128) deleted; `read()` (152) re-keyed to FQN; the stale carve-out comment at 213-216 (which omits `view.openDocsView`) rewritten. |
| `crates/gg/src/context.rs` | New `GgContextSource::DocsView` band; `open_docs_view` (1689) → `open_docview` with **no supersession** (§6); `close_docs_views` (1673) re-pointed at the new band; `open_views` (1987) derivation simplified; `archive_thread` (1619) exempts docviews; `place_view` unchanged. |
| `crates/gg/src/agent.code.rs` | `list_functions` (2964) deleted; `open_docs_view` (2967) rewritten to the open-set algorithm; new `search_docs`, `close_docview`, `close_docviews`; `close_view` (3093) stops sweeping the docs band; new `MAX_OPEN_DOCVIEWS` + `MAX_DOCVIEW_BYTES` beside the existing caps (1656-1678). |
| `crates/gg/src/sandbox/invoker.rs` | `ToolApi` grows `search_docs` / `close_docview` / `close_docviews`, loses `list_functions`. |
| `crates/gg/src/sandbox/membrane/docs.rs` | `list_functions` (21-43) deleted; the three new calls bridged. |
| `crates/gg/src/sandbox/membrane/views.rs` | `open_docs_view` moves out of the `views` interface to `docs`. |
| `crates/gg/src/sandbox/membrane.rs` | `dispatch`'s refusal (897-902) re-worded to the model's own spelling, matching `withhold` (955-970). |
| `crates/gg/wit/gg-sandbox.wit` | `interface docs`: `list-functions` deleted, `search` / `open-doc-view` / `close-doc-view` / `close-doc-views` added; `function-summary` repurposed as the search hit (D7); the **false** dedup promise at 790-793 rewritten to match the new (now actually deduping) behaviour. |
| `crates/gg/src/sandbox/language.rs` | `MODEL_FACING_CALLS` (787) and the 47 `SurfaceCall` constants (622-834) replaced by operation ids; `member_separator()` (193) deleted (gg can no longer assemble a call site); `open_docs_views_statement` (443-458) re-keyed to FQNs — an 11-arm edit. |
| `crates/gg/src/sandbox/language/agreement.rs` | Re-founded — §5b. |
| `crates/gg/src/prompts.rs` | `SystemContext::apis: Vec<ApiView>` → `modules: Vec<ModuleView>`; `Spellings::api` / `::meta` and `spellings()` (383-435) deleted. |
| `crates/gg/src/prompts.test.rs` | `REQUIRED_CALLS` (2263) **deleted**, replaced by the discoverability gate (§10). |
| `crates/gg/src/prompts.spellings.test.rs` | The five rules shrink to two (no template names any SDK function at all; no template names a bare gg tool). |
| `crates/gg/src/agent.rs` | `api_surface` (8508-8574) re-keyed to modules and de-duplicated against `DocsRuntime::bound` (the verbatim copy at 8526-8534 goes); `api_views` (8583) → module views. |
| `crates/gg/src/reference.rs` | `functions()` (526-563) loses the per-object `list` fold; `GgApiFunction` gains `operation`/`module`/`kind`/`fqn`. |
| `crates/gg/src/skills.builtin.rs` | `Family::objects` → `Family::operations`; `built_in_code` (346-379) drives `open_docs_views_statement` from FQNs. |
| `crates/gg/src/persistence.rs`, `crates/gg/src/compaction.rs` | Docviews recorded and re-seeded **by FQN**, never by body — §6. |
| `crates/core/src/gg.rs` | `GgContextSource::DocsView`; `CAPABILITY_DOCVIEW_CLOSE`; `GgAgentApi.object` → `module` + `operation`; `AgentSurface` gains `doc_view_types`. |
| `crates/core/src/gg_query.doc.rs` | `GG_CAPABILITY_CATALOG` gains the new id. |
| `scripts/ci/contract-drift.sh` | Schema-version assertion; component source-hash manifest check; header note that the coverage/register gates live in `cargo test`. |

### The host-side `capability` synthesis (carried forward, and generalized)

Today `CatalogueFunction` carries three gate fields (`gate`, `ending`, `library`) and `library: bool` exists solely because the program-library capability *cannot be expressed as a gg tool name* (`signatures.rs:490-493`). That boolean is the precedent, and the principle behind it is the one to generalize:

> **No reflector and no committed JSON ever learns a capability id.** Gating identity is gg's, synthesized host-side from where an entry sits.

Concretely, in `catalogue_functions()` (`signatures.rs:531-611`), `library: bool` becomes:

```rust
pub capability: Option<&'static str>,   // a gg capability id, or None
```

populated by **section membership** — the `programs` section yields `Some(CAPABILITY_PROGRAM_LIBRARY)`, the new docview-close entries yield `Some(CAPABILITY_DOCVIEW_CLOSE)`, everything else `None` — and `DocsRuntime::bound` (`docs.rs:200-217`) matches on it in place of the `if function.library` arm, reading the agent's `GgAgentConfig::is_enabled`.

This is what makes the toggleable close capability (D4) **land without touching `agreement.rs:429-437` at all**. That assertion is `let expected = (entry.key == FILE_VIEW).then_some(READ_FILE_TOOL);` — an equality demanding every non-`open_file` view carry `requires: null`. Because the close capability is never written into any catalogue's `requires`, the equality stays true on all 11 arms and the critique's "hard blocker" is designed out rather than relaxed. (In the end state of §5b the same idea appears as `Binding::Capability(id)` on the operation table; the section-membership form is its stepping stone and the two must not coexist for longer than one stage.)

---

## 3. The normalized doc model

Generated by `crates/gg/build.rs` into `$OUT_DIR/signatures/<lang>.signatures.json`, one per arm,
`include_str!`'d from there and parsed behind the existing per-language `OnceLock`. Nothing is committed
and nothing diffs it: `scripts/gg-signatures.sh` reflects all eleven on every build of the crate, out of
the SDK sources of the same checkout, so a catalogue cannot describe a surface the guest does not export.
(This plan was written while they were committed under `crates/gg/src/sandbox/guests/`; only where they
come from changed, not what is in them.)

### Top level

```jsonc
{
  "schema": 2,                        // NEW. The host asserts this is current when it parses.
  "language": "rust",
  "generatedFrom": "packages/gg-sandbox-rust/src/ (rustdoc --output-format json)",
  "unqualifiedScope": false,          // does a call resolve without a module prefix in this language?
  "libraries": [ … ],                 // unchanged
  "modules":   [ Module,   … ],       // REPLACES `objects`
  "functions": [ Function, … ],       // REPLACES tools+helpers+views+session+programs+meta
  "types":     [ Type,     … ]
}
```

`objects`, `meta`, and the five separate function sections are gone. `meta` dies with `list` (D7); the other five collapse because their only difference was a gate field that now lives in `OPERATIONS`.

### `Module`

```jsonc
{
  "id":   "files",                    // gg's language-independent module id (the shared vocabulary)
  "path": "gg::fs",                   // THE IDIOMATIC SPELLING, as this language writes it
  "brief":  "Read, write, and edit workspace files.",
  "detail": null,
  "import": null                      // the literal import line, or null when the SDK is in scope
}
```

`id` is the join key across arms and what the console groups by. `path` is what the model reads, what the prompt names (D10: module names are the discovery backbone), and what search-by-module accepts. `import` answers the brief's import requirement honestly: `null` on ten arms, `"import Gg"` on PureScript.

`id` values are the shared vocabulary, taken from what already exists — the `src/tools/*.ts` module names in `packages/gg-sandbox/src/catalogue.ts:44-51` and the 11 families in `crates/gg/src/skills.builtin.rs:89-201`:

`files · shell · board · tasks · memories · context · views · delegation · skills · programs · session · docs`

### `Function`

```jsonc
{
  "operation": "files.read_file",     // gg's stable operation id. THE cross-arm join key.
  "aliasOf":   null,                  // set when this is a second way to reach one operation
  "module":    "files",               // Module.id
  "kind":      "function",            // function | method | static-method | initializer
  "receiver":  null,                  // the declared type a method hangs off; null for standalone
  "name":      "read_file",
  "fqn":       "gg::fs::read_file",   // MODEL-FACING KEY. Emitted by the reflector, never assembled.
  "call":      "gg::fs::read_file",   // how it is written at a call site (differs from fqn on Java/Swift)
  "brief":     "Read a file's bytes into the program.",
  "detail":    "Returns a text or image variant; narrow it before use.",   // or null
  "signatures": [ SignatureEntry, … ],                                     // UNCHANGED shape
  "returns":  ["gg::fs::FileRead"],   // NEW: resolved SDK type FQNs in the return position
  "types":    ["gg::fs::FileRead", "gg::fs::ReadOptions", "gg::error::ToolError"]
}
```

Gone from the entry: `object`, `key`, `tool`, `requires`, `ending`, and the section it came from — every field an arm could get wrong about gating. `types` keeps its meaning (all SDK types the signature mentions) but is now **resolved FQNs, not written spellings** (D9); `returns` is the new subset D5's `ReturnOnly` mode reads.

### `Type`

```jsonc
{
  "fqn":    "gg::fs::FileRead",
  "module": "files",
  "name":   "FileRead",
  "declaration": "pub enum FileRead { Text(TextFile), Image(ImageFile) }",
  "brief":  "The result of a file read.",
  "detail": null,
  "members": [
    { "name": "Text", "kind": "variant", "type": "gg::fs::TextFile", "brief": "A text file." }
  ],
  "memberFunctions": [                       // one-line briefs only; full docs via their own docview
    { "operation": "views.close", "name": "close", "fqn": "gg::views::OpenView::close",
      "brief": "Close this view and reclaim its tokens." }
  ]
}
```

`memberFunctions` is what makes D10's type-docview decision work: a type docview shows its fields *and* one-line briefs of its members, and each member is reachable by opening its own docview. On a function returning `Workspace`, `ReturnOnly` therefore lands the agent on a menu of everything it can do next — which is the owner's stated reason for wanting return-type opening. On the free-function arms (Rust, C++, Python, Ruby, PureScript, Kotlin, TypeScript) `memberFunctions` is small or empty, so `ReturnOnly` is materially weaker there than on Java/C#/Swift. That asymmetry is real and is a thing the A/B will measure, not a defect.

### How one FQN is spelled consistently across 11 disagreeing languages

It **is not one spelling**, and pretending otherwise would produce a key the model cannot type. The FQN is the arm's own spelling, emitted by that arm's reflector, and consistency is guaranteed by four invariants rather than by string identity:

1. **Module-qualified, always** (D9). `gg.fs.readTextFile`, never bare `readTextFile`.
2. **Unique within the arm.** Gated: no two catalogue entries may share an `fqn`.
3. **Covers exactly three kinds** — `module ∘ function`, `module ∘ Type`, `module ∘ Type ∘ member` — with the arm's own separators.
4. **Round-trips.** Gated: for every catalogued entry on every arm, `openDocView(fqn)` resolves. This is the single test that stops a reflector from emitting a decorative FQN.

Cross-arm work never touches `fqn`; it uses `operation` and `module.id`.

| Arm | `module ∘ function` | `module ∘ Type` | `module ∘ Type ∘ member` |
|---|---|---|---|
| Rust | `gg::fs::read_file` | `gg::fs::FileRead` | `gg::agents::SubagentHandle::send` |
| C++ | `gg::files::read_file` | `gg::files::file_read` | `gg::agents::subagent_handle::send` |
| Swift | `GgFiles.readFile(_:offset:limit:)` | `GgFiles.FileRead` | `GgAgents.SubagentHandle.send(_:)` |
| C# | `Gg.Files.ReadFile` | `Gg.Files.DirEntry` | `Gg.Agents.SubagentHandle.Send` |
| Java | `gg.files.Workspace#readFile(String)` | `gg.files.FileRead` | `gg.agents.Subagent#send(String)` |
| Kotlin | `gg.files.readFile` | `gg.files.FileRead` | `gg.agents.SubagentHandle.send` |
| TypeScript / JavaScript | `gg/fs.readFile` | `gg/fs.FileRead` | `gg/agents.SubagentHandle#wait` |
| Python | `gg.fs.read_file` | `gg.fs.FileRead` | `gg.agents.SubagentHandle.wait` |
| Ruby | `GG::Fs.read_file` | `GG::Fs::FileRead` | `GG::Agents::SubagentHandle#wait` |
| PureScript | `Gg.Fs.readFile` | `Gg.Fs.FileRead` | *(none — see §5)* |

Java has no `module ∘ function` row and that is not an omission: per D10, Java's standalone functions become member functions on capability objects, so `gg.files.Workspace#readFile` **is** Java's spelling of what Rust spells `gg::fs::read_file`. Swift's labelled selector is part of the identity — `editFile(_:replacing:with:)` and `editFile(_:old:new:)` are different functions in Swift and a label-stripped key could not tell them apart; search matches on the base name and displays the labelled form. PureScript has no member kind at all, so it emits no third-kind FQNs, which the coverage gate permits explicitly.

---

## 4. Per-language extraction

**No arm needs a new tool in any container image.** Extraction runs at dev/CI time only — `scripts/ci/contract-drift.sh` installs each toolchain and runs each `signatures.sh` in one job (`.github/workflows/ci.yml:65-77`). `containers/gg-toolchains/Dockerfile` is the *run-time* compiler tree for compiling model programs and is untouched by this work. Every generator named in the brief is already installed and already invoked.

| Arm | Doc generator (unchanged) | Output format | Public-surface rule | Param-name recovery | Toolchain work |
|---|---|---|---|---|---|
| **Rust** | `rustdoc --output-format json` (`packages/gg-sandbox-rust/signatures.sh:63`) | rustdoc JSON, `EXPECTED_FORMAT_VERSION=57` under `RUSTC_BOOTSTRAP=1` | `pub` + root-reachable + not `#[doc(hidden)]`; `tools/signatures.py:563-578` refuses an uncatalogued public fn | rustdoc `sig.inputs` for names; `# Arguments` doc convention for prose, contract-checked at `:417-433` | None. Brief/detail by first-paragraph convention. `pub mod bindings` needs `#[doc(hidden)]`. Re-commit `rust.libraries.tar.gz` (9.4 MB) in the same commit. |
| **C++** | `clang++ -Xclang -ast-dump=json` (`packages/gg-sandbox-cpp/signatures.sh:61-66`) | clang AST JSON, typed comment nodes | in a shipped header under the umbrella, outside `gg::detail`; `///` only; `tools/signatures.py:706-722` refuses unclaimed | **native `\param`**, plus `-Werror=documentation` rejecting a mismatch before the reflector runs | Teach `tools/signatures.py` `\brief` (a real `BlockCommandComment`, currently unused and would produce an empty description at `:227-237`). `fragments()` raises on unknown nodes — deliberate, so this is lockstep. **Doxygen the tool is not adopted** (D6). |
| **Swift** | `swiftc -emit-symbol-graph` (`packages/gg-sandbox-swift/signatures.sh:52-61`) | SymbolGraph JSON | `identifier.precise` starts `s:2gg` **and** `accessLevel == "public"` (`tools/signatures.py:70-80`) | `functionSignature.parameters` + `- Parameter(s):` DocC convention, cross-checked three ways | Brief by DocC-abstract convention. Thirteen `swiftc` invocations and a 13-deep `@_exported` chain (§5b) — the largest build change of any arm. |
| **C#** | Roslyn `Microsoft.CodeAnalysis.CSharp` (`packages/gg-sandbox-csharp/signatures.sh:56-72`) | Roslyn semantic model, `DocumentationMode.Diagnose` | `DeclaredAccessibility == Public` + `Gg.*` not `Gg.Internal` + `///` | native `<param>`, resolved through `<inheritdoc>` | **Cheapest brief/detail on the tree**: `<summary>`/`<remarks>` already authored and already parsed; `tools/Signatures.cs:720-749` currently *concatenates* them — a ~5-line split, no prose rewrite. Keep `SDK_SOURCES` in `crates/gg/src/sandbox/language/csharp.sdk.rs` in step (test-enforced). |
| **Java** | `javadoc` custom doclet (`packages/gg-sandbox-java/signatures.sh:49-57`) | `com.sun.source.doctree` walked in-process | `Modifier.PUBLIC` in `gg.*` not `gg.internal`, doclint-complete | native `ParamTree.getName()`, matched against `getParameters()` | `DocCommentTree.getFirstSentence()`/`getBody()` gives a **native brief/detail** — the doclet currently collapses it with `getFullBody()` at `:533-535`. **Add the missing reverse check** (a public method the identity table forgot — the one arm with no `unclaimed` gate). **Fix `build.sh:71`'s flat doclint glob** in the same commit as the package move, or the strongest doc gate on the tree stops gating silently. |
| **Kotlin** | pinned Kotlin compiler front end + KDoc PSI (`packages/gg-sandbox-kotlin/signatures.sh:54-65`) | PSI parse, hand-rolled JSON writer | `isPublic` + `gg.*` not `gg.internal`, backed by `-Xexplicit-api=strict -Werror` | native `@param`/`@property` by subject name | **Add real packages** (D9) — today `grep '^package' src/` returns nothing. Brief by first-paragraph convention (no `@brief` in KDoc). Reflector is a *parse* not a resolve — see the degradation note below. |
| **TypeScript** | TypeScript compiler API over emitted `.d.ts` (`packages/gg-sandbox/package.json:11`) | `ts.getJSDocCommentsAndTags` over declaration files | `export` from a module in `package.json`'s `exports` map (replaces today's "named in `catalogue.ts`") | native `@param`, including `@param options.offset` for inline fields; a missing one is a build error | Brief via a `@brief`-equivalent first-line convention or an explicit tag. Hand-run `build.sh` and re-commit the 14 MB component. |
| **JavaScript** | *(none of its own)* | — | — | — | **No independent work and no independent shape**: `tools/signatures.mjs:115` is `LANGUAGES = ["typescript","javascript"]`, one source reflected twice, one component. Every TypeScript decision lands here automatically. |
| **Python** | `griffe` 2.1.0, static (`packages/gg-sandbox-python/signatures.sh`) | griffe object model, Google-style docstring sections | non-underscore name in a non-underscore module, named in `__all__` | native `Args:`; every parameter required, undocumented is fatal | Brief = the docstring summary line (griffe already separates it). Note `Parameter.fields` is always `[]` on this arm by design — a transitive design must not assume otherwise. Hand-run component rebuild. |
| **Ruby** | YARD 0.9.37 as a library (`packages/gg-sandbox-ruby/signatures.sh`) | `YARD::Registry` walked in-process | public + not `@api private` | native `@param`, and the only arm emitting `keyword`/`block` kinds and `@overload` multi-signatures | Brief via `@brief`-equivalent first paragraph. Hand-run component rebuild + `ruby.opal.cjs`. |
| **PureScript** | `purs compile --codegen docs` (`packages/gg-sandbox-purescript/signatures.sh`) | per-module `docs.json`, raw type AST | **module export list** — a real compiler-enforced protocol, the best of the eleven | **none natively** — see §5 | Brief by first-paragraph convention over the `-- |` comment; the `# Arguments` convention is untouched by a module move. |

**Arms where the plan degrades, named:**

- **PureScript** — no member functions at all (by design, §5), so `ReturnOnly` shows a type's fields and nothing else. It is the weakest arm for D5's `ReturnOnly` mode and the A/B must not read that as a language effect alone.
- **Kotlin** — the reflector is a PSI parse, not a semantic resolve, and `typeNames()` is a bare identifier regex over written type text. D9's "record resolved type FQNs, not the written spelling" is the one requirement Kotlin cannot satisfy by parsing. **Fix:** switch the reflector's type-reference extraction to resolve against the arm's own declared-type table (a lookup keyed on `(package, simple name)` with the file's imports applied) rather than emitting the bare identifier. If that proves insufficient on a collision, Kotlin's extractor must move from `PsiFileFactory` to analysis — flag it as a measurement in stage 0.
- **JavaScript** — no type checker, so every flat-name and FQN error is a run-time failure. Its only discovery affordance is the shim's `ReferenceError` hint, which must be rewritten to point at search.
- **Java/Kotlin/JavaScript** — these three cannot be reshaped independently: both JVM arms cross-compile through TeaVM to the shared ECMAScript guest and reach the surface by reading the guest's scope by name (`packages/gg-sandbox-java/src/gg/internal/Wire.java:98-148`). They land in one commit.
- **Swift** — `build.sh:36-37` already documents that its artifacts are not byte-reproducible (a random 16-byte module hash per object). Thirteen modules multiply that; nobody should expect the new archives to diff.

---

## 5. PureScript and C++

### PureScript

**It is the arm where the plan is closest to already-done and the arm where one requirement is genuinely absent from the language.**

*Public surface* is the best of the eleven. `module Gg.Fs ( readFile, writeFile, … ) where` is a compiler-enforced export protocol; `purs` will not let anything else escape, and gg already trusts it for user code skills (`crates/gg/src/sandbox/language/purescript.modules.rs:62-77`). Public = named in the export list of a catalogued module. Nothing to build.

*Modules* are the strongest identity of any arm: `purs compile --codegen docs` emits **one `docs.json` per module**, so the module is the unit the compiler itself reports in, not a label a reflector attaches. `Gg.Fs`, `Gg.System`, … already exist and already align 1:1 with the model-facing grouping (`tools/catalogue.mjs:156 moduleFor`).

*Parameter names do not exist and cannot be recovered.* I treat this as established: `purs`' docs.json for `greet :: String -> String -> Int` carries a type AST and no binder names anywhere, and record-field comments are discarded in all three placements. The existing answer is the right one and must be preserved verbatim: a `# Arguments` (and `# Fields`) markdown list inside the declaration's own `-- |` comment, parsed by `packages/gg-sandbox-purescript/tools/signatures.mjs` and held to a contract that throws on arity mismatch, an undocumented field, a documented non-field, or a blank. That contract is what makes `String -> String -> String -> Int` meaningful and it is non-negotiable.

**What changes for this arm:**

1. **Types split out of `src/Gg/Types.purs`** (16.7 KB, ~30 declarations) into the modules that produce them. Without this every PureScript type answers one module and search-by-module over types is a single bucket. This also forces `tools/signatures.mjs`'s `TYPE_MODULES` — today the hard-coded two-element `["Gg.Error","Gg.Types"]` — to become the full module list, and its two `referencedTypes` guards with it.
2. **The twelve object records are deleted**, and `src/Gg.purs`'s re-export list widens from `Gg.Fs (fs)` to the module's functions and types. The row-polymorphic optional-args idiom (`forall given rest. Union given rest ReadOptions => …`) is **kept** — it is genuine PureScript, it is what gives `options.offset` something to document, and splitting it into `readFile`/`readFileWithin` would double the catalogue for no capability gain. The visible cost is a mandatory `{}` at every call site once the record is gone; that is the honest price and should not be engineered around.
3. **No member functions, deliberately.** `handle.wait` on a `SubagentHandle` record is byte-for-byte the same discoverability failure as `fs.readFile`: a field access on a magic record no search can reach. Every capability where Java/C#/Swift get a member, PureScript gets a free function over the value — `waitForSubagents`, `closeView`, `readMemoryHit`, `programSource`. Function *count* therefore differs from other arms by design, which D11 explicitly permits and which the re-founded gate must not flag.
4. **Constructor prefixes stay.** `Gg/Types.purs`'s header states arms are prefixed (`TaskDone`, `IssueDone`, `AgentTimedOut`) precisely because every constructor is exported from the one `Gg` module a program imports. Splitting types into modules does not relax that while `Gg` remains a blanket re-export, and the model's program *is* a single `Main` module with `import Gg` (generated at `purescript.rs:424`). **Keep `Gg` and keep the prefixes** — the alternative (per-module imports) adds an import-selection burden to every turn and needs a healing rule that does not exist in `purescript.healing.rs`.
5. **Import-scope collision is the live risk.** A flat `import Gg` brings ~47 values plus every type and constructor into one scope alongside `Prelude` and whatever the model imports. `list` is gone (D7); `get`, `close`, `current`, `compact`, `exec`, `fork`, `search` all need a cross-module audit before this compiles. `purs` reports these as hard compile errors the model must heal, and there is no healing rule for it today — add one.
6. The agreement gate's PureScript special cases — `is_ml_notation` (`agreement.rs:733`) and `ml_declares_arguments` (`:743`) — **survive verbatim**. They are notation-level and object-free, and the new `search` function's PureScript signature must be readable by both.
7. `open_docs_views_statement` (`purescript.rs:407`) generates `main = for_ functions openDocsView`; with the object gone the generated program parses differently (no parenthesisation implied by a qualified field access) and its tests must be re-checked.

### C++

**D6 is settled: `clang++ -Xclang -ast-dump=json` stays; Doxygen the tool is not adopted, and "Doxygen" in the brief names the documentation *style* (brief + optional detailed).** The rationale holds up under inspection: the compiler AST yields access control natively, which answers "what is publicly facing in C++" more reliably than any doc renderer, and it is the same parser `-Wdocumentation`, `clang-doc` and libclang's comment API are built on — so it *is* the standard reader, not a bespoke one.

*Public surface* is enforced four ways today and only needs re-pointing: `///` means model-facing and `//` does not (`tools/signatures.py:29-35`, and a public member with no `///` is dropped at `:428-431`); access is tracked across `AccessSpecDecl` nodes because clang writes access only on the specifier and a `struct` starts public while a `class` starts private (`:396-405`); non-model-facing helpers live in `gg::detail`; and `unclaimed()` (`:706-722`) refuses to emit if any `FunctionDecl` in an object namespace is not named by the identity table. The two known gaps: `unclaimed()` iterates only `catalogue.OBJECTS` (so a public function in `gg::detail` or another `gg` child is not caught), and header-vs-object-file granularity already diverges — 12 header namespaces onto 3 `.cpp` files.

*Parameter names* are the **best of any arm**: `\param path` arrives as a `ParamCommandComment` carrying the argument name, and `-Werror=documentation` makes clang itself reject a `\param` naming a non-existent argument, before the reflector runs. Defaults are quoted from the header's own bytes rather than printed from clang's expression tree (`:349-372`), with a byte-vs-char offset correction because the prose is full of em dashes.

**What changes for this arm:**

1. **`\brief` becomes the authored brief.** It parses as its own `BlockCommandComment` in clang's AST and is currently unused — `rg '\\brief' packages/gg-sandbox-cpp/{Sources,tools}` returns nothing, and `paragraphs()` (`:227-237`) stops at the first non-`ParagraphComment` child, so a leading `\brief` today yields an empty description and trips the blank check. Teaching it is a small addition (`commands(comment,"brief")`), and C++ is the one arm where brief/detail is language-native rather than convention. This must land *before* any prose rewrite on this arm.
2. **`fragments()` raises on any comment node it does not know** (`:147-153`) — by design, so a dropped fragment is never silent. Consequence: introducing `\brief` (or any other command) into the SDK without teaching the reflector is a hard build failure, so prose edits and reflector edits are strictly lockstep on C++. `-Wdocumentation-pedantic` is on, so a mass rewrite surfaces every malformed command at once.
3. **`\copydoc` must keep resolving through brief/detail.** It is the arm's only proven write-once mechanism for model-facing prose (`api.hpp:48-54` states plainly that C++ has no macro or protocol that can carry a doc comment). Deleting `gg::detail::api_object_list` with `list` (D7) removes its only current use; anything else that must be said identically in twelve places will need a `\copydoc` target, and `tools/signatures.py:268-289` must resolve the command *before* the brief/detail split, not after.
4. **`using namespace gg;` in the prelude is not optional** and this is a trap. `<cstdlib>` declares `int system(const char*)` at global scope, so a global `namespace system` is a hard error (`Sources/sdk/gg.hpp:12-17`). Renaming `gg::system` → `gg::shell` *removes that forcing function*, which will read to a reviewer as licence to drop the namespace. It must not be dropped: `gg::context`/`gg::tasks` unqualified at global scope in a TU that includes half of libc++ is an ADL surprise waiting to happen.
5. **Build globs must go recursive.** `build.sh:115` globs `Sources/sdk/*.cpp` and `:138-139` copies `Sources/sdk/*.hpp` + `objects/*.hpp` into the stage. Splitting three thematic `.cpp` grab-bags into one TU per module and moving headers into `Sources/sdk/gg/` breaks both. The relocatable link into one `sdk.o` is unaffected (it takes an object list). The precompile check at `:144-151` is the gate that the umbrella stays complete.
6. **The PCH is this arm's single largest cost reducer** (850 ms → 82-95 ms, measured, `prelude.hpp:12-17`). Splitting one 419-line `types.hpp` into twelve headers adds twelve include edges — negligible — but nothing measures PCH cost, only that it works. C++20 named modules are explicitly **not** the answer: BMIs are compiler-private the way a PCH is, and wasi-sdk clang's module support buys nothing a header does not already give.
7. **Naming**: this SDK's types are `snake_case`, so `gg::files::file_read` and `gg::files::read_file` differ by word order. Search must rank exact-kind matches first or a type query will return the function.

---

## 5b. The idiomatic SDK reshape (D10 / D11) — the riskiest section

### 5b.1 What is being abolished, and why the gate must be re-founded

"API objects" — `fs`, `system`, `view`, `project` and the rest — are a **hidden vocabulary**: to reach anything you must already know the object exists, which is exactly what deleting `list` (D7) and emptying the prompt (D8) were removing. They go. So does the previous pass's proposed 13th `docs` object; search / open-docview / close become standalone functions in a `docs` module, spelled idiomatically.

This breaks `agreement.rs`'s founding premise. That file rests on a five-part identity tuple `(section, object, key, gate, ending, library)` (`agreement.rs:150-168`) and on the claim that two arms "offer the same functions on the same objects under the same gates, and differ only in what a program calls them". Idiomatic SDKs differ in **structure** — receiver, arity, grouping, function count — not merely spelling. The premise is false the moment Java returns an object with member functions where PureScript curries a free function.

### 5b.2 Per-arm reshape

| Arm | Idiomatic shape | Module identity | Standalone-function mapping | Member functions | Multi-file split |
|---|---|---|---|---|---|
| **Rust** | free `pub fn` in `pub mod` — already the shape; the *modules* change from product objects to the shared vocabulary, and types move out of `types.rs`/`options.rs` beside the functions that produce them | `gg::files` (path, crate-rooted; search accepts with or without the `gg::` prefix under the prelude glob) | n/a | on handle types only: `SubagentHandle::send/wait`, `IssueCreated::update/remove/wait`, `OpenView::close`, `ProgramSummary::source/rerun`, `MemoryHit::read` | already multi-file; delete `src/meta.rs` (`directory_of!`), add `src/docs.rs`, dissolve `types.rs` (406 lines) + `options.rs` |
| **C++** | free functions in nested namespaces, one header + one TU per module | `gg::files`, backed 1:1 by `Sources/sdk/gg/files.hpp` under the umbrella | n/a — a namespace, never a `struct` of statics | on handle types: `subagent_handle::send`, `issue_created::update`, `open_view::close`, … | split `types.hpp` (419) + `options.hpp` (175) into per-module headers; split 3 `.cpp` grab-bags into 12 TUs; two `build.sh` globs go recursive |
| **Swift** | **global functions** at module scope; `public enum fs: ApiObject` deleted along with the `ApiObject` protocol | real separate Swift modules `GgFiles`…`GgDocs` + an umbrella `gg` of `@_exported import`s, so `Sources/shell.swift`'s existing `@_exported import gg` keeps working | n/a — the point is to stop faking free functions with `static func` on a caseless enum; `gg.log` already proves the shape | via `extension` in the owning module: `SubagentHandle.send(_:)`, `OpenView.close()`, … | **the most invasive build change**: one `swiftc` per module (the existing `library()` helper at `build.sh:126-141` is already this shape), plus a 13th internal `GgWire` module that must be excluded from search |
| **C#** | `public static partial class Files` in `namespace Gg`, made receiver-free by `global using static Gg.Files;` — .NET's own `System.Math`/`System.IO.File` idiom, and the owner's sanctioned use of `using static` | `Gg.Files` (the `using static` target *is* the module) | static method on the module class + `global using static` restores the free call site | instance methods on nested records: `SubagentHandle.Send`, `OpenView.Close`, … | `src/Gg/Objects/*.cs` → per-module directories; the four `Types.*.cs` grab-bags dissolve; **every moved file must also be edited into `crates/gg/src/sandbox/language/csharp.sdk.rs`'s `SDK_SOURCES`** (test-enforced, so friction not risk). **No committed binary changes for the SDK reshape — the cheapest arm to iterate on.** |
| **Java** | **objects with member functions**, reached by naming a type, never a static utility class: `gg.files.Workspace.current().readFile(…)`. `Gg.java` (the twelve `public static final` fields) and `ApiObject.java` both deleted, and `SURFACE_IMPORT = "import static gg.Gg.*;"` with them | Java package `gg.files` (a classpath package, not JPMS — `module-info` is inert on a classpath and would be a documentation-only marker) | **an instance method on the module's capability object.** `gg.files.Workspace#readFile` is Java's spelling of Rust's `gg::fs::read_file` | everywhere, in two tiers: capability objects (`Workspace`, `Shell`, `Board`, `TaskList`, `MemoryStore`, `ContextWindow`, `Delegation`, `SkillLibrary`, `ProgramLibrary`, `Session`, `Review`) and handle objects (`Subagent#send`, `Issue#update`, `View#close`, `Program#rerun`) | 56 flat files into twelve packages; `DEFAULT_IMPORTS` in `java.source.rs:72-83` grows from `gg.*` to twelve star imports (array length changes); **`build.sh:71`'s flat doclint glob must go recursive in the same commit** |
| **Kotlin** | **top-level functions in real packages** — Kotlin has both natively and uses neither today; `Gg.kt`'s thirteen `val`s and `ApiObject.kt` deleted | Kotlin package `gg.files`; pin each file facade with `@file:JvmName` so `META-INF/gg.kotlin_module` stays stable | n/a — real top-level functions; the synthetic `FilesKt` facade must never leak into the FQN | extension functions in the owning package: `fun SubagentHandle.send(…)`, catalogued as members of `SubagentHandle` | add `package gg.<module>` to 23 files, re-cut the miscut pairs (`Fs.kt`/`Files.kt`, `Project.kt`/`Board.kt`); `build.sh` already recursive. **`wrap_program` gains a twelve-import header, retiring the `shift: 0` property** |
| **TypeScript / JavaScript** | ambient top-level free functions — `readFile("main.ts")`. The SDK is *already* free functions; the object layer is 3 arrays in `catalogue.ts` + ~60 lines of `shim.ts:410 buildScope` + ~35 lines of `typescript.check.rs` | module specifier `gg/fs`, backed by `package.json`'s `exports`; a **search facet, never an import** (there is no module loader in the component — say so in the SDK header) | n/a | on the objects the shim already constructs: `OpenView#close`, `IssueCreated#update`, `MemoryHit#read`, `ProgramSummary#rerun`. **`SubagentHandle#wait` excluded** — `spawn_subagent` and `wait_for_subagents` are separately gated and a `.d.ts` cannot express "sometimes absent" | already multi-file; rename `files.ts`→`fs.ts` etc. so module and object stop differing (deleting `OBJECT_FOR_MODULE`); split `types.ts` (15 KB) |
| **Python** | module-level functions, decisively — `os.path.join`/`shutil.copy`, never a `Files` class of `@staticmethod`s. Both layers real: enabled functions injected as bare names into exec globals, **and** the same objects reachable at `from gg.fs import read_file` | `gg.fs` (the `gg/tools/` layer deleted) | n/a | on the frozen dataclasses that already exist; plus `__str__`/`__iter__` where Python expects them | flatten `gg/tools/*` to `gg/*`; split `types.py` (17.7 KB); delete `ApiObject`; put the functions in `__all__` |
| **Ruby** | `module_function` + `include` — Ruby's own `Kernel` model, giving both `GG::Fs.read_file` (searchable FQN) and a bare `read_file` (private instance method on `main`) from one definition | `GG::Fs`, file path mirroring the constant | n/a | on the result classes, which already mix in `GG::Value`: `OpenView#close`, `IssueCreated#update`, … | flatten `tools/`; split `types.rb` (20 KB); delete `ApiObject`'s object layer **while preserving its arity/keyword forwarder per method** |
| **PureScript** | free functions over values — §5 | `Gg.Fs` (the compiler's own reporting unit) | n/a | **none, deliberately** | already 20 modules; split `Gg/Types.purs` |

**Cross-arm hazards this table creates, all of which are compile-time failures rather than silent ones:**

- **Flat-name collision with the host language.** Ruby: `system`, `exec`, `fork` are `Kernel` methods and installing them flat means a model reaching for the builtin silently gets gg's tool — rename to `exec_agent`/`fork_agent`. Python: `list` (dying anyway) and `exec` shadow builtins. TypeScript/JavaScript: `new Function(...names, body)` makes each SDK name a **parameter**, and a parameter cannot be redeclared by a `const` in the body — a program writing `const shell = …` becomes a hard SyntaxError where it used to be harmless. Either bind on a prototype-chained scope object instead of as parameters, or heal it in `typescript.healing.rs`. Java/Kotlin: twelve star imports reintroduce on-demand-import ambiguity in the **model's own reply** (`Shell`, `Review`, `Context` vs `java.util.*`). PureScript: `import Gg` vs `Prelude`/`Data.Array`.
- **Java + Kotlin + JavaScript are one commit.** Both JVM arms call the ECMAScript guest's bound objects by name (`Wire.java:98-148`, `Wire.kt`). If the JS shim stops binding `fs`, both break at the same commit.
- **Write-once prose mechanisms die with the objects.** C++'s `\copydoc gg::detail::api_object_list`, Java's `ApiObject#list()` javadoc, C#'s `<inheritdoc cref>`, Rust's `directory_of!`, Swift's `ApiObject` extension. Nothing needs them once `list` is gone, but anything future that must be said identically in twelve places needs a deliberate replacement.
- **Java is the only arm where programs get strictly longer** (`fs.readFile("x")` → `Workspace.current().readFile("x")`). That is the honest cost of abolishing the magic identifier, it will show as token cost, and it should be expected rather than treated as a regression.

### 5b.3 The re-founded gate

**What dies.** Every comparative check, and every check keyed on objects or sections:

| `agreement.rs` | Verdict |
|---|---|
| `Section` enum (112-130) | **dies** — an arm no longer files an entry into a section |
| `Identity::object` (158), `qualified()` (212-217), `identities()` (220-285) | **dies** |
| tool bijection (324-340), gate-names-a-tool (366-377), session vocabulary (380-393), ending roles (397-425), the view gate table (431-439) | **moves** gg-side: asserted once over `OPERATIONS`, not eleven times over eleven JSON files. *Strictly stronger* — an arm no longer has a field to be wrong in. |
| meta vocabulary singleton (342-364) | **dies entirely** (D7) |
| gg-tool-name collision (448-494) | **re-scoped** — with modules and receivers there is no single flat scope, so it applies only where `unqualifiedScope: true`, and an arm declaring `false` has *declared* the check vacuous rather than silently benefiting from it |
| "spelled once each **per object**" (533, 549-554) | **re-keyed** to `(module, receiver)` |
| API-object checks (637-657), `grouped_objects()` (501-506) | **die → restated on modules** |
| `agrees_with` identity set-equality (896-913) | **dies** — no reference arm |
| **`documented_arguments` comparison (923-945)** | **de-comparativized** → `Operation::takes_input: bool`, checked per arm against gg |
| **per-object function counts (950-981)** — *"groups N functions under `fs` where TypeScript groups M"* | **dies outright.** This is the check D11 kills by name. Its only witness is `agreement.test.rs:230-241`, which goes with it. |
| name/doc/signature presence, `signature.starts_with(name)`, `declares_arguments`, `check_parameter`, type + member docs, referenced-type declared, `is_ml_notation`, `ml_declares_arguments` | **survive verbatim** — and these were always the majority of the gate's real value |

**What replaces it.** `crates/gg/src/sandbox/operations.rs`:

```rust
pub struct Operation {
    pub id: &'static str,          // "files.read_file" — namespaced on gg's FAMILY, never on an SDK module
    pub family: &'static str,      // a skills::builtin::FAMILIES id — the only cross-arm grouping left
    pub binding: Binding,          // gg decides gating; NO ARM DECLARES IT
    pub takes_input: bool,
    pub applies: Applicability,
}
pub enum Binding { Tool(&'static str), Ending(EndingRole), Capability(&'static str), Always }
pub enum Applicability { Universal, UniversalExcept(&'static [(GgProgramLanguage, &'static str)]) }
```

`Binding::Capability` is the end state of the host-side synthesis carried forward from the prior pass: the reflectors and the committed JSON still never learn a capability id, but instead of deriving it from section membership it is now stated once, gg-side, per operation. The tool half of `OPERATIONS` is **const-derived** from `ALL_TOOL_NAMES` with a `const` assertion that the union covers it exactly, so a tool added to gg becomes an operation without anyone remembering — the same guarantee `GgProgramLanguage::ALL` already gives languages.

Each arm's catalogue carries `operation` **written on the declaration** the reflector reads (a `@ggop files.read_file` tag / `<ggop>` element / `\ggop` command), never in a side table like today's `catalogue.ts` — a side table is precisely the second copy that drifts.

**The four checks, all per-arm against gg, none comparative:**

1. **Capability coverage.** Every `Operation` whose `applies` covers this arm has exactly one canonical binding; every catalogued `operation` names a real one; every `aliasOf` names an operation this arm canonically binds. Because the tool half is const-derived, this subsumes today's tool bijection for all arms at once.
2. **Gate correctness** — asserted over `OPERATIONS` alone: every `Binding::Tool(t)` has `t ∈ ALL_TOOL_NAMES`; exactly three ending operations with the roles `EndingRole::tools()` gives them; `views.open_file` is `Tool(READ_FILE_TOOL)` and every other view operation is `Always` or `Capability`; exactly the three `programs.*` carry `Capability(PROGRAM_LIBRARY)`; every family is named.
3. **Takes-input.** If `takes_input` and no signature of the canonical binding documents a parameter → fail; and the converse. Keeps the exact defect the comparative check existed for (a bracket-less-notation reflector emitting empty `parameters` for everything) with no reference arm.
4. **Helper propagation (D11's one propagation rule).** Applicability is declared **gg-side, per operation**. `Universal` is the default; `UniversalExcept(&[(lang, reason)])` carries a **required prose reason**, is edited in gg rather than in the omitting arm's own package, and is therefore reviewed. Two checks fall out: an arm omitting a `Universal` operation fails by name (this *is* check 1), and an exemption naming an unregistered language, or one the arm *does* bind, fails as dead — so the list cannot rot into a blanket waiver. A new helper added to one SDK is added to `OPERATIONS` as `Universal`, and every other arm goes red until it either binds it or an exemption with a reason is written. **That is the propagation rule, enforced.** Honestly: "applicable" is not computable — a helper wrapping a `Result`-returning read is idiomatic in Rust and pointless in a throwing language. The design makes the judgement explicit, central and reviewed instead of implicit and per-package.

**Aliases** are how divergent counts stay legal: an arm may bind one operation twice (a free function *and* a method on the type it operates on; Ruby's block form beside its keyword form). Extras carry `"aliasOf"`, do not count toward coverage, are documentation-checked like canonical bindings, and are recorded distinctly in telemetry. **Coverage counts canonical bindings; nothing counts total functions.**

**The fixture must reshape, not re-spell.** `crates/gg/src/sandbox/language/fixture.rs` derives its catalogue by re-spelling TypeScript's committed JSON. Under the new gate it must also *move bindings between modules, convert two free functions into methods on a receiver, add an alias, and split a module*, or the negative control `a_language_that_offers_the_same_capability_in_another_shape_agrees` (`agreement.test.rs:575`) asserts nothing about the dimension D10 introduces. **Build the reshaping fixture before migrating any real arm** — it is the only way to make the new gate fail on demand.

### 5b.4 What this costs the cross-language study

Stated plainly, worst first.

- **Call-site burden is no longer held constant.** Today every arm writes `fs.readFile(path)`. Tomorrow one writes `gg::fs::read_file(&path, ReadOptions::default())?` and another `Workspace.current().readFile(path)`. Every per-call metric is contaminated: `ApiCall` counts, calls per turn, error rate per call, tokens per call. **Mitigation, built with the schema rather than after:** record `ApiCall` under `operation` (stable across arms) and carry the specific binding as a separate field. Operation-level counts stay comparable; shape becomes a legible second axis rather than noise inside the first.
- **Discoverability becomes a variable.** This is the *point* of D10 — magic objects are undiscoverable — but it has a consequence nobody should paper over: an arm with well-chosen module names and better search ranking will outperform an arm with identical capabilities and worse names. That confound did not exist when every arm presented twelve identical objects. It belongs in the study's writeup, not engineered away, because engineering it away means re-imposing uniformity.
- **Count parity as a cheap sanity signal is gone.** "Both arms offer 48 functions" was free, weak, and caught real mistakes. The coverage table is now the only evidence, which means the coverage table has to be right.
- **`object` stops being a cross-arm grouping axis** in `GgAgentApi` and `GgReferenceCategory`. **family** survives as the only one — which is why operation ids are namespaced on families.

**Retained, and this is the load-bearing list:** capability coverage (unchanged in strength, *strengthened* by anchoring to gg rather than to a reference arm); gating (identical by construction, no longer merely checked); ending vocabulary and roles; documentation completeness on every parameter, field, type and member; whether an operation takes input at all; and the measurement the study actually reports — task success per run, which is per-run and untouched.

**Net:** the gate stops guaranteeing *"the model is shown an identical surface"* and starts guaranteeing *"the model can do an identical set of things, under identical conditions, with identical documentation quality."* That is a weaker guarantee and it is the correct one, because the stronger one was only ever purchased by forbidding every arm from being idiomatic — which is itself a confound, and arguably the larger one.

---

## 6. The docview mechanism (D1–D5)

### 6.1 Band

Docviews stop sharing `GgContextSource::Skill` with read skills. Add `GgContextSource::DocsView` in `crates/core/src/gg.rs`, and update the exhaustive matches: `code_heading` (`context.rs:2118-2137`, `DocsView => Some("Documentation")`), `item_heading` (2157-2165, `Documentation: {fqn}`), `source_label` (2204-2220), `open_views` (1987-2019, whose `Skill`+not-pinned→`Docs` derivation collapses to a direct mapping), `close_docs_views` (1673), and the console's band rendering. This is required, not cosmetic: with D2 multiplying docview count, the usage signal must be able to report the docs band separately from read skills, and `close_docs_views(None)` must stop relying on read skills happening to be pinned.

### 6.2 The state is the open set (D1)

The only state is **the set of currently-open docviews**, keyed by `fqn`. No dependency graph, no refcounts, no back-references. `ContextModel` answers it directly:

```rust
/// Whether a docview keyed by `fqn` is open right now.
pub fn docview_is_open(&self, fqn: &str) -> bool {
    self.items.iter().any(|i| i.source == GgContextSource::DocsView
                           && i.label.as_deref() == Some(fqn))
}
```

A linear scan over the window, at most once per candidate per call. No index to keep coherent.

### 6.3 The exact change at `context.rs:1689` (D4)

Today:

```rust
pub fn open_docs_view(&mut self, name: String, body: String) -> ViewOpened {
    let superseded = self.supersede_view(GgContextSource::Skill, &name, None);   // ← REMOVED
    let item = self.view_item(GgContextSource::Skill, Message::user(body), name, None);
    self.place_view(item, superseded)
}
```

Replaced by:

```rust
/// Open the documentation view keyed by `fqn`, or do NOTHING if it is already open.
///
/// # Why this does not supersede, where `open_text_view` does
///
/// `openText` names a mutable INTENT — *this should be visible* — so re-stating it replaces the
/// copy that was there. A docview names a CONSTANT: the documentation for one fully-qualified
/// name is the same bytes every time it is rendered. Superseding it would remove and re-place
/// identical text at the tail, breaking the provider's cached prefix from that position onward
/// for no change in what the model reads. So a re-open is a total no-op: the view is not moved,
/// not re-emitted, not retagged. Placement is first-open order, permanently.
///
/// The consequence is the reason closing is the capability and opening is not: docviews are
/// APPEND-ONLY, so the cache prefix survives for the life of the session and the only thing that
/// can break it is an explicit close.
pub fn open_docview(&mut self, fqn: String, body: String) -> DocviewOpen {
    if self.docview_is_open(&fqn) {
        return DocviewOpen::AlreadyOpen;
    }
    let item = self.view_item(GgContextSource::DocsView, Message::user(body), fqn, None);
    let tokens = item.tokens;
    self.items.push(item);
    DocviewOpen::Placed { tokens }
}
```

Note it pushes directly rather than going through `place_view`: `place_view`'s only extra behaviour is re-inserting at a superseded index, and there are no supersessions here. `ViewOpened { superseded, replaced_in_turn, tokens }` is replaced for this path by `DocviewOpen { Placed { tokens } | AlreadyOpen }`.

**Two properties this buys, both worth asserting:**

1. The `retire_view` corpse problem disappears for docviews entirely. Today a cross-turn re-open retags the old copy to `History` and appends a new one, leaving a dead token in a cached prefix. Under D2 a function open can place up to ~7 views; at today's supersede semantics a model re-opening a handful of functions across a session would accumulate corpses at 7× the current rate, every one of them unreclaimable. Under D4 there are **zero** docview corpses, ever.
2. The prompt prefix is append-only across every open. The `cache_breakpoints` computation (`client.rs:1100-1133`) sees a strictly growing message list, so markers stay put.

### 6.4 The transitive rule (D2) and its knob (D5)

`crates/gg/src/docs/mode.rs`:

```rust
pub enum DocViewTypes { Off, ReturnOnly, ReturnAndParameters }
impl DocViewTypes {
    pub fn resolve(value: Option<&Value>) -> Resolved { … }   // shaped like healing.rs:542
    pub fn id(self) -> &'static str { … }                     // shaped like memories.rs:200
}
```

Read from the **per-agent** `responses-as-code` capability's `params.docViewTypes` — `"off"` / `"return"` / `"return-and-parameters"` — read literally, defaulting to `ReturnOnly`, with an unreadable value reported at launch in `Resolved{mode, unknown_params}` and never silently picking a mode the study did not ask for. This matches `resolve_assistant_messages` in mechanics (it *is* a RaC strategy knob) and `MemoryStrategy` in enum/resolve/`id` shape. The resolved id is reported in `AgentSurface` beside `execution_mode`, so a replay can tell which arm of the A/B a run was.

A note the owner asked for, without belabouring it: **`ReturnOnly` is not automatically cheaper.** A function returning `Vec<DirEntry>` opens `DirEntry`, whose fields may reference further record types the agent then wants — three round trips instead of one open. It is a thing to measure, not to assume, and it is precisely why this is a knob.

### 6.5 The algorithm

```
# One model call: openDocView(fqns) — the guest may pass one name or several.
# `open` is the live open set (context.docview_is_open); `mode` is this agent's DocViewTypes.

open_doc_views(fqns, mode):
    charge_view_op()                       # ONE op per call — the model made one call
    placed   = []
    refusals = []

    for fqn in fqns:                       # in the order the program named them
        entry = resolve(fqn)               # exact FQN match over this arm's catalogue
        if entry is None or not bound(entry):
            refusals.push(not_found(fqn, suggest(fqn)))    # bound names only, compiler-style hint
            continue

        # ---- the docview for the named thing itself ----
        if not is_open(entry.fqn):                          # D4: already open -> TOTAL NO-OP
            if at_residency_cap(): refusals.push(cap_refusal()); break
            placed.push(place(entry.fqn, render(entry)))

        # ---- D2: depth EXACTLY 1, FUNCTIONS ONLY, at OPEN TIME ONLY ----
        if entry.kind is a function-like kind and mode != Off:
            for t in sdk_types_of(entry, mode):             # already-resolved FQNs from the catalogue
                if is_open(t): continue                     # D3: closed and never-opened are the same
                if at_residency_cap(): refusals.push(cap_refusal()); break
                placed.push(place(t, render_type(t)))

    return (placed, refusals)


sdk_types_of(entry, mode):
    match mode:
        ReturnOnly          -> entry.returns              # resolved FQNs in the return position
        ReturnAndParameters -> entry.returns ∪ entry.types
    # Both fields already hold ONLY declared SDK types, resolved to FQNs by the extractor.
    # Primitives, generic containers and foreign types are not in them and need no filtering here.


# A TYPE docview NEVER opens another type docview. There is no recursion and no second level.
```

Three consequences to state where the code comments will need them:

- **Opening is idempotent and order-stable.** The set of open docviews after any sequence of opens is the union of what was named; their order in the window is first-open order, permanently.
- **Closing is a plain removal with no cascade (D3).** `close_docview(fqn)` removes exactly that item; every function docview is untouched. Later opening `G`, which also uses that type, re-opens the type **iff** it is not currently open — because "closed" and "never opened" are indistinguishable, which is exactly what makes the state a set rather than a graph.
- **`view.close(selector)` stops sweeping the docs band.** Today `agent.code.rs:3093-3112` sweeps file + text + docs with one selector. Docview closing moves to its own calls on the `docs` module, gated by the capability, and `view.close` keeps files and texts. This is cleaner than gating one band inside a shared call and it makes the telemetry honest: `GgContextAction::CloseDocsViews` now has exactly one producer.

### 6.6 The close capability (D4)

New id `CAPABILITY_DOCVIEW_CLOSE = "docview-close"` in `crates/core/src/gg.rs`, added to `GG_CAPABILITY_CATALOG` (`gg_query.doc.rs:53`). Two model-facing operations, `docs.close` and `docs.close_all`, both `Binding::Capability(CAPABILITY_DOCVIEW_CLOSE)` — synthesized host-side, never written into a catalogue's `requires`, so the view-gate equality at `agreement.rs:429-437` stays true untouched (§2).

`DocsRuntime::bound` therefore refuses to document or return them in search when the capability is off, and — under the static-SDK rule (§8) — a program that calls one anyway gets `UNAVAILABLE` at the membrane. The default should be **off**, because that is the arm of the A/B in which the cache prefix is provably intact for the whole session, and it is the cheaper claim to defend.

Because closing is the only thing that can break the prefix, the `ContextManaged` event for a docview close should carry **the index of the earliest removed item** alongside the reclaimed tokens — the only way to evaluate whether the toggle is net-positive. Nothing measures this today.

### 6.7 Caps

Beside the existing constants at `agent.code.rs:1656-1678`:

- `MAX_OPEN_DOCVIEWS` — per-agent, configurable via a `docViewCap` param like `imageViewCap`, default 80. Refusal names the cap and points at close (or, when close is withheld, says so — a run that cannot close and hits the cap has told the model something true about its own configuration).
- `MAX_DOCVIEW_BYTES` — a per-body cap mirroring `MAX_TEXT_VIEW_BYTES`. A type docview with many member briefs is the growth vector.
- `MAX_VIEW_OPS_PER_PROGRAM = 100` unchanged, charged **one per call** as above. Charging per placement would make a `ReturnAndParameters` agent's op budget mean something different from an `Off` agent's, which would confound the A/B on a dimension unrelated to what it measures.

### 6.8 Survival

- **Compaction.** `clear_ephemeral` (`context.rs:1315-1340`) keeps only pinned items, and `apply_compaction` re-seeds `files` only (`compaction.rs:936-975`). With docs-from-search as the *only* discovery route, an agent that compacts loses its whole reference. Fix: `CompactionRequest` gains a docview half carrying **FQNs, never bodies** — a docview is a pure function of `(fqn, language, bound set)`, so it is re-derivable, which is the same principle `OpenFileView` already uses (`context.rs:217-223`). Re-seeded in first-open order so the ordering property survives the boundary.
- **Persistence.** `PersistedViews { files, texts }` (`persistence.rs:120-138`) gains `docviews: Vec<String>` (FQNs). Restored the same way, one program per restored view, as at `persistence.rs:311-321`.
- **Archival.** `archive_thread` (`context.rs:1619-1643`) retains only pinned or out-of-range items, so a docview opened on turn 3 is silently deleted when the model archives turns 1-10 — with no signal, and no test covering it today. Under D3 closing is the *only* thing that removes a docview, so **`archive_thread` must retain the `DocsView` band**. That is a one-line predicate change and a test.

---

## 7. Search

### 7.1 Index

Built once per language behind a `OnceLock`, over the already-parsed catalogue (47-ish functions and 26-38 types per arm — small enough that nothing needs precomputing beyond folding):

```rust
struct DocIndexEntry {
    fqn: &'static str,
    kind: DocKind,                  // Function | Method | Type
    module_id: &'static str,        // "files"
    module_path: &'static str,      // "gg::fs"
    receiver: Option<&'static str>, // the type a method hangs off
    name: &'static str,
    folded: String,                 // suggest::fold(name) — sees through write_file / writeFile
    brief: &'static str,
    signature: String,              // the rendered signature text, joined across overloads
    detail: &'static str,
    operation: Option<&'static str>,
}
```

**No new committed artifact.** The index is derived at run time from data already `include_str!`'d. Adding a precomputed index file would have to be added to `$regenerated` in `scripts/ci/contract-drift.sh:129` and would be a second copy of the catalogue.

### 7.2 Query and matching

One query **string** (not a keyword list — a substring search over identifiers wants one string, and `search_archive` is the closer precedent), split on whitespace into tokens. Each token: trimmed, lowercased, deduped, empties dropped. An empty normalized query is a refusal, not an empty result — `MemoryError::NoKeywords`'s precedent (`memories.rs:1191-1201`).

Matching is **case-insensitive substring** via `str::contains`, so `foobar` matches `getFoobar` exactly as the brief requires and exactly as `memories.search.rs:101` already does it.

### 7.3 Ranking

Tiered, not blended — `docs.suggest.rs:27-32` documents why gg chose tiers over a score, and identifier search is the same problem. For an entry, its tier is the **best** tier any token achieves:

| Tier | Match |
|---|---|
| 0 | folded identifier == folded token |
| 1 | folded identifier starts with token |
| 2 | folded identifier contains token |
| 3 | signature text contains token |
| 4 | brief contains token |
| 5 | detail contains token |

Within a tier: **breadth** (distinct tokens matched) desc → **occurrences** desc → **fqn** asc. Exactly `memories.search.rs:74-79`'s ordering, reused from `crates/gg/src/search.rs`. Entries matching nothing are dropped, not ranked last. The final `fqn` tiebreak makes every search reproducible across runs, which the study needs.

**Kind bias:** when a token matches a type's identifier at tier 0-1 *and* a function's at the same tier, the type wins the tie. This is the C++ `file_read` / `read_file` case from §5.

### 7.4 Filters (D10)

- `module` — exact, case-insensitive, matching either `module_id` or `module_path` (so a prompt that names `gg::fs` and a model that types `files` both work). **Search-by-module is an exact lookup, not a ranking problem** — which is precisely what makes the D7+D8 discovery chain safe: prompt → module name → `search(module: …)` → briefs → docview.
- `type` — exact on a type's FQN or simple name; returns the briefs of **that type's member functions**, per D10.
- `kind` — `function` | `type`, for the brief's "filterable to modules/functions/types".

Module and type filters compose with the query; an empty query plus a module filter is a directory of that module, which is the thing `list` used to be for one object and is now global and searchable.

### 7.5 Envelope and pagination

House style is the file-read window (`offset`/`limit` answered with a total, `tools/data.rs:172-188`), not a cursor. WIT:

```wit
record doc-hit {
    fqn: string,        // what openDocView takes
    kind: string,       // "function" | "method" | "type"
    module: string,     // the idiomatic module path
    name: string,       // the callable's own name
    summary: string,    // the BRIEF, authored
}
record doc-search {
    total: u32,         // matches before paging — so a model knows whether to page again
    offset: u32,
    hits: list<doc-hit>,
}
search: func(query: string, module: option<string>, type: option<string>,
             kind: option<string>, offset: option<u32>, limit: option<u32>)
        -> result<doc-search, tool-error>;
```

`function-summary` is **repurposed** into `doc-hit` per D7 rather than deleted. The `total` field is deliberate: `search-memories` returns a bare `list<memory-hit>` (`gg-sandbox.wit:349`) and a model cannot tell a capped page from a complete result — the documented failure `archive-search`'s envelope (`:571-579`) exists to avoid.

### 7.6 How results reach the model

`list()` today is "an ordinary return value, so it puts nothing in front of you on its own: to read it yourself you must open a view of it." A paginated search called in a loop, each page opened as a text view, burns through `MAX_OPEN_TEXT_VIEWS = 50` and `MAX_VIEW_OPS_PER_PROGRAM = 100` fast. **Search-as-return-value is free to the program and the program is not the reader.**

Recommendation: search returns the envelope as a value **and** the host opens a single dedicated results view under a constant selector, superseding the previous one. That view **correctly supersedes** — it names a mutable intent (*these are my current search results*), which is exactly the `openText` side of the D4 contrast — so only the last query is resident and re-stating the intent replaces it. Supersession retags rather than removes (`retire_view`), so it costs a corpse but never breaks the prefix. One view op charged per search. A per-agent param can suppress the view for an arm that wants search results program-only. (This is fork 5 in §12.)

### 7.7 Permission filtering

Search routes through `DocsRuntime::bound` (`docs.rs:200-217`) **verbatim** — never a second filter. The verbatim copy of that predicate at `agent.rs:8526-8534` is deleted and `api_surface` calls the same function; that duplication is a drift hazard the moment search exists as a third consumer.

Types are visible when **any** function referencing them is bound, plus a type reached transitively by an open function docview is always renderable (an agent that can call `readFile` can see `FileRead`).

### 7.8 What is reused

- `crates/gg/src/memories.search.rs` → generalized into `crates/gg/src/search.rs` (normalize, per-field substring scoring, breadth/frequency/stable ordering, excerpting). `MemoryStore::search` becomes a caller. Today `mod search;` is private to `memories.rs:90` and `rank` is typed over `&[Memory]`, so this is a visibility + generic change either way.
- `crates/gg/src/docs.suggest.rs::fold` (88-96) for identifier folding.
- `docs.suggest::nearest` stays exactly what it is — the not-found hint after a failed docview open. It is a different algorithm and must not be repurposed.
- `crates/gg/src/archive.rs:177`'s unranked `take(limit)` is a free consistency win once the shared ranker exists, but it is out of scope for this plan.

---

## 8. Static SDKs + runtime capability errors

### Per arm

| Arm | Today | Change |
|---|---|---|
| Rust, C++, Swift, C#, PureScript | already static; SDK linked as a library, host refuses | none |
| Java, Kotlin | static classes, null JS target → `ToolError(UNAVAILABLE)` from the SDK bridge | none behaviourally; the twelve `@JSBody` scope accessors follow whatever the JS shim becomes (§5b) |
| TypeScript / JavaScript | `shim.ts:410 buildScope` binds only enabled entries; a withheld tool is an undefined identifier | flatten to bind **all** entries unconditionally, each unbound one throwing `ToolError(unavailable)`. Also `crates/gg/src/sandbox/language/typescript.check.rs` must declare the full surface unconditionally, or the TS arm fails at *compile* time and the inversion has not happened |
| Python | `scope.py:134 build_objects` | bind all; a withheld one raises `ToolError(UNAVAILABLE)`. `shim.py::_is_withheld` currently detects withholding via `isinstance(exc.obj, ApiObject)` — that must be rewritten first or every withheld-tool failure silently reclassifies as an ordinary program bug |
| Ruby | `scope.rb build_objects` + `Scope.installed` removal list | bind all; **preserve `ApiObject`'s arity/keyword forwarder per method** — Opal lowers keyword args to a trailing hash and silently ignores extra keys, so without it `create_issue(reviewer: […])` is accepted and creates an issue with no reviewer, a failure the model cannot see. Also re-run `ApiObject.precompute` equivalent at load time so the shapes still land in the wizer snapshot (~3 ms of a ~9 ms turn) |

### Membrane / invoker

The universal enforcement point already exists: `membrane.rs:884-902 dispatch` checks `MembraneState.enabled` before every bridged call, and `declare` / `library_bound` enforce role and capability. **One fix is mandatory**: `dispatch` refuses with **gg's tool name** (`unknown tool \`read_file\``, :901) while `withhold` refuses with the **model's own spelling** (`fs.readFile`, :955-970). Once every arm routes withheld calls through `dispatch`, every model on every arm reads a gg tool name it cannot type. `refuse` needs the `SurfaceCall`/spelling treatment `withhold` already has — re-keyed to operation ids.

**Do not delete `run`'s `tools` / `ending` / `library` parameters** (`gg-sandbox.wit:1099-1130`). They stay load-bearing after the SDK goes static: search, the ending gate and the capability gate all still answer per-run, and the WIT doc at :1099-1112 states the *opposite* contract as normative and must be rewritten.

### What breaks

- **AgentSurface.** `withheld` becomes meaningful on all eleven arms (today it is only meaningful where a name can be absent). `GgAgentApi.object` → `module` + `operation`; `GgAgentApiFunction` gains `operation`. These are `ts_rs::TS` + `schemars` contract types, so this regenerates `packages/run-record/src` and `apps/docs/public/schema` and is caught by contract-drift check #1. Add fields alongside rather than renaming in place — prod runs exist and the console joins on `(object, function)`.
- **The agreement gate.** Nothing, actually — the gate never asserted anything about scope construction. What breaks are the per-arm substrate tests that assert a withheld name is a `ProgramErrorKind::UnknownName` (`python.substrate.test.rs:1253-1272` and siblings). Those become `unavailable` assertions. Note `outcome.rs:290-300` already unifies the two classes deliberately, so the telemetry taxonomy survives.
- **The reference artifact.** `crates/backend/src/gg_reference.json` (190 KB) regenerates for the schema change regardless.
- **The drift gate.** This is the real hazard and the reason for a new check. `contract-drift.sh` deliberately does not rebuild the four committed components, and the one check that would notice a stale one (`boundTools() == ALL_TOOL_NAMES`) compares tool **names** and stays green against a component that still builds objects. **Add a committed manifest** `crates/gg/src/sandbox/guests/<lang>.component.manifest.json` recording the SHA-256 of every SDK source file that went into the component plus the component's own hash; a test recomputes the source hashes from `packages/gg-sandbox*/src/` and fails **by arm name** when they disagree. That converts "a reviewer forgot to run `build.sh`" from an invisible correctness hole into a named CI failure.

---

## 9. Doc authoring policy — enforced, not hoped for

### Where the gate lives

**Once, in Rust, over the normalized catalogue** — `crates/gg/src/sandbox/language/register.rs`, run from the same test that runs coverage, for every registered language. Not in the eleven reflectors. The catalogue is normalized precisely so a policy about text can be one implementation instead of eleven, and each reflector keeps only its existing *presence* checks (which are already strong and already fail the build).

### The `first_sentence` defect, restated correctly

`crates/gg/src/sandbox/signatures.rs:511` ends a sentence only on `.` followed by **space or end-of-string**. A period followed by `\n` is therefore not a sentence end, and the brief **swallows the following paragraph** — the field stops being a brief. That is a correctness bug in extraction, wrong in any language. It is confirmed on cpp, csharp, java, kotlin, purescript, ruby, rust, swift (≈50 affected doc strings each) and absent on javascript/python/typescript only because their docs are one flowing paragraph. The 90-vs-240 median gap is *evidence* of the bug, not the defect and not a target.

There is a second, independent instance of the same class: TypeScript/JavaScript `readFile`'s doc opens ``Read a file, returning either `{ kind: "text", ... }` or …`` and the third dot of the ellipsis is followed by a space, so today's emitted summary is `Read a file, returning either \`{ kind: "text", ...` — truncated mid-code-span, with an unbalanced backtick. That is what `fs.list()` shows the model today on the two likeliest arms.

**Recommendation (fork 1): delete the derivation.** Authored `brief` + optional `detail`, as the brief requires anyway ("a brief single-line description always; a longer detailed description if and only if needed"). `first_sentence` and `summary_of` are deleted so there is no silent fallback and the bug cannot recur in a new place. C# and Java get this for nearly free (`<summary>`/`<remarks>`; `getFirstSentence()`/`getBody()`); C++ gets it natively once `\brief` is taught; the other seven adopt a first-paragraph convention their reflector holds to a contract, exactly as they already hold `# Arguments` and `- Parameters:`.

### The register gate — shape, never parity

Per entry (function, type, module, member, parameter). **It never compares one arm's lengths to another's** — a C++ description that must state ownership or lifetime where Python's need not is a real difference between languages and must be left alone (D11). The module doc says so in those words, so nobody re-adds a parity check later.

**Brief:**

1. present and non-empty;
2. **one line** — contains no `\n` at all (this is the structural check that would have caught the swallowed-paragraph bug independently of the extractor);
3. balanced inline code spans — an even number of backticks, and no unclosed `(`/`[`/`{` inside a span;
4. **no fenced block**;
5. **no second person** — no `you`/`your`/`yours` as words (the marker of the current narrative decay: *"This gets bytes for your PROGRAM and puts NOTHING in your context window"*);
6. **no ALL-CAPS emphasis** — no run of ≥2 consecutive all-caps words longer than 3 characters (acronyms pass, shouting does not);
7. **a generous sanity cap no honest brief in any language would reach** — 320 characters. An 834-character "brief" is wrong everywhere; 320 is roughly twice the longest defensible one-liner and is not a length-parity rule.
8. does not begin with a connective (`And`, `But`, `Also`, `Then`) — the signature of a brief that is really the tail of a paragraph.

**Detail (optional):**

1. if present, non-empty, and its first line is not a verbatim repeat of the brief;
2. no second person; no ALL-CAPS emphasis;
3. **at most one fenced example.** Fenced examples are *permitted* here deliberately: on five of six compiled arms the fenced `match`/`switch`/`when`/`std::get_if` block inside `read_file` is the only place the closed-union narrowing idiom is taught. Deleting them to satisfy "never narrative" would delete real teaching; capping them at one keeps the register.
4. a generous cap of 2,000 characters.

**Module and type briefs** obey the same brief rules. **Parameter docs** obey the brief rules minus the cap (they are already short and already presence-checked at `agreement.rs:683-711`).

The gate returns a `Vec<Complaint>` and is asserted empty per arm, like `disagreements` — so a rewrite sweep gets the whole list at once instead of one failure per run.

**What it deliberately does not check:** total prose volume per arm; the number of sentences in a detail; whether two arms' briefs say the same thing (that is spelling, and the coverage gate leaves it free by design).

---

## 10. Prompt + bootstrap

### The rewritten prompt (D8)

The prompt **names no functions, full stop.** `REQUIRED_CALLS` (`prompts.test.rs:2263`) is **retired, not retargeted** — the previous pass's proposal to point it at prompt+bootstrap is rejected, because it would force the bootstrap to name a call for every granted capability, which is exactly the immediate function information being ruled out.

What each capability section says instead: **that the agent has the capability, conceptually what it provides, and how it works** — and, crucially, **the module it lives in**. With objects abolished, `list` deleted and no function named, the module name is the **only** vocabulary the prompt supplies, and it is what makes D7+D8 safe. The chain is:

```
prompt names a module  →  search(module: …)  →  briefs  →  openDocView(fqn)  →  full docs
```

Search-by-module is an **exact lookup, not a ranking problem**, which is what materially de-risks D8's search-quality concern for the first hop.

Concretely in `crates/gg/src/prompts.rs`:

- `SystemContext::apis: Vec<ApiView>` (531-536) → `modules: Vec<ModuleView { path, brief, import }>`, projected from the catalogue's `modules` section (already reflected from each module's own header doc comment — D-brief's "source is the sole source of truth" holds for the prompt too).
- `Spellings { api, meta, libraries }` (335-349) loses `api` and `meta`; `spellings()` (383-435) shrinks to libraries only. Note it currently walks the **whole** catalogue with no `bound()` filter — that hazard disappears with the field.
- All 22 templates (`system-code.<lang>.hbs` × 11, `code-nothing-shown.<lang>.hbs` × 11) lose every `{{api.…}}` and `{{meta.…}}` reference — 22-26 per template. `REQUIRED_SECTIONS` (`prompts.test.rs:1690`) survives; the sections keep their headings and lose their call names.
- `prompts.spellings.test.rs`'s five rules shrink to two, both strictly stronger: **no template names any SDK function at all** (not merely "not by hand"), and no code-reachable template names a bare gg tool.
- One sentence must be added per arm and is not optional: *what the module names mean here* — "these are in scope already, with no `use` line of your own" (Rust), "`import Gg` brings them in" (PureScript), "these name where a function is documented; there is no import" (TypeScript/JavaScript).
- The prompt must also state the D-verdict(d) fact once: on a compiled arm, the SDK declares every function whatever this run enables, and calling one this run withheld fails when it runs.

### The replacement gate

`REQUIRED_CALLS` is replaced by a strictly better test, in `crates/gg/src/prompts.discoverability.test.rs`:

> **For every capability granted to an agent, a search over that capability's natural keywords returns at least one function that agent is permitted to call.**

```rust
/// The natural words a model reaches for when it wants a capability, per capability.
/// NOT function names, NOT per-language spellings — which is why this test runs identically
/// on all eleven arms and needed no maintenance when an SDK was reshaped.
const CAPABILITY_KEYWORDS: &[(&str, &[&str])] = &[
    (CAPABILITY_TASKS,              &["task", "todo", "blocked"]),
    (CAPABILITY_MEMORIES,           &["memory", "remember", "recall"]),
    (CAPABILITY_PROJECT_MANAGEMENT, &["issue", "epic", "board"]),
    (CAPABILITY_SUBAGENTS,          &["subagent", "delegate", "spawn"]),
    (CAPABILITY_PROGRAM_LIBRARY,    &["program", "rerun", "history"]),
    (CAPABILITY_SKILLS,             &["skill"]),
    (CAPABILITY_SHELL,              &["shell", "command"]),
    (CAPABILITY_READ_FILE,          &["read", "file"]),
    (CAPABILITY_WRITE_FILE,         &["write", "file"]),
    (CAPABILITY_EDIT_FILE,          &["edit", "replace"]),
    (CAPABILITY_LIST_DIR,           &["directory", "list"]),
    (CAPABILITY_AGENT_MANAGED_CONTEXT, &["archive", "evict", "context"]),
    (CAPABILITY_COMPACTION,         &["compact", "summar"]),
    (CAPABILITY_EXEC,               &["hand off", "successor"]),
    (CAPABILITY_FORK,               &["fork", "branch"]),
    (CAPABILITY_DOCVIEW_CLOSE,      &["close", "documentation"]),
];
```

For each registered language × each row: build a `DocsRuntime` for an agent granted **exactly** that capability, run `search(keyword)` for each keyword, assert ≥1 hit and that every asserted hit passes `bound()`. Plus the negative: with the capability **withheld**, its keywords return no hit for that capability's operations.

This verifies discoverability end-to-end instead of asserting a string appears in a prompt, needs no per-language call spellings, and runs identically on all eleven arms. **It is the mitigation for D8's accepted risk and must be treated as a first-class gate.** When it goes red the answer is to fix the SDK's brief wording or the ranking — never to weaken the assertion.

### The synthesized initial response

The mechanism already ships with two callers; do not budget for inventing it. `crates/gg/src/agent.rs:9035` and `:9058` push a fabricated assistant program during `autoload_specifications` (`open_file_program` at 9071-9090), and `crates/gg/src/persistence.rs:311-321` does the same on re-incarnation, one program per restored view.

`crates/gg/src/bootstrap.rs`, called once at session start for every code-mode agent, before the first user turn:

```
bootstrap_fqns = [ spell(language, DOCS_SEARCH), spell(language, DOCS_OPEN_DOC_VIEW) ]

context.push_assistant(Some(language.open_docs_views_statement(&bootstrap_fqns)), vec![]);
for fqn in bootstrap_fqns {
    let body = docs.render(fqn);
    context.open_docview(fqn.to_string(), body);
}
```

**It carries only the two bootstrap functions.** It does **not** carry one call per granted capability (D8). An agent that decides to use tasks searches for task functions and then uses them; that round trip is intended.

`ProgramLanguage::open_docs_views_statement` (`language.rs:443-458`) is already a required trait method on all eleven arms and already generates a whole program per language. It must be re-keyed from bare names to FQNs — an eleven-arm edit, and one that also touches the isolation gate, which uses it at `isolation.rs:426` as the canonical "whole program" fixture, and `skills.builtin.rs:373`, its only current consumer.

The bootstrap docviews are `Ephemeral` like every other docview (a pinned docview cannot be closed and would be invisible to `open_views`). They are the first two entries in the open set and, because docviews are append-only, they stay at that position for the life of the session — the head of the cached prefix.

---

## 11. Staged delivery

Each stage lands independently, keeps the tree green, and has a gate that proves it.

| # | Stage | Gate |
|---|---|---|
| **0** | **Measurements, no code shipped.** (a) Does `signature.starts_with(name)` (`agreement.rs:569`) hold for *member functions* on the C++ and Swift arms, whose reflectors emit from a comment AST / symbol graph that may lead with the return type? (b) Does clang parse `\brief` as its own node in this wasi-sdk pin? (c) Can Kotlin's PSI reflector resolve a type reference to an FQN, or must it move to analysis (D9)? | Three written answers. Every one of these, discovered in stage 4 instead of stage 0, is a redesign. |
| **1** | **`crates/gg/src/sandbox/operations.rs`** + `capability: Option<&'static str>` synthesized host-side from section membership; `DocsRuntime::bound` re-pointed; the `api_surface` duplicate deleted. **No arm touched.** | `const` bijection with `ALL_TOOL_NAMES`; the whole existing suite green. |
| **2** | **Docview mechanism (D1-D4) on today's bare-name catalogue.** `GgContextSource::DocsView`; `open_docview` with no supersession; `close_docview`/`close_docviews` gated by `CAPABILITY_DOCVIEW_CLOSE`; `view.close` stops sweeping docs; caps; compaction/persistence/archival survival. | `context.docviews.test.rs`: re-opening an open docview leaves the **rendered prompt byte-identical** and the item at the same index (the D4 no-move assertion); closing a type leaves every function docview; re-opening after close re-places at the tail; archival retains docviews; a compaction round-trips the open set by FQN. |
| **3** | **Search over today's catalogue** + `crates/gg/src/search.rs` + WIT `docs.search` + `FunctionSummary` → `doc-hit`. `list` still present. | Search unit tests (substring, folding, tiers, stability, pagination `total`); the §10 discoverability gate — **it can and should land before the prompt change**, so the prompt rewrite is made against a gate that is already green. |
| **4** | **Per-arm: reshape + schema v2 + regenerate, one commit per arm** (schema-version dispatch keeps the other arms on v1 meanwhile). Order: **C#** (no committed binary for the SDK — cheapest to iterate), **Rust**, **C++**, **PureScript**, **Python**, **Ruby**, then **TypeScript+JavaScript+Java+Kotlin together** (the TeaVM bridge couples them), then **Swift** last (thirteen modules, `@_exported` chain). Each commit carries: the idiomatic reshape (§5b), authored brief/detail, module + resolved-type-FQN emission, the arm's regenerated catalogue, and its manual archive re-cut where one exists (`rust.libraries.tar.gz`, `swift.guest.tar.gz`, `cpp.guest.tar.gz`, the C# component). Java's commit **must** fix `build.sh:71`'s doclint glob. | `contract-drift.sh` (schema-version assertion + the existing diff); the register gate (§9); the FQN round-trip test (`openDocView(fqn)` resolves for every catalogued entry on this arm); the arm's `*.surface.test.rs`. |
| **5** | **`list` deleted** (D7): the meta section, `MetaSignature`, `meta_function()`, `LIST_FUNCTION` and its 15 non-test references, `agreement.rs:348-364`, the per-object `list` declarations in every SDK tree (C++ spans 16 files; C# generates), the `reference.rs:519,543` fold, the `agent.rs:8506,8550,8565` surface fold. | Zero `LIST_FUNCTION` references; `reference.test.rs`'s `every_catalogued_function_appears` count updated to `catalogued.len()` with no `+ objects.len()`. |
| **6** | **The re-founded agreement gate** (§5b.3) — the comparative half deleted, coverage/gate/takes-input/propagation in its place, driven by the **reshaping fixture** built in this stage before anything else in it. | `agreement.test.rs` rewritten: the fixture must be made to fail on a missing operation, a dead exemption, a duplicate canonical binding, a takes-input mismatch — and to **pass** on a legitimate reshape (different receiver, different count, an alias). |
| **7** | **Static SDKs** (§8): four guest scope builders inverted, four components rebuilt by hand, the membrane refusal re-worded, the component source-hash manifest added. | The new manifest test; per-arm substrate tests flipped from `UnknownName` to `unavailable`; a run on each of the four arms observed calling a withheld function and reading a spelled refusal. |
| **8** | **Prompt + bootstrap** (§10): 22 templates stripped, `Spellings.api`/`meta` deleted, `REQUIRED_CALLS` deleted, `bootstrap.rs` added. | `prompts.spellings.test.rs`'s two surviving rules; the discoverability gate (green since stage 3); `every_language_renders_a_complete_system_prompt`; a rendered prompt per arm read by a human once. |
| **9** | **The D5 knob + telemetry/console/reference**: `DocViewTypes` resolved per agent and reported; `ApiCall` gains `operation`; `GgAgentApi` gains `module`; the Reference projection and its committed artifact regenerated; the console's Tools/APIs panel re-pointed. | Contract regeneration diff; a run per mode observed opening the expected transitive set. |

**Riskiest stage: 4, and within it the reshape half of §5b — with Swift the single riskiest arm and Java+Kotlin+JavaScript the riskiest commit.** Reasons, in order: Swift requires thirteen separate compilations and a thirteen-deep `@_exported` re-export chain on an *underscored, unofficial* attribute whose transitivity through an umbrella has historically been the shakiest case — it must be proven by a compiled program, not by reading. Java+Kotlin+JavaScript cannot be split, so a defect in any of the three blocks all three. And every arm in stage 4 introduces flat-name collisions into the **model's own reply** (Ruby's `Kernel#system`/`exec`/`fork`, Python's `list`/`exec`, TypeScript's `new Function` parameter redeclaration, Java/Kotlin's on-demand-import ambiguity, PureScript's `Prelude` clash) — a cross-arm name audit is a prerequisite for the stage, not a step inside it.

**Stage 6 is a close second** because it is the stage where a mistake is *silent*: a coverage gate written slightly too loosely still passes on eleven green arms and stops catching the thing it exists for. That is why the reshaping fixture is built first and why the gate's negative controls are the acceptance criterion rather than its positive ones.

---

## 12. Open decisions for the owner

> **All eight are now CLOSED — see §0.2 for the authoritative answers.** This section is retained
> as the rationale that produced them, not as live questions. Where a recommendation below differs
> from §0.2, §0.2 wins.

1. **Brief defect: repair `first_sentence` or require an authored brief/detail split?** *Recommend: authored split, and delete the derivation entirely* (§9). It is what the brief asks for, C# and Java give it nearly free, C++ gives it natively once `\brief` is taught, and a deleted derivation cannot re-break in a new place. The cost is real: ~500 doc strings × 10 SDKs get a structural edit rather than a 10-line fix. The fallback, if stage 4 must be shortened, is to repair `first_sentence` (terminate on `.` + whitespace-or-EOS, and never inside an unbalanced code span) and take authored briefs only where the extractor already hands one over — but that leaves a silent fallback path in the tree.

2. **How far does the static-SDK inversion go, given four hand-built components CI cannot rebuild?** Options: (a) full inversion on all four dynamic arms + the source-hash manifest gate (recommended); (b) partial — invert the *declared* surface (TypeScript's `gg.d.ts`, Python's `__all__`, the SDK packages) but leave the guest scope dynamic, so a withheld call is still an undefined identifier at run time; (c) leave the four arms as they are and document the asymmetry. (a) costs four manual rebuilds and a new gate; (c) leaves a genuine cross-arm behavioural difference sitting inside a cross-language study.

3. **Module granularity: one module per toggleable capability, or per related-function-family?** *Recommend: family-grained* — the 12-id vocabulary in §3, which matches the existing `catalogue.ts` module names and `skills.builtin.rs`'s eleven `FAMILIES`, plus `docs`. Capabilities are finer than families (`read-file`, `write-file`, `edit-file`, `list-dir` are four capabilities and one family), so capability-grained modules would produce four one-function modules for the filesystem and make the prompt's module list longer than the function list it replaced. The cost of family-grained is that a module can be *partially* bound, so the prompt names a module the agent can only partly use — acceptable, and search already filters correctly.

4. **How is search ranking tuned and validated?** Fork: (a) the tiered scheme in §7 with no tuning surface, validated by the §10 discoverability gate alone; (b) the same plus a **committed relevance golden file** — a per-language table of `(query, filter) → expected top-3 FQNs` regenerated by a script and diffed by `contract-drift.sh`, so a ranking change that silently reorders results fails by name; (c) a weighted-score scheme with tunable field weights exposed as RaC params. *Lean (b)*: it costs one artifact and makes ranking regressions visible, and it is the only way to know that stage 4's per-arm reshape did not quietly break discoverability on one arm. (c) adds a tuning variable to a study that already has enough.

5. **Do search results also open a superseding results view, or return a value only?** §7.6 recommends both (value + one superseding `Search results` view). Value-only is cheaper and consistent with what `list` was, but it makes every search cost an `openText` op to actually read, and a paginated loop then burns `MAX_OPEN_TEXT_VIEWS`. The counter-argument for value-only: it keeps the docs band purely append-only, whereas a superseding results view leaves one corpse per search.

6. **Does `log` stay outside the catalogue?** `gg::log` / `gg.log` / `Gg.Log` is a public function on every arm and is deliberately uncatalogued ("it belongs to no API object"). With objects abolished it *could* belong to a module, and a search advertised as covering the SDK surface will not find it. Either catalogue it under `docs`/`session`, or state the hole in search's own documentation. Small, but it is a promise the model will test.

7. **Does a transitive placement charge a view op?** §6.7 recommends one op **per call**, so the op budget means "how many view calls" and is identical across the three D5 modes. The alternative — one op per placed view — makes a `ReturnAndParameters` agent's budget structurally smaller than an `Off` agent's, confounding the A/B on a dimension unrelated to what it measures. If the owner prefers per-placement, `MAX_VIEW_OPS_PER_PROGRAM` should be raised in proportion.

8. **Java's `docs.search`: `Reference.current().search(…)` or a static `Reference.search(…)`?** D10 says Java gets objects with member functions, and consistency argues for `current()`. But documentation search is a stateless lookup with no receiver state, and a static there is honest Java of the `Objects.requireNonNull` kind — and it is the very first call an agent makes when it is lost, so the extra hop is paid at the worst moment. This is the one place D10's letter and Java's ordinary taste pull apart, and it should be the owner's call rather than the implementer's.