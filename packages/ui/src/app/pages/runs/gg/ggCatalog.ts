// The shared gg capability catalog — the single in-console description of gg's full
// capability set. Both the config/launch page (`NewGgRunPage`) and the
// result-aggregation surface (`GgAnalyzePage`) drive off this one list so the
// facets a query can slice by stay in lockstep with the capabilities a run can be
// configured with. The ids, params, and tool names are the real core contract
// (`crates/core/src/gg.rs` + `crates/gg/src/tools/mod.rs`), not guesses.

// The slot every gg run must bind — the primary model that drives the agent loop.
// The backend 400s a capability set that leaves it unbound.
export const PRIMARY_SLOT = "primary";

// The offline mock model: an in-repo scripted "builder" that drives a gg run with
// no provider API key, so a run can be launched and watched end to end without
// credentials. Offered as a per-slot toggle.
export const MOCK_MODEL_ID = "mock/scripted-builder";
export const MOCK_PROVIDER = "mock";

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
  | "Knowledge"
  | "Work tracking"
  | "Delegation"
  | "Process & quality"
  | "Models & tools";

export const CAP_GROUPS: ReadonlyArray<{ group: CapGroup; startOpen: boolean }> = [
  { group: "Models & tools", startOpen: true },
  { group: "Context", startOpen: true },
  { group: "Knowledge", startOpen: true },
  { group: "Work tracking", startOpen: true },
  { group: "Delegation", startOpen: false },
  { group: "Process & quality", startOpen: false },
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
  // Dedicated param controls; anything else goes in the generic JSON editor.
  params?: ReadonlyArray<ParamSpec>;
  // The tool names this capability offers — the toolset-ablation surface withholds
  // individual ones from this list, and the analyze page offers them as
  // `toolOffered` facet targets.
  tools?: ReadonlyArray<string>;
}

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
    purpose: "Run shell commands in the run container — build, test, drive tooling.",
    defaultOn: true,
    tools: ["shell"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    group: "Models & tools",
    purpose: "Read, write, edit, and list files in the run's workspace.",
    defaultOn: true,
    tools: ["read_file", "write_file", "edit_file", "list_dir"],
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
