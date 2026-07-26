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
} from "@test-cabinet/run-record/gg";

/** Whether a run's capability set has the named capability on. */
export function capabilityOn(set: GgCapabilitySet | null, id: string): boolean {
  return set?.capabilities.some((c) => c.id === id && c.enabled) ?? false;
}

// The slot every gg run must bind — the primary model that drives the agent loop.
// The backend 400s a capability set that leaves it unbound.
export const PRIMARY_SLOT = "primary";

// The role slots multi-model runs commonly bind, beyond the primary. Free text is
// allowed too; these seed the datalist so the common ones are one click away, and
// the analyze page offers them as `slotModel` facet targets.
export const COMMON_ROLE_SLOTS = [
  "subagent",
  "planner",
  "reviewer",
  "judge",
] as const;

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
// [TOGGLES_HINT]).
//
// Every param gg actually reads has a control here — there is deliberately no raw
// JSON escape hatch in the editor, since the console knows gg's whole param schema.
// A param a *stored* configuration carries that no control here covers (a key from a
// newer client, or a legacy one) is preserved verbatim through a round-trip rather
// than shown, so reopening and saving never drops it.
export interface ParamSpec {
  key: string;
  label: string;
  kind: "fraction" | "number" | "bytes" | "select" | "text" | "toggles";
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

// The workspace-relative directory gg reads authored skills from when a
// configuration names none (`crates/gg/src/skills.rs`).
export const DEFAULT_SKILLS_DIR = ".gg/skills";

// The bounds gg falls back to when a configuration sets no cap, mirroring the
// per-capability defaults in `crates/gg/src/{tasks,board,memories}.rs`. Surfaced as
// placeholders so an operator sees what leaving a field empty means.
export const DEFAULT_MAX_TASKS = 100;
export const DEFAULT_MAX_EPICS = 50;
export const DEFAULT_MAX_ISSUES = 200;
export const DEFAULT_MEMORY_MAX_COUNT = 8;
export const DEFAULT_MEMORY_MAX_LEN_PER = 2000;
export const DEFAULT_MEMORY_MAX_TOTAL_LEN = 8000;

export const FSM_MACHINE_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "tdd", label: "tdd" },
  { value: "review-gated", label: "review-gated" },
  { value: "plan-first", label: "plan-first" },
] as const;

// What each state machine does — the detail lifted off the picker's option labels
// into the Machine field's help tooltip.
export const FSM_MACHINE_HINT =
  "None runs no state machine. tdd: write tests → implement → verify. review-gated: develop → review → accept. plan-first: plan pass → implement pass.";

// The compaction summarization strategies gg resolves at run time
// (`crates/gg/src/compaction.rs`), in editor order. Both are a single model call
// that differ only in the prompt: the empty value is the default (a focused prose
// recap), `structured` asks for the same state in fixed sections. An unrecognized
// name falls back to the default rather than failing to launch, so the field stays
// a closed picker rather than free text.
export const SUMMARIZER_OPTIONS = [
  { value: "", label: "Model summary (default)" },
  { value: "structured", label: "Structured extract" },
] as const;

// What each summarization strategy does — the detail lifted off the picker's option
// labels into the field's help tooltip.
export const SUMMARIZER_HINT =
  "Model summary asks the model for a focused prose recap of the thread being dropped. Structured extract asks the same call for the state under fixed headings (what it's building, key decisions, files changed, work in progress, next step).";

export const CAPABILITIES: ReadonlyArray<CapSpec> = [
  // --- Models & tools ---------------------------------------------------------
  {
    id: "shell",
    name: "Shell",
    group: "Models & tools",
    purpose:
      "Run shell commands in the run container — build, test, drive tooling.",
    defaultOn: true,
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
        key: "fuel",
        label: "Fuel",
        kind: "number",
        placeholder: "e.g. 1000000",
        hint: "Wasmtime fuel budget per program.",
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
    ],
  },
  // --- Context ----------------------------------------------------------------
  {
    id: "context-visibility",
    name: "Context visibility",
    group: "Context",
    purpose:
      "Per-source accounting of what fills the window, streamed as the stacked context graph.",
    defaultOn: true,
    params: [
      {
        key: "windowLimit",
        label: "Window limit (tokens)",
        kind: "number",
        placeholder: "e.g. 100000",
        hint: "Run the model against a smaller window than it really has — the way to exercise compaction on a million-token model without paying for a million tokens. Can only narrow: a value above the model catalog's figure for the model is clamped to it.",
      },
    ],
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
        key: "triggerFullness",
        label: "Trigger fullness",
        kind: "fraction",
        placeholder: "0.0 – 1.0",
        hint: "Window-fullness threshold that triggers a compaction.",
      },
      {
        key: "summaryHeadroom",
        label: "Summary headroom",
        kind: "fraction",
        defaultValue: "0.2",
        hint: "Fraction of the window held back from the agent so the summarization call — which reads the whole thread and writes a summary — fits.",
      },
    ],
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
    params: [
      {
        key: "maxCount",
        label: "Max memories",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_COUNT),
        hint: "How many notes the model may keep at once.",
      },
      {
        key: "maxLenPerMemory",
        label: "Max length each (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_PER),
        hint: "Character ceiling on any one note.",
      },
      {
        key: "maxTotalLen",
        label: "Max length total (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_TOTAL_LEN),
        hint: "Character ceiling across all notes together.",
      },
    ],
    tools: ["write_memory", "update_memory", "delete_memory"],
    toolAblation: [
      {
        label: "Revise memories",
        tools: ["update_memory", "delete_memory"],
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
    id: "epics-and-issues",
    name: "Epics & issues",
    group: "Work tracking",
    purpose:
      "A heavyweight work-decomposition board with scoped, completion-criteria'd issues safe to hand to a subagent.",
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
    ],
    tools: [
      "create_epic",
      "create_issue",
      "update_issue",
      "set_issue_blocked_by",
      "complete_issue",
      "remove_epic",
      "remove_issue",
    ],
    toolAblation: [
      {
        label: "Issue dependencies",
        tools: ["set_issue_blocked_by"],
        hint: "Off makes the board flat — issues can't be marked blocked-by one another.",
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
    id: "multi-model",
    name: "Multi-model",
    group: "Delegation",
    purpose:
      "Let subagents resolve to non-primary model slots; off collapses the whole run to the primary model.",
  },
  {
    id: "worktrees",
    name: "Worktrees",
    group: "Delegation",
    purpose:
      "Run a subagent in an isolated git worktree, merged back or discarded deliberately — makes speculation safe.",
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
    id: "code-reviews",
    name: "Code Reviews",
    group: "Process & quality",
    purpose:
      "Gate an issue's acceptance on a reviewer subagent that approves or returns actionable fix items.",
  },
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

// The turn ceiling gg falls back to when a configuration declares none — the one
// ceiling that has a default, because a gg run has always had a turn ceiling. Every
// other ceiling is simply off when unset.
export const DEFAULT_MAX_TURNS = 50;

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
  // configuration's field. Only the turn ceiling has one (gg has always had a turn
  // ceiling); every other ceiling is simply off when empty, so it seeds nothing.
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
    defaultValue: String(DEFAULT_MAX_TURNS),
    hint: `gg's default is ${DEFAULT_MAX_TURNS}; clearing the field falls back to it. An agent that reaches it ends exhausted.`,
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
    placeholder: "e.g. 5",
    hint: "How many error turns in a row end an agent. A turn is an error when the work it declared could not be carried out — a failed model call, a reply that was not a program, a program that did not compile, threw, or was stopped at a sandbox ceiling. A tool call that failed inside a program that carried on is not one.",
  },
  {
    key: "maxErrorRate",
    label: "Error rate",
    kind: "fraction",
    placeholder: "0.0 – 1.0",
    hint: "The fraction of an agent's recent turns that may be errors, breached only strictly above this — at 0.5 over a window of ten, five errors is not a breach and six is. Needs a window; either alone is no ceiling at all.",
  },
  {
    key: "errorRateWindow",
    label: "Error-rate window (turns)",
    kind: "count",
    placeholder: "e.g. 10",
    hint: "How many of an agent's most recent turns the rate is measured over, and also the minimum sample: the ceiling cannot fire until the agent has taken this many turns, so a run can never be killed by its first bad turn.",
  },
  {
    key: "maxCost",
    label: "Cost (USD)",
    kind: "amount",
    placeholder: "e.g. 25",
    hint: "Ceiling on the whole run's accumulated cost, checked at each agent's turn boundary. A run whose model reports no cost can never be stopped by it — gg does not invent a figure to stop a run with.",
  },
];
