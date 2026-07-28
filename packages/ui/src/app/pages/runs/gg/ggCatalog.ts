// The shared gg capability catalog — the single in-console description of gg's full
// capability set. Both the configuration editor (`GgConfigEditor`) and the
// result-aggregation surface (`GgAggregatePage`) drive off this one list so the
// facets a query can slice by stay in lockstep with the capabilities a run can be
// configured with. The ids, params, and tool names are the real core contract
// (`crates/core/src/gg.rs` + `crates/gg/src/tools/mod.rs`), not guesses.

import type {
  GgCapabilitySet,
  GgHealingStrategy,
  GgRunLimits,
  GgSubagentScope,
} from "@test-cabinet/run-record/gg";

// Whether a run's capability set has the named capability on. Capabilities are
// per-agent now, so a run-level "is X on?" question is answered by the **Root** agent
// (agents[0]) — the profile that drives the top-level session.
export function capabilityOn(set: GgCapabilitySet | null, id: string): boolean {
  return (
    set?.agents?.[0]?.capabilities.some((c) => c.id === id && c.enabled) ??
    false
  );
}

// The conventional name of the Root agent — the unremovable first profile that drives
// the run's top-level session, and the default target for the Code Review and
// speculation-judge helpers. (A board issue names its own agent when it is filed, so it
// is not one of them.) Mirrors `ROOT_AGENT` in `crates/core/src/gg.rs`.
export const ROOT_AGENT = "Root";

// The conventional name of the first model slot a fresh configuration declares — the
// launch input the Root agent's model defers to by default. Kept for the New run
// page's launch-summary heuristic and the draft's default model-slot name.
export const PRIMARY_SLOT = "primary";

// The concern each capability belongs to, and the group render order + which start
// collapsed (the entirely opt-in, off-by-default groups) so the config form is not
// an 18-row wall on open.
export type CapGroup =
  | "Context"
  | "Filesystem"
  | "Knowledge"
  | "Work tracking"
  | "Delegation"
  | "Process & quality"
  | "Models & tools"
  | "Debugging";

export const CAP_GROUPS: ReadonlyArray<{
  group: CapGroup;
  startOpen: boolean;
}> = [
  { group: "Models & tools", startOpen: true },
  { group: "Filesystem", startOpen: true },
  { group: "Context", startOpen: true },
  { group: "Knowledge", startOpen: true },
  { group: "Work tracking", startOpen: true },
  { group: "Delegation", startOpen: false },
  { group: "Process & quality", startOpen: false },
  { group: "Debugging", startOpen: false },
];

// A dedicated param control on a capability. `kind` picks the input + how the value
// coerces into the JSON params object: fraction/number/bytes → a JSON number,
// select → a JSON string (an empty selection omits the param entirely), text → a
// JSON string of whatever was typed (an empty field omits the param), toggles → a
// JSON object of `{ option: false }` for every option switched *off* (see
// [TOGGLES_HINT]), boolean → `true` when switched on and no key at all when off (so
// its default arm is the absent key, for the same reason `toggles` records only what
// was switched off).
//
// Every param gg actually reads has a control here — there is deliberately no raw
// JSON escape hatch in the editor, since the console knows gg's whole param schema.
// A param a *stored* configuration carries that no control here covers (a key from a
// newer client, or a legacy one) is preserved verbatim through a round-trip rather
// than shown, so reopening and saving never drops it.
export interface ParamSpec {
  key: string;
  label: string;
  // `agent` renders a <select> over the configuration's own agent names (value = the
  // agent name, coerced to a JSON string param), so a param can point at an agent
  // profile — how the run-level "which agent runs this?" knobs (issue/reviewer/judge)
  // are configured. The list of choices is threaded in by the editor.
  // A `boolean` param is a **feature switch**, not a value: it renders beside the
  // per-feature tool-ablation sliders (the "Features" box) rather than in the param
  // grid, because what it varies is what an offered tool demands rather than a
  // number the tool reads.
  kind:
    | "fraction"
    | "number"
    | "bytes"
    | "select"
    | "text"
    | "toggles"
    | "boolean"
    | "agent";
  hint?: string;
  placeholder?: string;
  // The value gg falls back to when this param is left unset, seeded into the field
  // of a fresh configuration so an operator sees the real default rather than an
  // empty box. Set only where the param has a genuine, documented default (not an
  // "e.g." example); an unset field still means "gg's default", so clearing a seeded
  // field is exactly leaving it empty. `toggles` params seed nothing (their default
  // arm is the empty string already).
  defaultValue?: string;
  // The closed set of values a `select` offers, or the independently switchable
  // members a `toggles` param is made of.
  options?: ReadonlyArray<{ value: string; label: string }>;
}

// Why a `toggles` param writes only the switched-*off* members: the underlying gg
// params are "on unless a configuration says otherwise", so an absent key is the
// default arm of the ablation and writing `{ "strip-fences": true }` for a member
// nobody touched would turn every saved configuration into an explicit opt-in that
// a later default change could no longer reach.
const TOGGLES_HINT =
  "Every repair is on unless you switch it off; only the ones you switch off are recorded.";

export interface CapSpec {
  id: string;
  name: string;
  group: CapGroup;
  purpose: string;
  // Part of the default (minimal) capability set — on when the config form first
  // opens.
  defaultOn?: boolean;
  // The capability offers alternate implementations (the A/B lever); when set, a
  // free-text implementation field is shown, labelled with this.
  implementationLabel?: string;
  implementationPlaceholder?: string;
  // When the implementations are a known, closed set (rather than a strategy name
  // gg resolves at run time), the field becomes a picker over these instead of free
  // text — an operator should not have to remember how a mode is spelled. An empty
  // `value` is the capability's default implementation. Option labels stay terse
  // (the mode's name); what each mode does belongs in `implementationHint`.
  implementationOptions?: ReadonlyArray<{ value: string; label: string }>;
  // The help-tooltip text for the implementation field — what the modes mean, kept
  // off the picker's option labels so the dropdown reads as a list of names.
  implementationHint?: string;
  // Dedicated param controls; anything else goes in the generic JSON editor.
  params?: ReadonlyArray<ParamSpec>;
  // The tool names this capability offers — a run's toolset withholds individual
  // ones from this list (see `toolAblation`), and the analyze page offers them as
  // `toolOffered` facet targets.
  tools?: ReadonlyArray<string>;
  // The capability's individually-ablatable sub-features, surfaced as per-feature
  // sliders in its expanded config. Each entry is one slider that withholds (or
  // restores) its whole `tools` list at once — so a slider maps to a coherent
  // feature a study would actually vary, not a raw tool. Tools that are only
  // meaningful together share one slider, and a capability's core tools (the ones
  // that come with it) are deliberately absent, so no slider can leave the
  // capability in a state nobody would run. A capability whose toolset is atomic
  // (planning's plan/submit pair) declares none, and the capability toggle is its
  // only granularity.
  toolAblation?: ReadonlyArray<{
    label: string;
    tools: ReadonlyArray<string>;
    hint?: string;
  }>;
}

// The legacy umbrella capability the four filesystem tool capabilities were split out
// of. Nothing writes it any more, but capability sets saved before the split still
// name it, so the editor expands one into the four (and the backend/gg treat it as an
// alias). Kept here as a named constant so that migration has one spelling.
export const LEGACY_FILESYSTEM_CAP_ID = "filesystem";

// The per-tool filesystem capabilities, in editor order — the modern spelling of
// [LEGACY_FILESYSTEM_CAP_ID].
export const FILESYSTEM_CAP_IDS = [
  "read-file",
  "write-file",
  "edit-file",
  "list-dir",
] as const;

// How much of a file one `read_file` call returns — the read-file capability's
// implementation, and the first per-tool A/B lever the split exists to allow. The
// values are gg's implementation ids (`crates/gg/src/tools/filesystem.rs`); the empty
// value is the default (unlimited), which is what gg has always done.
export const READ_MODE_OPTIONS = [
  { value: "", label: "Unlimited (default)" },
  { value: "hard-cap", label: "Hard cap" },
  { value: "default-cap", label: "Default cap" },
] as const;

// What each read mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const READ_MODE_HINT =
  "Unlimited returns the whole file in one call. Hard cap never returns more than the line cap per call. Default cap returns the line cap unless the model asks for more.";

// The line cap gg falls back to when a capped read mode names none.
export const DEFAULT_READ_LINE_CAP = 250;

// Where a `shell` command's output goes — the shell capability's implementation. The
// values are gg's implementation ids (`crates/gg/src/tools/shell.rs`); the empty value
// is the default (inline), which is what gg has always done. Offloading writes every
// command's stdout and stderr to a file pair under `/tmp/gg/shell` and returns only the
// configured tail, so a chatty build cannot spend a large slice of the window in one
// call.
export const SHELL_OUTPUT_OPTIONS = [
  { value: "", label: "Inline (default)" },
  { value: "offload", label: "Offload to files" },
] as const;

// What each output mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const SHELL_OUTPUT_HINT =
  "Inline returns the whole output (capped at 16 KiB) and writes nothing to disk. Offload writes every command's full stdout and stderr to a file pair under /tmp/gg/shell, returns only the last N lines and/or characters, and tells the agent where to grep for the rest. Offloading needs at least one of the two ceilings below; with neither, gg warns at launch and runs inline.";

// Whether the autoload-specifications capability **locks** the injected specs into the
// window. The values are gg's implementation ids (`crates/core/src/gg.rs`); the empty
// value is the default (not locked — ordinary, droppable file reads), and `locked` pins
// them across compaction and eviction.
export const AUTOLOAD_LOCKED_OPTIONS = [
  { value: "", label: "Not locked (default)" },
  { value: "locked", label: "Locked" },
] as const;

// What the locked lever does — the detail lifted off the picker's option labels into the
// field's help tooltip.
export const AUTOLOAD_LOCKED_HINT =
  "Not locked injects the specs as ordinary file reads that compaction may summarize away and agent-managed context may evict. Locked pins them into the window verbatim across every compaction boundary and spares them from eviction.";

// The response-healing strategies, in the order gg's pipeline applies them — the
// conservative, deletion-only repairs gg makes to a model's reply before running it
// as a program. Each is independently switchable, and switching one off is an
// ablation arm in its own right ("how much worse does this model do when we stop
// unwrapping its fences?"), which is why they are toggles in the form rather than a
// single on/off for the lot.
//
// `value` is typed as the contract's `GgHealingStrategy`, so a strategy added to or
// renamed in `crates/core/src/gg.rs` is a compile error here rather than a control
// that writes a key gg reports as unknown.
export const HEALING_STRATEGY_OPTIONS: ReadonlyArray<{
  value: GgHealingStrategy;
  label: string;
}> = [
  {
    value: "strip-fences",
    label: "strip-fences — unwrap a Markdown code fence around the whole reply",
  },
  {
    value: "strip-prose",
    label: "strip-prose — drop explanatory text before or after the program",
  },
  {
    value: "drop-duplicate-program",
    label:
      "drop-duplicate-program — delete a second, identical copy of the program in one reply",
  },
  {
    value: "drop-imports",
    label:
      "drop-imports — drop import/require lines; every tool is already in scope",
  },
  {
    value: "unwrap-async",
    label:
      "unwrap-async — unwrap an async wrapper and its awaits; every tool is synchronous",
  },
  {
    value: "strip-comment-only",
    label:
      "strip-comment-only — treat a reply that is only comments as no program at all",
  },
];

// How the assistant message a code turn records is derived from the model's reply
// (`crates/gg/src/healing.rs`). Under responses-as-code the reply is a program healing
// rewrites before running, so the transcript can store either what the model *sent* or
// what gg actually *ran* — a lever a study slices on. The empty value is gg's default
// (no post-processing), so leaving the field alone changes nothing.
export const ASSISTANT_MESSAGE_OPTIONS = [
  { value: "", label: "No post-processing (default)" },
  { value: "response-healing", label: "Post-response healing" },
] as const;

// What each assistant-message mode does — the detail lifted off the picker's option
// labels into the field's help tooltip.
export const ASSISTANT_MESSAGE_HINT =
  "No post-processing records the reply exactly as the model sent it (healing still runs and is disclosed, but its output is not stored). Post-response healing records the healed program gg actually ran whenever healing changed the reply, and the reply verbatim when it did not.";

// The workspace-relative directory gg reads authored skills from when a
// configuration names none (`crates/gg/src/skills.rs`).
export const DEFAULT_SKILLS_DIR = ".gg/skills";

// The bounds gg falls back to when a configuration sets no cap, mirroring the
// per-capability defaults in `crates/gg/src/{tasks,board,memories}.rs`. Surfaced as
// placeholders so an operator sees what leaving a field empty means.
export const DEFAULT_MAX_TASKS = 100;
export const DEFAULT_MAX_EPICS = 50;
export const DEFAULT_MAX_ISSUES = 2000;
// How many times gg re-dispatches a failed issue before marking it `failed`
// (`crates/gg/src/board.rs`). Surfaced as the project-management capability's
// `maxRetries` default so an operator sees what leaving the field empty means.
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_MEMORY_MAX_COUNT = 8;
export const DEFAULT_MEMORY_MAX_LEN_PER = 2000;
export const DEFAULT_MEMORY_MAX_TOTAL_LEN = 8000;
export const DEFAULT_MEMORY_MAX_LEN_INDEX = 16384;
export const DEFAULT_MEMORY_MAX_RESULTS = 25;

// How a run's memories are organized (`crates/gg/src/memories.rs`) — the memory
// strategy, which decides which memory tools exist, which of the limits apply, and
// what the context window carries. The values are gg's strategy ids; the empty value
// is the default (`scratchpad`), which is what an unrecognized name resolves to too.
export const MEMORY_STRATEGY_OPTIONS = [
  { value: "", label: "Scratchpad (default)" },
  { value: "markdown", label: "Markdown + index" },
  { value: "keyword-search", label: "Keyword search" },
] as const;

// What each memory strategy does — the detail lifted off the picker's option labels
// into the field's help tooltip.
export const MEMORY_STRATEGY_HINT =
  "Scratchpad keeps every memory's body in the context window, bounded by a count and an aggregate character budget. Markdown pins only an index of slugs and descriptions, and the model reads a memory's contents on demand; the index length is what bounds the population. Keyword search pins nothing at all — the model finds a memory with `search_memories` and reads it back. Under every strategy the memories live inside gg, never on disk.";

// The two shapes the tasks list can take (`crates/gg/src/tasks.rs`): the default
// **simple** mode is a bare title/description to-do list, while **issues** mode
// requires the same structured sections (in-scope / out-of-scope / completion
// criteria) a board issue carries, so a task is scoped enough to hand off. The value
// is gg's mode id; `simple` is the default and is seeded so a fresh field shows it.
export const TASKS_MODE_OPTIONS = [
  { value: "simple", label: "Simple" },
  { value: "issues", label: "Issues (structured)" },
] as const;

// What each tasks mode does — the detail lifted off the picker's option labels into
// the Mode field's help tooltip.
export const TASKS_MODE_HINT =
  "Simple keeps a lightweight title/description to-do list. Issues requires each task to carry the structured in-scope / out-of-scope / completion-criteria sections a board issue does.";

// What a roster entry may be used for, in editor order — the three
// [scopes](GgSubagentScope) an agent's roster entry can carry. They are independent:
// a profile trusted to implement an issue is not automatically trusted to review it,
// and an agent may list targets it can only assign work to without being able to
// spawn anything at all.
export const SUBAGENT_SCOPES: ReadonlyArray<{
  value: GgSubagentScope;
  label: string;
  hint: string;
}> = [
  {
    value: "subagent",
    label: "Subagent",
    hint: "May be spawned with `spawn_subagent`, a workflow stage, or a speculation. Needs the Subagents capability to be reachable.",
  },
  {
    value: "implementer",
    label: "Implementer",
    hint: "May be named as an issue's `agent` — the profile gg dispatches to do the work, and re-dispatches for each retry and review round.",
  },
  {
    value: "reviewer",
    label: "Reviewer",
    hint: "May be named among an issue's `reviewers` — the profiles that must each approve the finished work before the issue is accepted.",
  },
];

export const FSM_MACHINE_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "tdd", label: "tdd" },
  { value: "plan-first", label: "plan-first" },
] as const;

// What each state machine does — the detail lifted off the picker's option labels
// into the Machine field's help tooltip.
export const FSM_MACHINE_HINT =
  "None runs no state machine. tdd: write tests → implement → verify. plan-first: plan pass → implement pass.";

// The compaction strategies gg resolves at run time (`crates/gg/src/compaction.rs`),
// in editor order — grouped by who condenses the thread: gg out of band on the run's
// own model (the first two), the working agent itself (the next two and the last),
// or a separate handoff model. An unrecognized name falls back to the default rather
// than failing to launch, so the field stays a closed picker rather than free text.
export const SUMMARIZER_OPTIONS = [
  { value: "", label: "Model summary (default)" },
  { value: "structured", label: "Structured extract" },
  { value: "self-summarization", label: "Self-summarization" },
  { value: "self-compaction", label: "Self-compaction" },
  { value: "handoff-summarization", label: "Handoff summarization" },
  { value: "handoff-compaction", label: "Handoff compaction" },
  { value: "memory-compaction", label: "Memory compaction" },
] as const;

// What each compaction strategy does — the detail lifted off the picker's option
// labels into the field's help tooltip.
export const SUMMARIZER_HINT =
  "Model summary and Structured extract condense the thread out of band on the run's own model — prose, or the same state under fixed headings. Self-summarization asks the agent, in its own thread, to write the summary its next context is rebuilt from. Self-compaction gives the agent a `compact` tool it calls with a summary AND the files to re-read, so it chooses what survives. The two Handoff strategies do the same two jobs on a separate model (set below), which reads the thread as labelled messages and never interrupts the agent. Memory compaction requires Memories: the agent writes its working state to memories instead of a summary, and those cross the boundary verbatim.";

export const CAPABILITIES: ReadonlyArray<CapSpec> = [
  // --- Models & tools ---------------------------------------------------------
  {
    id: "shell",
    name: "Shell",
    group: "Models & tools",
    purpose:
      "Run shell commands in the run container — build, test, drive tooling.",
    defaultOn: true,
    implementationLabel: "Output mode",
    implementationOptions: SHELL_OUTPUT_OPTIONS,
    implementationHint: SHELL_OUTPUT_HINT,
    params: [
      {
        key: "maxLines",
        label: "Max lines",
        kind: "number",
        placeholder: "e.g. 200",
        hint: "Trailing lines returned inline when output is offloaded; ignored under the inline mode. Set this, Max characters, or both.",
      },
      {
        key: "maxChars",
        label: "Max characters",
        kind: "number",
        placeholder: "e.g. 8000",
        hint: "Trailing characters returned inline when output is offloaded; ignored under the inline mode. With both set, the tighter one decides.",
      },
    ],
    tools: ["shell"],
  },
  // --- Filesystem -------------------------------------------------------------
  //
  // One capability per filesystem primitive rather than a single `filesystem`
  // umbrella: each tool is its own experimental variable, with its own
  // implementation and params. Capability sets saved before the split name the
  // umbrella; `draftFromCapabilitySet` expands one into these four.
  {
    id: "read-file",
    name: "Read file",
    group: "Filesystem",
    purpose: "Read a file from the run's workspace.",
    defaultOn: true,
    implementationLabel: "Read mode",
    implementationOptions: READ_MODE_OPTIONS,
    implementationHint: READ_MODE_HINT,
    params: [
      {
        key: "lineCap",
        label: "Line cap",
        kind: "number",
        defaultValue: String(DEFAULT_READ_LINE_CAP),
        hint: "Lines per call under either capped mode; ignored when the mode is unlimited.",
      },
    ],
    tools: ["read_file"],
  },
  {
    id: "write-file",
    name: "Write file",
    group: "Filesystem",
    purpose: "Create or overwrite a whole file in the run's workspace.",
    defaultOn: true,
    tools: ["write_file"],
  },
  {
    id: "edit-file",
    name: "Edit file",
    group: "Filesystem",
    purpose:
      "Patch a file by exact, unique string replacement — the alternative to rewriting it whole.",
    defaultOn: true,
    tools: ["edit_file"],
  },
  {
    id: "list-dir",
    name: "List directory",
    group: "Filesystem",
    purpose: "List a directory's entries in the run's workspace.",
    defaultOn: true,
    tools: ["list_dir"],
  },
  {
    id: "responses-as-code",
    name: "Responses as code",
    group: "Models & tools",
    purpose:
      "The agent's whole reply is a TypeScript program over the tools, run in a wasm sandbox instead of one discrete tool call at a time, ending the run by calling `finish` from inside a program.",
    params: [
      {
        key: "timeoutSecs",
        label: "Execution timeout (seconds)",
        kind: "number",
        placeholder: "e.g. 30",
        hint: "Wall-clock ceiling on one program's guest execution — a runaway-loop guard, not a work ration, so it is far longer than any program needs. Time parked in a tool call is excluded.",
      },
      {
        key: "maxMemoryBytes",
        label: "Max memory (bytes)",
        kind: "bytes",
        placeholder: "e.g. 67108864",
      },
      {
        key: "healing",
        label: "Response healing",
        kind: "toggles",
        options: HEALING_STRATEGY_OPTIONS,
        hint: `Repairs gg makes to a reply before running it — deletion only, so a healed program is always a subsequence of what the model sent, and every repair is disclosed to the model in its turn feedback. ${TOGGLES_HINT}`,
      },
      {
        key: "assistantMessages",
        label: "Assistant messages",
        kind: "select",
        options: ASSISTANT_MESSAGE_OPTIONS,
        hint: ASSISTANT_MESSAGE_HINT,
      },
    ],
  },
  // --- Context ----------------------------------------------------------------
  {
    id: "context-window-override",
    name: "Context Window Override",
    group: "Context",
    purpose:
      "Run the model against a smaller context window than its real one — the way to exercise compaction on a million-token model without paying for a million tokens. Off by default: the model runs against its full catalog window.",
    defaultOn: false,
    params: [
      {
        key: "windowLimit",
        label: "Window limit (tokens)",
        kind: "number",
        placeholder: "e.g. 100000",
        hint: "The window to run the model against, in tokens. Can only narrow: a value above the model catalog's figure for the model is clamped to it, and 0 (or blank) applies no override.",
      },
    ],
  },
  {
    id: "autoload-specs",
    name: "Autoload specifications",
    group: "Context",
    purpose:
      "Seed an agent's opening context with the full contents of every file the test case provided — its specification and reference images — as though it had already read each, so the whole brief is in the window from the first turn.",
    implementationLabel: "Locked",
    implementationOptions: AUTOLOAD_LOCKED_OPTIONS,
    implementationHint: AUTOLOAD_LOCKED_HINT,
  },
  {
    id: "compaction",
    name: "Compaction",
    group: "Context",
    purpose:
      "Summarize-and-restart backstop that lets a run continue past the model's context window.",
    implementationLabel: "Summarization strategy",
    implementationOptions: SUMMARIZER_OPTIONS,
    implementationHint: SUMMARIZER_HINT,
    params: [
      {
        key: "summaryHeadroom",
        label: "Summary headroom",
        kind: "fraction",
        defaultValue: "0.2",
        hint: "Fraction of the window held back from the agent so the summarization call — which reads the whole thread and writes a summary — fits. This also defines the trigger: a compaction fires once the window is 1 − headroom full (the working window is full and only the headroom remains).",
      },
      {
        key: "model",
        label: "Compaction model",
        kind: "text",
        placeholder: "e.g. openai/gpt-4.1-mini",
        hint: "Only used by the two Handoff strategies: the model that condenses the thread instead of the agent. Leave blank (or name a model that will not resolve) and gg condenses on the agent's own model rather than skipping the compaction.",
      },
    ],
    tools: ["compact"],
  },
  {
    id: "agent-managed-context",
    name: "Agent-managed context",
    group: "Context",
    purpose:
      "The agent reclaims window space itself — evicting file views and archiving (searchable) thread sections.",
    tools: ["evict_file_view", "archive_thread", "search_archive"],
    toolAblation: [
      { label: "Evict file views", tools: ["evict_file_view"] },
      {
        label: "Archive & search the thread",
        tools: ["archive_thread", "search_archive"],
        hint: "Archiving and its search go together — archiving without a way to search it back just buries context.",
      },
    ],
  },
  // --- Knowledge --------------------------------------------------------------
  {
    id: "skills",
    name: "Skills",
    group: "Knowledge",
    purpose:
      "Authored markdown skills whose descriptions are shown up front and bodies survive compaction once read.",
    defaultOn: true,
    params: [
      {
        key: "dir",
        label: "Skills directory",
        kind: "text",
        defaultValue: DEFAULT_SKILLS_DIR,
        hint: "Where in the workspace gg reads authored skills from. Relative paths are joined onto the workspace; an absolute path is used as-is.",
      },
    ],
    tools: ["read_skill"],
  },
  {
    id: "memories",
    name: "Memories",
    group: "Knowledge",
    purpose:
      "The model's own bounded, self-curated notes, retained across a compaction boundary.",
    defaultOn: true,
    implementationLabel: "Memory strategy",
    implementationOptions: MEMORY_STRATEGY_OPTIONS,
    implementationHint: MEMORY_STRATEGY_HINT,
    // Every limit is offered under every strategy: gg ignores the ones the chosen
    // strategy does not use rather than rejecting them, so one saved capability set
    // can be swept across all three arms without editing its params each time. Zero
    // means unlimited everywhere.
    params: [
      {
        key: "maxCount",
        label: "Max memories",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_COUNT),
        hint: "How many notes the model may keep at once. Scratchpad and keyword-search only — a markdown run is bounded by its index instead, since every memory needs a line in it. 0 for unlimited.",
      },
      {
        key: "maxLenPerMemory",
        label: "Max length each (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_PER),
        hint: "Character ceiling on any one note's body. Defaults to 8192 under the two file-shaped strategies, whose bodies are not in the window. 0 for unlimited.",
      },
      {
        key: "maxTotalLen",
        label: "Max length total (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_TOTAL_LEN),
        hint: "Character ceiling across all note bodies together. Scratchpad only — it is the budget for what the window carries. 0 for unlimited.",
      },
      {
        key: "maxLenIndex",
        label: "Max index length (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_INDEX),
        hint: "Character ceiling on the pinned index. Markdown only, where it is the real budget: a create whose entry would not fit is refused, which is what bounds how many memories the run can hold. 0 for unlimited.",
      },
      {
        key: "maxLenDescription",
        label: "Max description length (chars)",
        kind: "number",
        placeholder: "unlimited",
        hint: "Character ceiling on a memory's one-line description, under every strategy. Off unless set — worth setting on a markdown run, where every description is a line of the pinned index and a verbose one costs the window on every turn.",
      },
      {
        key: "maxResults",
        label: "Max search results",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_RESULTS),
        hint: "How many memories one `search_memories` call reports. Keyword-search only. 0 for unlimited.",
      },
    ],
    tools: [
      "write_memory",
      "update_memory",
      "create_memory",
      "read_memory",
      "edit_memory",
      "search_memories",
      "delete_memory",
    ],
    toolAblation: [
      {
        label: "Revise memories",
        tools: ["update_memory", "edit_memory", "delete_memory"],
        hint: "Off leaves memories append-only — the model can write new notes but not edit or delete one.",
      },
    ],
  },
  // --- Work tracking ----------------------------------------------------------
  {
    id: "tasks",
    name: "Tasks",
    group: "Work tracking",
    purpose:
      "A lightweight to-do list (a blocked-by DAG) that survives compaction verbatim.",
    defaultOn: true,
    params: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        defaultValue: "simple",
        hint: TASKS_MODE_HINT,
        options: TASKS_MODE_OPTIONS,
      },
      {
        key: "maxTasks",
        label: "Max tasks",
        kind: "number",
        defaultValue: String(DEFAULT_MAX_TASKS),
        hint: "How many tasks the list may hold at once.",
      },
    ],
    tools: [
      "add_task",
      "update_task",
      "set_blocked_by",
      "complete_task",
      "remove_task",
    ],
    toolAblation: [
      {
        label: "Task dependencies",
        tools: ["set_blocked_by"],
        hint: "Off makes the list flat — tasks can't be marked blocked-by one another.",
      },
      { label: "Revise tasks", tools: ["update_task", "remove_task"] },
    ],
  },
  {
    id: "project-management",
    name: "Project management",
    group: "Work tracking",
    purpose:
      "A single, run-global board of scoped, completion-criteria'd issues that auto-dispatch: submitting an issue enqueues it, and gg spawns a top-level agent to implement it once its blockers clear — re-dispatching a failed issue up to `maxRetries` before marking it failed.",
    params: [
      {
        key: "maxEpics",
        label: "Max epics",
        kind: "number",
        defaultValue: String(DEFAULT_MAX_EPICS),
        hint: "How many epics the board may hold.",
      },
      {
        key: "maxIssues",
        label: "Max issues",
        kind: "number",
        defaultValue: String(DEFAULT_MAX_ISSUES),
        hint: "How many issues the board may hold.",
      },
      {
        key: "maxRetries",
        label: "Max retries",
        kind: "number",
        defaultValue: String(DEFAULT_MAX_RETRIES),
        hint: "How many times gg re-dispatches an issue whose assigned agent finished without completing it before marking the issue failed.",
      },
      {
        key: "mergeAgent",
        label: "Merge agent",
        kind: "agent",
        defaultValue: ROOT_AGENT,
        hint: "Required. Every issue works in its own git worktree, merged back when it is accepted; when that merge conflicts with work another issue landed first, this agent is dispatched into the workspace to resolve it and finish the merge. It must have the Shell capability.",
      },
      {
        key: "reviewers",
        label: "Reviewers required",
        kind: "boolean",
        hint: "On, filing an issue requires naming one or more reviewers — from the agents this one lists with the Reviewer scope. Either way, every reviewer an issue names must approve the work before the issue is accepted and merged.",
      },
    ],
    tools: [
      "create_epic",
      "create_issue",
      "update_issue",
      "set_issue_blocked_by",
      "complete_issue",
      "remove_epic",
      "remove_issue",
      "wait_for_issue",
    ],
    // The blocked-by DAG (`set_issue_blocked_by`) and `wait_for_issue` are deliberately
    // absent: they are what makes a board a board rather than a list, so they come with
    // the capability and are never ablated away.
    toolAblation: [
      {
        label: "Issue creation",
        tools: ["create_epic", "create_issue"],
        hint: "Off gives this agent read-only access to the board — it still sees it, waits on issues, and completes the one it was assigned, but files no new work.",
      },
      {
        label: "Revise the board",
        tools: ["update_issue", "remove_epic", "remove_issue"],
      },
    ],
  },
  {
    id: "planning",
    name: "Planning",
    group: "Work tracking",
    purpose:
      "A read-only planning pass, then a fresh-context implementation pass seeded from the submitted plan.",
    implementationLabel: "Planner",
    implementationPlaceholder: "default",
    tools: ["enter_plan_mode", "submit_plan"],
  },
  // --- Delegation -------------------------------------------------------------
  {
    id: "subagents",
    name: "Subagents",
    group: "Delegation",
    purpose:
      "Spawn other agents — run in parallel, block on them, message them, receive their return value.",
    params: [
      {
        key: "maxParallel",
        label: "Max parallel",
        kind: "number",
        placeholder: "e.g. 4",
        hint: "Cap on agents running at once (a spawn beyond it blocks).",
      },
      {
        key: "maxDepth",
        label: "Max depth",
        kind: "number",
        placeholder: "e.g. 3",
        hint: "Recursion bound (a spawn at max depth is refused).",
      },
    ],
    tools: ["spawn_subagent", "wait_for_subagents", "send_message"],
    toolAblation: [
      {
        label: "Inter-agent messaging",
        tools: ["send_message"],
        hint: "Off leaves spawn-and-wait only — agents can't message one another mid-run.",
      },
    ],
  },
  {
    id: "workflows",
    name: "Workflows",
    group: "Delegation",
    purpose:
      "Declared, ordered subagent fan-outs (stages feeding the next) driven by the same scheduler.",
    tools: ["run_workflow"],
  },
  // --- Process & quality ------------------------------------------------------
  {
    id: "fsm",
    name: "FSM-driven process",
    group: "Process & quality",
    purpose:
      "Drive the run through a fixed, named state machine so the order of work is a property of the process.",
    params: [
      {
        key: "machine",
        label: "Machine",
        kind: "select",
        hint: FSM_MACHINE_HINT,
        options: FSM_MACHINE_OPTIONS,
      },
    ],
    tools: ["advance_state"],
  },
  {
    id: "speculative-execution",
    name: "Speculative execution",
    group: "Process & quality",
    purpose:
      "Best-of-K — attempt a piece of work K times in parallel worktrees and keep the judged winner.",
    params: [
      {
        key: "judgeAgent",
        label: "Judge agent",
        kind: "agent",
        defaultValue: ROOT_AGENT,
        hint: "Which agent profile judges the K attempts and picks the winner. A run-level knob read off the Root agent.",
      },
    ],
    tools: ["speculate"],
  },
  // --- Debugging --------------------------------------------------------------
  {
    id: "replay",
    name: "Replay capture",
    group: "Debugging",
    purpose:
      "Debug-only: record every agent's model I/O and tool results to a per-run replay record so the run can be re-run and stepped through exactly. Adds no tools; zero overhead when off.",
  },
];

export const DEFAULT_CAP_IDS = CAPABILITIES.filter((c) => c.defaultOn).map(
  (c) => c.id,
);
export const ALL_CAP_IDS = CAPABILITIES.map((c) => c.id);

// Every tool name any capability offers, in catalog order, de-duplicated — the
// universe of `toolOffered` facet targets and toolset-ablation levers.
export const ALL_TOOL_NAMES: ReadonlyArray<string> = Array.from(
  new Set(CAPABILITIES.flatMap((c) => c.tools ?? [])),
);

// --- Run limits -----------------------------------------------------------------
//
// The execution ceilings a run is bounded by. Deliberately **not** [CapSpec]s: a
// capability is a feature under ablation, with tools and an on/off arm a study
// varies, while a ceiling is an operator's guardrail that applies to every
// capability and to both execution modes at once. Keeping them out of
// [CAPABILITIES] is what keeps them out of [CAP_GROUPS] and out of the
// `capabilityEnabled` facet space, where "is the cost ceiling enabled?" would be a
// dimension no study wants to slice its results by.

// gg's default error ceilings, armed when a configuration declares none — the two
// that end a run whose model has stopped making progress. The turn ceiling is
// unbounded by default (the host caps the wall-clock), and runtime and cost are off
// when unset.
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
export const DEFAULT_MAX_ERROR_RATE = 0.4;
export const DEFAULT_ERROR_RATE_WINDOW = 50;

// One execution ceiling's control. `key` is the wire field on
// `GgCapabilitySet.limits`; `kind` is what makes the value legible *and* checkable
// — a `count` is a whole number of turns, seconds or errors, a `fraction` is a rate
// in 0–1, and an `amount` is money, which is the only one of the three that is
// meaningfully fractional above 1.
export interface RunLimitSpec {
  key: keyof GgRunLimits;
  label: string;
  kind: "count" | "fraction" | "amount";
  placeholder?: string;
  hint: string;
  // The value gg falls back to when this ceiling is unset, seeded into a fresh
  // configuration's field so it shows gg's real default rather than an empty box. The
  // two error ceilings have one; the turn ceiling is unbounded by default and runtime
  // and cost are off when empty, so those seed nothing.
  defaultValue?: string;
}

// The six ceilings, in the order they read as a sentence: how long a run may go on
// for, then how badly it may go, then how much it may cost.
//
// `key` is typed as `keyof GgRunLimits`, and [ggConfigDraft]'s draft is a total
// record over the same keys, so a ceiling added to the contract cannot ship without
// a control here.
export const RUN_LIMIT_SPECS: ReadonlyArray<RunLimitSpec> = [
  {
    key: "maxTurns",
    label: "Max turns per agent",
    kind: "count",
    placeholder: "unbounded",
    hint: "Absent means unbounded — the host caps the run's wall-clock, so gg imposes no turn backstop unless you set one. An agent that reaches a set ceiling ends exhausted.",
  },
  {
    key: "maxRuntimeSecs",
    label: "Runtime (seconds)",
    kind: "count",
    placeholder: "e.g. 5400",
    hint: "Wall-clock budget for the whole run, observed by every agent at its own turn boundary. A run that spends it ends timed_out.",
  },
  {
    key: "maxConsecutiveErrors",
    label: "Consecutive errors",
    kind: "count",
    defaultValue: String(DEFAULT_MAX_CONSECUTIVE_ERRORS),
    placeholder: "e.g. 5",
    hint: `How many error turns in a row end an agent; gg's default is ${DEFAULT_MAX_CONSECUTIVE_ERRORS}. A turn is an error when the work it declared could not be carried out — a failed model call, a reply that was not a program, a program that did not compile, threw, or was stopped at a sandbox ceiling. A tool call that failed inside a program that carried on is not one.`,
  },
  {
    key: "maxErrorRate",
    label: "Error rate",
    kind: "fraction",
    defaultValue: String(DEFAULT_MAX_ERROR_RATE),
    placeholder: "0.0 – 1.0",
    hint: `The fraction of an agent's recent turns that may be errors, breached only strictly above this — at 0.5 over a window of ten, five errors is not a breach and six is. Needs a window; either alone is no ceiling at all. gg's default is ${DEFAULT_MAX_ERROR_RATE} over ${DEFAULT_ERROR_RATE_WINDOW} turns.`,
  },
  {
    key: "errorRateWindow",
    label: "Error-rate window (turns)",
    kind: "count",
    defaultValue: String(DEFAULT_ERROR_RATE_WINDOW),
    placeholder: "e.g. 50",
    hint: `How many of an agent's most recent turns the rate is measured over, and also the minimum sample: the ceiling cannot fire until the agent has taken this many turns, so a run can never be killed by its first bad turn. gg's default is ${DEFAULT_ERROR_RATE_WINDOW}.`,
  },
  {
    key: "maxCost",
    label: "Cost (USD)",
    kind: "amount",
    placeholder: "e.g. 25",
    hint: "Ceiling on the whole run's accumulated cost, checked at each agent's turn boundary. A run whose model reports no cost can never be stopped by it — gg does not invent a figure to stop a run with.",
  },
];
