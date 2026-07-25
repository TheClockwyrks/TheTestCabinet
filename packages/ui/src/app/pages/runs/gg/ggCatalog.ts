// The shared gg capability catalog — the single in-console description of gg's full
// capability set. Both the configuration editor (`GgConfigEditor`) and the
// result-aggregation surface (`GgAggregatePage`) drive off this one list so the
// facets a query can slice by stay in lockstep with the capabilities a run can be
// configured with. The ids, params, and tool names are the real core contract
// (`crates/core/src/gg.rs` + `crates/gg/src/tools/mod.rs`), not guesses.

import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";

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
// select → a JSON string (an empty selection omits the param entirely).
export interface ParamSpec {
  key: string;
  label: string;
  kind: "fraction" | "number" | "bytes" | "select";
  hint?: string;
  placeholder?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

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
  // `value` is the capability's default implementation.
  implementationOptions?: ReadonlyArray<{ value: string; label: string }>;
  // Dedicated param controls; anything else goes in the generic JSON editor.
  params?: ReadonlyArray<ParamSpec>;
  // The tool names this capability offers — the toolset-ablation surface withholds
  // individual ones from this list, and the analyze page offers them as
  // `toolOffered` facet targets.
  tools?: ReadonlyArray<string>;
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
  { value: "", label: "unlimited — the whole file in one call (default)" },
  {
    value: "hard-cap",
    label: "hard cap — never more than the line cap, per call",
  },
  {
    value: "default-cap",
    label: "default cap — the line cap unless the model asks for more",
  },
] as const;

// The line cap gg falls back to when a capped read mode names none.
export const DEFAULT_READ_LINE_CAP = 250;

export const FSM_MACHINE_OPTIONS = [
  { value: "", label: "(none — no state machine)" },
  { value: "tdd", label: "tdd — write tests → implement → verify" },
  { value: "review-gated", label: "review-gated — develop → review → accept" },
  { value: "plan-first", label: "plan-first — plan pass → implement pass" },
] as const;

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
    params: [
      {
        key: "lineCap",
        label: "Line cap",
        kind: "number",
        placeholder: `e.g. ${DEFAULT_READ_LINE_CAP}`,
        hint: `Lines per call under either capped mode (default ${DEFAULT_READ_LINE_CAP}). Ignored when unlimited.`,
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
      "The agent emits a program over the tools, run in a wasm sandbox, instead of one discrete tool call at a time.",
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
    implementationPlaceholder: "default",
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
        placeholder: "0.0 – 0.9",
        hint: "Fraction of the window held back from the agent so the summarization call — which reads the whole thread and writes a summary — fits. Default 0.2.",
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
  },
  // --- Knowledge --------------------------------------------------------------
  {
    id: "skills",
    name: "Skills",
    group: "Knowledge",
    purpose:
      "Authored markdown skills whose descriptions are shown up front and bodies survive compaction once read.",
    defaultOn: true,
    tools: ["read_skill"],
  },
  {
    id: "memories",
    name: "Memories",
    group: "Knowledge",
    purpose:
      "The model's own bounded, self-curated notes, retained across a compaction boundary.",
    defaultOn: true,
    tools: ["write_memory", "update_memory", "delete_memory"],
  },
  // --- Work tracking ----------------------------------------------------------
  {
    id: "tasks",
    name: "Tasks",
    group: "Work tracking",
    purpose:
      "A lightweight to-do list (a blocked-by DAG) that survives compaction verbatim.",
    defaultOn: true,
    tools: [
      "add_task",
      "update_task",
      "set_blocked_by",
      "complete_task",
      "remove_task",
    ],
  },
  {
    id: "epics-and-issues",
    name: "Epics & issues",
    group: "Work tracking",
    purpose:
      "A heavyweight work-decomposition board with scoped, completion-criteria'd issues safe to hand to a subagent.",
    tools: [
      "create_epic",
      "create_issue",
      "update_issue",
      "set_issue_blocked_by",
      "complete_issue",
      "remove_epic",
      "remove_issue",
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
