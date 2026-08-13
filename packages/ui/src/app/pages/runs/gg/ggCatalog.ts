// The shared gg capability catalog — the single in-console description of gg's full
// capability set, which the configuration editor (`GgConfigEditor`) drives off. The
// ids, params, and tool names are the real core contract (`crates/core/src/gg.rs` +
// `crates/gg/src/tools/mod.rs`), not guesses.
//
// Its analysis-side counterpart is `GG_CAPABILITY_CATALOG` in
// `crates/core/src/gg_query.doc.rs`, which is what makes the query language's
// `cap.<id>` namespace total. The two lists describe the same capabilities from
// different ends — this one says what an operator may configure, that one says what
// every run document must carry a value for — so a capability added to gg belongs in
// both.

import type {
  GgAgentConfig,
  GgCapabilitySet,
  GgHealingStrategy,
  GgHookEvent,
  GgLoopDetection,
  GgModuleKind,
  GgProgramLanguage,
  GgRunLimits,
  GgSubagentScope,
} from "@test-cabinet/run-record/gg";
import type { GgHookKind } from "./ggConfigDraft";
// The arms' names, from the one module that holds them — see PROGRAM_LANGUAGE_LABELS below.
import { PROGRAM_LANGUAGE_NAMES } from "../../gg/programLanguages";

// Whether a run's capability set has the named capability on. Capabilities are
// per-agent now, so a run-level "is X on?" question is answered by the **Root** agent
// (agents[0]) — the profile that drives the top-level session.
//
// Use this only for questions that genuinely are about the run as a whole. Anything
// scoped to ONE agent must ask {@link agentCapabilityOn} instead: a run may give its
// agents wholly different capabilities, so the Root's answer says nothing about a
// subagent's — a task list enabled on an issue's implementer and off on the Root is an
// ordinary configuration, not an edge case.
export function capabilityOn(set: GgCapabilitySet | null, id: string): boolean {
  return (
    set?.agents?.[0]?.capabilities.some((c) => c.id === id && c.enabled) ??
    false
  );
}

// The profile the agent running under `agent` (a slot name from the agent tree) was
// configured with, falling back to the Root when the name is unknown or not yet seen —
// an agent whose spawn event has not arrived carries no slot, and the Root is the
// working guess until it does. Null before gg announces the configuration at all.
export function agentProfile(
  set: GgCapabilitySet | null,
  agent: string | null | undefined,
): GgAgentConfig | null {
  if (!set?.agents?.length) return null;
  return (
    (agent ? set.agents.find((a) => a.name === agent) : undefined) ??
    set.agents[0]!
  );
}

// Whether the named agent's OWN profile has the capability on — the per-agent question,
// and the one every agent-scoped surface (which files its folder offers, which panes its
// Knowledge file splits into, which bands its context graph draws) has to ask.
export function agentCapabilityOn(
  set: GgCapabilitySet | null,
  agent: string | null | undefined,
  id: string,
): boolean {
  return (
    agentProfile(set, agent)?.capabilities.some(
      (c) => c.id === id && c.enabled,
    ) ?? false
  );
}

// Whether ANY agent in the run has the capability on — the question a **run-global**
// surface asks. The epic/issue board is the case that matters: it is one board shared by
// the whole run, so it is worth showing whenever some profile can author it, whether or
// not that profile happens to be the Root.
export function anyAgentCapabilityOn(
  set: GgCapabilitySet | null,
  id: string,
): boolean {
  return (
    set?.agents?.some((a) =>
      a.capabilities.some((c) => c.id === id && c.enabled),
    ) ?? false
  );
}

// The name a fresh configuration's root agent is *born* with. It is a starting value,
// not an invariant: the root is whichever profile the configuration flags as such (the
// editor tracks it by internal id, and the wire format by position — gg reads the root
// off `agents[0]`), so it can be renamed to anything and the flag can be moved to
// another profile. Mirrors `ROOT_AGENT` in `crates/core/src/gg.rs`, which is likewise
// only the name `GgAgentConfig::root()` seeds.
export const ROOT_AGENT = "Root";

// The name of the first model slot a fresh configuration declares — the launch input
// the root agent's model defers to by default. Like the root's name it is only a
// starting value: agents bind to a slot by internal id, so renaming this one carries
// its bindings along. Kept for the New run page's launch-summary heuristic and the
// draft's default model-slot name.
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
  | "Models & tools";

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
];

// --- Agent type -------------------------------------------------------------------
//
// How an agent is **implemented**, which is a different question from what it can do.
// A *Tools* agent is driven by tool calls; a *RaC* agent's whole reply is a program (in
// its configured language) over the same functions, run in a wasm sandbox; and an *FSM* agent is not a
// worker at all — it is a state machine over the configuration's other profiles, with
// no turns, no model and no capabilities of its own.
//
// This is deliberately **not** a capability, and the distinction is the point. A
// capability is a feature an agent either has or has not, listed beside its peers and
// ablatable one at a time. The agent type decides which capabilities are offered in the
// first place — and, for a machine, whether the question applies at all.
//
// The wire format has no `type` field: it records the type as the two mode-marker
// capabilities ([RESPONSES_AS_CODE_CAP_ID] and [FSM_CAP_ID]), which is what gg reads. So
// this vocabulary is a *projection* of the contract, and the load/save paths in
// [ggConfigDraft] are where the two meet.
export type GgAgentMode = "tools" | "rac" | "fsm";

// The agent types, in the order the selector offers them: the two ways of driving a
// worker, and then the one that is not a worker.
export const AGENT_MODES: ReadonlyArray<{
  value: GgAgentMode;
  label: string;
  // What picking this type means for the agent, shown under the selector — the one
  // sentence an operator needs before choosing.
  purpose: string;
}> = [
  {
    value: "tools",
    label: "Tools",
    purpose:
      "Tool calling: gg offers each capability's functions as tools and the model calls them one at a time, a turn per round trip.",
  },
  {
    value: "rac",
    label: "RaC",
    purpose:
      "Responses as code: the model's whole reply is a program over the same functions — TypeScript unless a study configures another language — run in a wasm sandbox. One turn can make dozens of calls, branch on their results, and loop.",
  },
  {
    value: "fsm",
    label: "FSM",
    purpose:
      "A state machine over the configuration's other profiles. It is not a worker: it has no turns of its own, so it is given no model, no prompt, no roster and no capabilities — each state runs the profile it names, with that profile's configuration.",
  },
];

export const AGENT_MODE_HINT =
  "How this agent is implemented — and so what it can be configured with. Tools and RaC are two ways of driving the same capabilities, and swapping between them is the single biggest lever a study has. A state machine is not a worker at all: it takes no turns, so it is asked for no model, no prompt and no roster, and its configuration is the machine.";

// The agent types a capability is offered under when its [spec](CapSpec.modes) names
// none: both of the types a real worker can be. A machine is never in this list — it
// holds no capabilities whatever.
const WORKER_MODES: ReadonlyArray<GgAgentMode> = ["tools", "rac"];

// A dedicated param control on a capability. `kind` picks the input + how the value
// coerces into the JSON params object: fraction/number/bytes → a JSON number,
// select → a JSON string (an empty selection omits the param entirely), text → a
// JSON string of whatever was typed (an empty field omits the param), toggles → a
// JSON object of `{ option: <state> }` for every option moved off *its own* default
// (see [TOGGLES_HINT]), boolean → `true` when switched on and no key at all when off (so
// its default arm is the absent key, for the same reason `toggles` records only what
// was moved).
//
// Every param gg actually reads has a control here — there is deliberately no raw
// JSON escape hatch in the editor, since the console knows gg's whole param schema.
// A param a *stored* configuration carries that no control here covers — a key from a
// newer client — is preserved verbatim through a round-trip rather
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
  // A `model` param names a model the same way an agent's own binding does: either a
  // model slot the launch form fills in, or a model id pinned here. It renders the same
  // two-field control the agent rows use, and writes to *two* keys — this one for a
  // pinned id, and [slotKey] for a deferred slot.
  // A `states` param is a whole finite-state machine: an ordered list of states, each
  // naming an agent profile and the transitions out of it, and each transition naming
  // the [modules](MODULE_KINDS) it carries to the successor. It renders as its own
  // multi-row editor (see `GgFsmStatesField`) and holds its rows as the JSON text of
  // the list, so the draft stays a flat string map.
  kind:
    | "fraction"
    | "number"
    | "bytes"
    | "select"
    | "text"
    | "toggles"
    | "boolean"
    | "agent"
    | "model"
    | "states";
  // The companion param key a `model` param defers through: the name of the model slot
  // the launcher must fill in. Binding rewrites it into [key] and drops it, so a set that
  // reaches gg carries one only when the slot went unbound. Required on a `model` param
  // and meaningless on any other.
  slotKey?: string;
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
  //
  // A `toggles` member may declare its own default arm: `defaultOff` marks one gg leaves
  // OFF unless a configuration arms it, which the form has to know because the draft
  // records deviations from each member's default rather than a raw off-list (see
  // [TOGGLES_HINT]). Absent means on-by-default, which is what every member but one is.
  // `hint` is hover text for a member whose label cannot carry why it exists.
  options?: ReadonlyArray<{
    value: string;
    label: string;
    defaultOff?: boolean;
    hint?: string;
  }>;
  // The capability [implementations](CapSpec.implementationOptions) this param is
  // actually read under, when it is not read under all of them. A param gg ignores
  // outside a particular strategy is a control that can only mislead — the form hides
  // it while another implementation is selected rather than showing a box that does
  // nothing. Absent means the param applies to every implementation, which is the
  // common case. A value already stored for a hidden param is kept and re-saved, so
  // switching strategy back and forth never loses it.
  showWhenImplementation?: ReadonlyArray<string>;
}

/**
 * Whether a param's dedicated control is offered while `implementation` is selected —
 * always, unless the param names the implementations it is read under.
 */
export function paramApplies(
  param: ParamSpec,
  implementation: string | undefined,
): boolean {
  return (
    !param.showWhenImplementation ||
    param.showWhenImplementation.includes((implementation ?? "").trim())
  );
}

// Why a `toggles` param writes only the members whose switch was *moved*: each
// underlying gg param has its own default arm, so an absent key IS that default, and
// writing `{ "strip-fences": true }` for a member nobody touched would turn every saved
// configuration into an explicit opt-in that a later default change could no longer
// reach.
//
// Almost every member is on by default, and one — `drop-doubled-response` — is off (see
// [ParamSpec.options]'s `defaultOff`), which is exactly why this is stated as "off its
// default" rather than as "switched off": a subtractive rule cannot express arming a
// member gg leaves off.
//
// Every toggle set in the form ends its hint with this sentence — response healing's
// repairs and the skills capability's built-ins today — so the rule is stated once, in
// one wording, wherever it applies. That is why it names no particular kind of member:
// what the toggles ARE, and which of them start on, is the surrounding hint's and the
// members' own labels' job.
const TOGGLES_HINT =
  "Each starts at its own default; only the ones you move off it are recorded.";

export interface CapSpec {
  id: string;
  name: string;
  // Which group of the Tools/APIs list this capability is listed under. Optional
  // because the list is not the only place a capability is authored: `replay` is a
  // property of the *run's record* rather than of what an agent may do, so it is a
  // switch on the Agent tab, and the two [mode markers](isModeCapability) are the
  // agent type itself. A spec with no group is not rendered by the group loop at all,
  // which is what keeps "listed here" and "authored somewhere else" from drifting
  // apart — an entry cannot end up in both places, or in neither by accident.
  group?: CapGroup;
  purpose: string;
  // The [agent types](GgAgentMode) that offer this capability, when it is not offered
  // under every type a worker can be. `program-library` is the case that matters: there
  // are no programs in a tool-calling session to keep, and gg gates the capability on
  // the execution mode outright (`program_library: responses_as_code && program_library`),
  // so offering the switch to a Tools agent could only mislead.
  modes?: ReadonlyArray<GgAgentMode>;
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
  // (the two workspace writers, say) declares none, and the capability toggle is its
  // only granularity.
  toolAblation?: ReadonlyArray<{
    label: string;
    tools: ReadonlyArray<string>;
    hint?: string;
  }>;
  // The capability cannot be turned on by itself: it is inert — or, as with `fsm`,
  // refused at launch — until a param nobody can guess is authored beside it. The save
  // gate names such a capability rather than letting a configuration be stored in a
  // shape gg would refuse.
  requiresAuthoring?: boolean;
}

// How much of a file one `read_file` call returns — the read-file capability's
// implementation, and the per-tool A/B lever one capability per filesystem primitive
// exists to allow. The values are gg's implementation ids
// (`crates/gg/src/tools/filesystem.rs`); the empty value is the default (unlimited).
export const READ_MODE_OPTIONS = [
  { value: "", label: "Unlimited (default)" },
  { value: "default-cap", label: "Default cap" },
] as const;

// What each read mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const READ_MODE_HINT =
  "Unlimited returns the whole file in one call. Default cap returns the line cap unless the model asks for more, which is always honoured — no mode can refuse a whole-file read.";

// The read modes that apply the line cap — everything except `unlimited`, which
// returns the whole file and never reads it.
export const CAPPED_READ_MODES = ["default-cap"] as const;

// The line cap gg falls back to when a capped read mode names none.
export const DEFAULT_READ_LINE_CAP = 250;

// Where a `shell` command's output goes — the shell capability's implementation. The
// values are gg's implementation ids (`crates/core/src/gg.rs`); the empty value is the
// default (adaptive). Both truncating modes write every command's stdout and stderr to a
// file pair under `/tmp/gg-shell` and return only the configured tail, so a chatty build
// cannot spend a large slice of the window in one call.
// --- Hooks --------------------------------------------------------------------
//
// A hook is not a capability and deliberately does not appear in `CAPABILITIES`: the
// model is never told one exists, is offered no tool for it, and cannot decline one.
// These are the editor's vocabulary for the run-level Hooks section instead.

// The ten points a run can be scripted at, in the order the editor lists them: the four
// `pre`/`post` pairs, then the session's two ends. Mirrors `ALL_HOOK_EVENTS` in
// `crates/core/src/gg.rs`.
export const HOOK_EVENTS: ReadonlyArray<{
  value: GgHookEvent;
  label: string;
  hint: string;
}> = [
  {
    value: "pre-write",
    label: "Pre-write",
    hint: "Before a file write of any kind (`write_file`, `edit_file`, or a program's equivalent), with the absolute path and the contents that would be written. Can block, in which case nothing touches the disk.",
  },
  {
    value: "post-write",
    label: "Post-write",
    hint: "After a file write has updated the file, with the absolute path and the contents that were written. Cannot block; may insert.",
  },
  {
    value: "pre-shell",
    label: "Pre-shell",
    hint: "Before a shell command runs, with the command line. Can block, in which case no process is started.",
  },
  {
    value: "post-shell",
    label: "Post-shell",
    hint: "After a shell command has run, with the command line and whether it succeeded. Cannot block; may insert.",
  },
  {
    value: "pre-compact",
    label: "Pre-compact",
    hint: "Before a compaction condenses an agent's window. Cannot block — the window is full, and refusing would leave the agent no room to work — and cannot insert, since the window it would insert into is the one being rewritten.",
  },
  {
    value: "post-compact",
    label: "Post-compact",
    hint: "After a compaction has rewritten an agent's window. Cannot block, but may insert into the rebuilt context — the one moment a run can put back something the compaction dropped.",
  },
  {
    value: "agent-start",
    label: "Agent start",
    hint: "When any agent instance starts, with the kind of agent it is (root, issue implementer, issue reviewer, subagent). Cannot block; may insert into the opening context.",
  },
  {
    value: "agent-stop",
    label: "Agent stop",
    hint: "When any agent tries to end its session, with the kind of agent it is. Can block, in which case the agent is told why and carries on. This is the ending gate: a command hook here that exits non-zero holds the agent to a build or a test suite before it may stop.",
  },
  {
    value: "session-start",
    label: "Session start",
    hint: "Once per run, before the root agent's first turn. Cannot block, but may insert into the root's opening prompt.",
  },
  {
    value: "session-end",
    label: "Session end",
    hint: "Once per run, after the root agent has finished. Cannot block and cannot insert — there is no session left to affect. This is where a run reports on itself.",
  },
];

/**
 * Which of a configuration's two hook lists an event belongs to.
 *
 * `"session"` is the run's own — the two events that happen once per run, declared on the
 * configuration. `"agent"` is the other eight, which fire because a particular agent
 * wrote, ran, compacted, started or stopped, and are declared on that agent.
 *
 * Mirrors `GgHookEvent::is_session` in `crates/core/src/gg.rs`; gg refuses a hook declared
 * on the wrong side, so the editor must never offer one there.
 */
export type GgHookScope = "session" | "agent";

/** The scope a hook event belongs to. */
export function hookScopeOf(event: GgHookEvent): GgHookScope {
  return event === "session-start" || event === "session-end"
    ? "session"
    : "agent";
}

/** The events a given scope may declare, in the order the editor lists them. */
export function hookEventsForScope(
  scope: GgHookScope,
): ReadonlyArray<(typeof HOOK_EVENTS)[number]> {
  return HOOK_EVENTS.filter((event) => hookScopeOf(event.value) === scope);
}

// The events a hook can actually stop, read off a table rather than off the `pre-`
// prefix: `pre-compact` is a `pre-` event that deliberately cannot block, so the rule has
// an exception and the exception has to be written down.
export const BLOCKING_HOOK_EVENTS: ReadonlyArray<GgHookEvent> = [
  "pre-write",
  "pre-shell",
  "agent-stop",
];

// The three shapes a hook takes. The split that matters is command-versus-script: a
// command learns nothing but an exit status, while a script is handed the event as JSON
// and answers with a decision — which is what buys "let this through, but tell the model
// X", an outcome no exit code can express.
export const HOOK_KINDS: ReadonlyArray<{
  value: GgHookKind;
  label: string;
  hint: string;
}> = [
  {
    value: "command",
    label: "Command",
    hint: "Run a command line. It receives no input — the checks that are already commands read the workspace rather than being told about it. A non-zero exit blocks (on an event that can block), and the output is shown to the model either way, through the agent's own offloading policy.",
  },
  {
    value: "built-in",
    label: "Built-in",
    hint: "Run one of gg's own hook scripts. Same contract as a custom script — the event as one JSON argument, a decision object on stdout, exit 0 — with the source coming from gg. Each is meant to be read and copied into a custom hook.",
  },
  {
    value: "custom",
    label: "Custom",
    hint: "Run a script you provide. gg writes it to the run's workspace, makes it executable, and runs it with the event as its sole argument; a `#!` line chooses the interpreter and a script without one is run by `sh`. It must exit 0 and print one decision object on stdout — a non-zero exit or unreadable output is the hook itself failing, which stops the run.",
  },
];

// The hook scripts gg ships, for the Built-in kind. Mirrors `GG_BUILTIN_HOOKS` in
// `crates/core/src/gg.rs`; an id gg does not ship is a launch warning, not a silent skip.
export const GG_BUILTIN_HOOK_IDS = [
  "trace",
  "refuse-empty-write",
  "guard-destructive-shell",
] as const;

// What each built-in does, for the picker's help text.
export const GG_BUILTIN_HOOK_HINTS: Readonly<Record<string, string>> = {
  trace:
    "Report every event it receives back as a message, and continue. The one to reach for when the question is \u201Cdoes this event fire, and with what?\u201D",
  "refuse-empty-write":
    "Block a write whose contents are empty or whitespace \u2014 a model that truncates a file to nothing has usually lost it rather than meant to empty it. Every other write, and every non-write event, passes.",
  "guard-destructive-shell":
    "Block a shell command that would `git push`, `git reset --hard`, or recursively remove a path outside the workspace. A guard rail, not a sandbox: it matches on the command text.",
};

// The one thing a hook's decision object is: a tagged union on `action`. Quoted in the
// editor so an operator writing a custom script has the contract in front of them rather
// than in the documentation.
export const HOOK_DECISION_CONTRACT = `{"action":"continue"}
{"action":"block","reason":"why the operation was refused"}
{"action":"message","message":"text put in front of the model"}`;

export const SHELL_OUTPUT_OPTIONS = [
  { value: "", label: "Adaptive (default)" },
  { value: "offload", label: "Offload to files" },
  { value: "inline", label: "Inline" },
] as const;

// The shell output modes that truncate a command's output to the two ceilings below —
// everything except `inline`, which returns the whole of it and reads neither param.
export const TRUNCATING_SHELL_OUTPUT_MODES = ["", "offload"] as const;

// What each output mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const SHELL_OUTPUT_HINT =
  "Adaptive returns only the exit code for a command that succeeded, and the tail for one that failed. Offload returns the tail for every command. Both write the full stdout and stderr to a file pair under /tmp/gg-shell and tell the agent where to grep for the rest. Inline returns the whole output (capped at 16 KiB) and writes nothing to disk.";

// The two ceilings gg falls back to when a truncating shell output mode names neither
// (`DEFAULT_MAX_LINES`/`DEFAULT_MAX_CHARS` in `crates/gg/src/tools/shell.rs`).
export const DEFAULT_SHELL_MAX_LINES = 250;
export const DEFAULT_SHELL_MAX_CHARS = 4096;

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
//
// All but one are armed unless a configuration switches them off, because for those the
// repair is strictly safer than not making it: the reply they delete from could not have
// run as sent. `drop-doubled-response` is the exception, and carries its own
// [defaultOff](ParamSpec.options) flag rather than being a special case in the form.
export const HEALING_STRATEGY_OPTIONS: ReadonlyArray<{
  value: GgHealingStrategy;
  label: string;
  defaultOff?: boolean;
  hint?: string;
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
    value: "drop-doubled-response",
    label:
      "drop-doubled-response — halve a reply that is one program sent twice (off by default)",
    defaultOff: true,
    hint: "Off unless you arm it, and the only strategy that is: the half it deletes is valid code under any other reading, so unlike every other repair here, not making it is the safer default. It fires only on a byte-exact doubling with nothing at all between the copies — a model that deliberately repeats a statement writes a separator, and any single character of separator makes the reply an odd number of bytes long, which the test declines on. Arm it for a model observed to concatenate its completion with itself.",
  },
];

// How the assistant message a code turn records is derived from the model's reply
// (`crates/gg/src/healing.rs`). Under responses-as-code the reply is a program healing
// rewrites before running, so the transcript can store either what the model *sent* or
// what gg actually *ran* — a lever a study slices on. The empty value is gg's default
// (no post-processing), so leaving the field alone changes nothing.
// --- Program language ---------------------------------------------------------------
//
// Which language an agent writes its programs in. Every language offers the *same*
// capability surface under its own spellings, so this is the one axis a cross-language
// study varies — and gg records it on the run and on each agent's surface so the arms can
// be told apart afterwards. Empty is gg's default.
//
// How each registered language is labelled in the picker: the arms' names, with the one
// annotation this picker needs and a reader of documentation does not.
//
// The names themselves are NOT written here. They are `PROGRAM_LANGUAGE_NAMES`, and this
// is a spread of it with a single key overridden, because a second table of the same
// eleven strings is a second source of truth however exhaustive its type is: `Record` over
// the union catches a *missing* arm and cannot catch two spellings of a present one. What
// is genuinely local to this file is the `javascript` annotation — a study configuring a
// run needs to know that arm skips the type check, which is a property of choosing it and
// nothing a reader browsing its SDK is looking for — so it is stated as an override, which
// is what it is.
//
// The exhaustiveness argument survives the change and is the reason both are `Record`s: an
// array of options can be short a row and still type-check, so gg could register a language
// and this picker would silently not offer it. A language added to `GgProgramLanguage` and
// not named in `PROGRAM_LANGUAGE_NAMES` is a TypeScript error there, and this spread
// inherits it.
const PROGRAM_LANGUAGE_LABELS: Record<GgProgramLanguage, string> = {
  ...PROGRAM_LANGUAGE_NAMES,
  javascript: "JavaScript (no type check)",
};

// gg's own default, which is what the empty value resolves to (`GgProgramLanguage::default`).
const DEFAULT_PROGRAM_LANGUAGE: GgProgramLanguage = "typescript";

export const PROGRAM_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: "" | GgProgramLanguage;
  label: string;
}> = [
  {
    value: "",
    label: `${PROGRAM_LANGUAGE_LABELS[DEFAULT_PROGRAM_LANGUAGE]} (default)`,
  },
  ...Object.entries(PROGRAM_LANGUAGE_LABELS).map(([value, label]) => ({
    value: value as GgProgramLanguage,
    label,
  })),
];

export const PROGRAM_LANGUAGE_HINT =
  "The language this agent's programs are written in. Each language ships its own hand-written SDK over the same typed sandbox surface, so what differs between two arms of a study is the spelling of a call, never which calls exist. JavaScript is the exception and is deliberate: it is the TypeScript arm with the type check removed and nothing else changed — the same signatures, annotations included — so an A/B across the two measures what checking a program before it runs is worth. Python is its own guest, a committed CPython, and its programs are checked by nothing before they run. Ruby is compiled to JavaScript by a committed Opal before it crosses, so its programs are read and refused before they run without their types ever being checked — the one arm that separates compiling a program from typing it. PureScript is compiled and fully type-checked by a real `purs` in the run image, against a library set gg carries, so it is the other end of that axis: a wrong argument shape, a missing case or a missing instance costs a diagnostic rather than a turn. Java is the only arm whose program passes through two compilers — `javac` and then TeaVM — inside a JVM gg keeps warm between programs, so it is both type-checked and the most expensive arm to compile, and a class outside TeaVM's classlib is a located compile error rather than a run-time surprise. Kotlin rides that same road from bytecode onwards and is the A/B against it: the same two compilers, the same guest and the same classlib, so what differs between the pair is the language and its SDK rather than the toolchain — a program here is a Kotlin script, and its surface expresses every optional argument as a default passed by name where Java's needs an overload. Rust and Swift are a different shape rather than a different language: neither ships a guest at all, because their compilers produce the program rather than something that later reads one, so each turn compiles the component it is then evaluated by. Rust's is the cheapest compile of any checked arm and its programs are ~25 KB; Swift's reply is compiled byte for byte, with no wrapper and no line offset, and is the one arm that pays more to instantiate a program than to compile it. C++ is the third of that shape and the cheapest of the three per turn, because the prelude its programs are compiled against is precompiled once per machine — its reply is compiled byte for byte too, it is the only arm whose guest has working exceptions, and it is the only one where undefined behavior can end a program with nothing to say about why. C# is neither shape: Roslyn compiles the reply to an IL assembly on the host in about a third of a second, the bytes cross as base64, and a committed guest holding a Mono IL interpreter and the whole .NET class library loads them — so it is type-checked like a compiled arm, costs one compiler and no engine work per turn like an interpreted one, and has the best error surface of any of them, because an unhandled exception arrives with its type, its message and its managed stack. Empty is gg's default, TypeScript.";

export const ASSISTANT_MESSAGE_OPTIONS = [
  { value: "", label: "No post-processing (default)" },
  { value: "response-healing", label: "Post-response healing" },
] as const;

// What each assistant-message mode does — the detail lifted off the picker's option
// labels into the field's help tooltip.
export const ASSISTANT_MESSAGE_HINT =
  "No post-processing records the reply exactly as the model sent it (healing still runs and is disclosed, but its output is not stored). Post-response healing records the healed program gg actually ran whenever healing changed the reply, and the reply verbatim when it did not.";

// Which SDK types a documentation lookup opens beside the function it was asked for. Three
// arms, none of them obviously right, which is why it is a knob rather than a decision —
// see the option hint for what each one costs.
export const DOC_VIEW_TYPES_OPTIONS = [
  { value: "", label: "Return position (default)" },
  { value: "return-and-parameters", label: "Return position and arguments" },
  { value: "off", label: "None" },
] as const;

export const DOC_VIEW_TYPES_HINT =
  "Opening a function's documentation also opens the SDK types its signature mentions, as views of their own. Return position lands the agent on what it can do with the value it is about to get. Return position and arguments opens everything the signature names, which is more up front and fewer follow-up lookups. None opens nothing and leaves the agent to ask for a type by name. Always exactly one level: a type's own view never drags in a further type.";

// --- Loop detection ---------------------------------------------------------------
//
// Some models get stuck generating: thousands of near-identical lines (`void 0;`,
// repeated) until the provider's output cap stops them. gg is non-streaming by default,
// so it pays for the whole reply and only learns what it bought once it is complete.
//
// Loop detection watches a reply as it arrives and abandons one that has become
// repetitive. It is a **per-agent** lever, and not a capability: it changes nothing about
// what the agent can do, only how gg talks to its model — which is why it is authored
// beside the model binding and the prompt-cache lifetime rather than in the capability
// list. It is per agent because looping is a property of the *model*, and the profiles of
// one run may be bound to several.

// What arming the detector costs and what it buys — the tooltip on the lever itself.
// States the transport consequence up front, because that is the part an operator cannot
// discover from the run: arming this is the only thing that moves an agent onto the
// streaming transport, and a streamed turn is accounted from the stream's own usage chunk
// rather than from a completed response body.
export const LOOP_DETECTION_HINT =
  "Watch this agent's replies as they arrive and abandon one that has degenerated into repetition, retrying the turn as though the request had failed — so a runaway costs one truncated reply instead of a full output cap, and never enters the agent's context. Arming it also moves this agent onto gg's streaming transport, which is what makes a partial reply visible at all; every other agent in the run is untouched. Off unless you arm it, per agent: the detector is worth its transport change on a model observed to loop, and nothing at all on one that never has.";

// The knobs of the window rule, in the order they read as a sentence: how far back the
// detector looks, how often a word must recur to be suspicious, how many such words make
// the window suspicious, how long that must persist before the reply is abandoned — and
// last, the backstop that does not read the window at all.
//
// `key` is typed as the contract's own optional fields, so a knob added to (or renamed
// in) `GgLoopDetection` is a compile error here rather than a control writing a key gg
// drops as unknown. `enabled` is deliberately not among them: it is the lever's switch,
// not one of its settings.
export interface LoopDetectionSpec {
  key: Exclude<keyof GgLoopDetection, "enabled">;
  label: string;
  hint: string;
  // gg's own default for the knob, shown as the field's placeholder so an empty box
  // reads as the real figure rather than as "nothing". Left empty, the knob is not
  // written at all — which is exactly "take gg's default", so a seeded value is
  // deliberately NOT used here (unlike the run ceilings, which seed their fields):
  // writing 256 for a window nobody chose freezes today's default into every stored
  // configuration.
  ggDefault: number;
}

export const LOOP_DETECTION_SPECS: ReadonlyArray<LoopDetectionSpec> = [
  {
    key: "windowWords",
    label: "Window (words)",
    ggDefault: 256,
    hint: "How many of the most recent words the detector looks back over. A word is a whitespace-separated run of characters — plus a fixed-width slice whenever a run exceeds gg's internal cap, which is what makes a whitespace-free loop (`a();a();a();…`) detectable rather than one unbounded word. Empty takes gg's default of 256.",
  },
  {
    key: "repeatThreshold",
    label: "Repeats before suspicious",
    ggDefault: 32,
    hint: "How many times one word may occur inside the window before it counts as an offender — strictly more than this makes one. Raising it tolerates denser legitimate repetition (a data literal, a long table) at the cost of catching a loop later. Empty takes gg's default of 32, which is a word occupying more than an eighth of a 256-word window.",
  },
  {
    key: "minOffenders",
    label: "Offenders to saturate",
    ggDefault: 2,
    hint: "How many DISTINCT offenders must be present at once for the window to count as saturated. More than one is required because a single very common token (`the`, `0,`, a brace) is ordinary, while a loop repeats a whole fragment and so saturates several words together. Empty takes gg's default of 2.",
  },
  {
    key: "minSaturatedRun",
    label: "Saturated words before abandoning",
    ggDefault: 3000,
    hint: "How many consecutive words must arrive while the window stays saturated before the reply is abandoned. This is the term that separates a loop from legitimately repetitive content: a tilemap literal or a long table saturates the window and then ENDS, while a loop saturates it and never stops. 0 abandons as soon as the window saturates — the unmodified frequency rule, and a deliberate setting rather than a mistake. Empty takes gg's default of 3000.",
  },
  {
    key: "maxResponseChars",
    label: "Reply ceiling (characters)",
    ggDefault: 250_000,
    hint: "A hard ceiling on one reply, and the backstop for a runaway that is not repetitive enough to trip the window rule. 0 turns the backstop off and leaves only the repetition rule. Empty takes gg's default of 250,000.",
  },
];

// --- Modules --------------------------------------------------------------------
//
// Every unit of per-agent state gg keeps behind a capability is a **module** (see
// gg/modules): memories, the task list, the board, the skills read-set and the thread
// archive, plus the conversation window itself. Two things about a module are authored
// here — whether its holder's *prompt* carries it (`ownership`, a param on the two
// capabilities that still offer it; see [ownershipParam]), and which modules an FSM
// transition hands to the next state (the transfer list on each edge). Both name the
// same closed taxonomy, so it is spelled once.

// The module kinds a transition may carry, in the contract's own declaration order
// (`GgModuleKind` in `crates/core/src/gg.rs`), each with what carrying it actually
// means for the state that receives it.
//
// `value` is typed as the contract's `GgModuleKind`, so a kind added to or renamed in
// the contract is a compile error here rather than a checkbox writing a name gg drops
// as unknown.
export const MODULE_KINDS: ReadonlyArray<{
  value: GgModuleKind;
  label: string;
  hint: string;
}> = [
  {
    value: "history",
    label: "History",
    hint: "The conversation itself. The next state opens on everything its predecessor said and was told, under its own system prompt. Without it the state starts on a blank window and reads only the handoff note.",
  },
  {
    value: "memories",
    label: "Memories",
    hint: "The memory instance, live — the same notes, not a copy of a summary of them.",
  },
  {
    value: "tasks",
    label: "Tasks",
    hint: "The task list in exactly the state it was left in, ticks and blocked-by edges included.",
  },
  {
    value: "board",
    label: "Board",
    hint: "The epic/issue board. It is run-global, so this changes only whether the next state holds a handle on it, never which board it is.",
  },
  {
    value: "skills",
    label: "Skills",
    hint: "Which skills have been read. Their bodies are pinned in the window, so this is only meaningful carried alongside History.",
  },
  {
    value: "archive",
    label: "Archive",
    hint: "The archived thread sections and their search index, so a successor can still search what its predecessor put away.",
  },
];

// Which capability backs each module kind — what lets a module's row link back to the
// capability an operator would tune.
//
// Deliberately *not* the same list as `MODULE_CAPABILITIES` in `crates/gg/src/modules.rs`,
// which is the narrower question of which capabilities carry an [ownership](ownershipParam)
// param — two of these five. This map answers "what would I go and configure to change
// this module?", which every kind but one has an answer to.
//
// `history` is that one, and its absence is load-bearing: the window is not a capability,
// it is the agent. Every agent has one, always.
export const MODULE_CAPABILITY_IDS: ReadonlyMap<GgModuleKind, string> = new Map(
  [
    ["memories", "memories"],
    ["tasks", "tasks"],
    ["board", "project-management"],
    ["skills", "skills"],
    ["archive", "agent-managed-context"],
  ],
);

// One capability param off one agent's profile, or null when the profile, the capability or
// the key is absent.
//
// This is the DECLARED half of every module question — what the configuration asked for, as
// against what `ggModules` observes it got. The two diverge in ordinary, legal ways (an
// `inherited` agent with no spawner silently gets its own store), and saying so is the most
// useful thing the module surfaces do; neither can be said without reading the params, which
// nothing in the monitor did before.
export function capabilityParam(
  set: GgCapabilitySet | null,
  agent: string | null | undefined,
  capabilityId: string,
  key: string,
): unknown {
  const capability = agentProfile(set, agent)?.capabilities.find(
    (c) => c.id === capabilityId,
  );
  if (!capability) return null;
  const params = capability.params as Record<string, unknown> | undefined;
  return params?.[key] ?? null;
}

// The capability whose `states` param *is* a machine, and the param key it reads
// (`CAPABILITY_FSM` / `FSM_PARAM_STATES` in `crates/core/src/gg.rs`). Named constants
// because three modules — the catalog entry, the draft's state editor, and the
// validation that mirrors gg's launch checks — all have to spell them the same way.
export const FSM_CAP_ID = "fsm";
export const FSM_STATES_PARAM = "states";

// The capability that *is* the responses-as-code [agent type](GgAgentMode)
// (`CAPABILITY_RESPONSES_AS_CODE` in `crates/core/src/gg.rs`). Like `fsm` it is how the
// wire format records which type an agent is, not a feature listed beside its peers —
// the editor never offers it as a capability row.
export const RESPONSES_AS_CODE_CAP_ID = "responses-as-code";

// The two capabilities that record an [agent type](GgAgentMode) rather than a feature of
// one. Their `enabled` flag is read off (and written from) the agent's type; nothing
// else in the editor may switch them.
export function isModeCapability(id: string): boolean {
  return id === FSM_CAP_ID || id === RESPONSES_AS_CODE_CAP_ID;
}

/**
 * Whether a capability's configuration is read at all by an agent of this
 * [type](GgAgentMode).
 *
 * The two mode-marker capabilities apply under exactly their own type, because they
 * *are* it. A machine holds nothing else: it has no turns, and each of its states runs
 * another profile with that profile's configuration, so every remaining capability is
 * inapplicable to it. Everything else applies under whichever worker types its spec
 * names.
 */
export function capabilityAppliesToMode(
  cap: CapSpec,
  mode: GgAgentMode,
): boolean {
  if (cap.id === FSM_CAP_ID) return mode === "fsm";
  if (cap.id === RESPONSES_AS_CODE_CAP_ID) return mode === "rac";
  if (mode === "fsm") return false;
  return (cap.modes ?? WORKER_MODES).includes(mode);
}

/**
 * The capabilities the editor **lists** for an agent of this type — everything the type
 * reads, minus the two mode markers, which the type selector already stands for. Empty
 * for a machine, which is the whole of "an FSM agent has no capabilities".
 */
export function capabilitiesForMode(mode: GgAgentMode): ReadonlyArray<CapSpec> {
  return CAPABILITIES.filter(
    (cap) => !isModeCapability(cap.id) && capabilityAppliesToMode(cap, mode),
  );
}

/** One capability's catalog entry, or `undefined` for an id the catalog has none for. */
export function capabilitySpec(id: string): CapSpec | undefined {
  return CAPABILITIES.find((cap) => cap.id === id);
}

// Whether a module-backed capability's state is carried in its holder's **prompt**
// (`owned` — every turn, as a pinned block and a prompt section) or is reachable only
// through the tools it contributes (`unowned`). The empty value is the default
// (`owned`).
export const MODULE_OWNERSHIP_OPTIONS = [
  { value: "", label: "Owned (default)" },
  { value: "unowned", label: "Unowned — tools only, not in the prompt" },
] as const;

// One module-backed capability's `ownership` control. The label is shared across the
// two that offer it — project management and agent-managed context — so the knob reads
// as one idea rather than two; `what` names the state at stake so the hint says what an
// unowned arm actually costs that capability.
//
// The other three module-backed capabilities have no unowned arm at all, and which one
// is missing for which reason is worth knowing before wondering where the picker went.
// The task list is what an agent steers its work by from turn to turn, so it is always
// owned. Skills and memories offer no such knob (`MODULE_CAPABILITIES` in
// `crates/gg/src/modules.rs` is two entries), because on both of them it would be a way
// of switching the capability off while pretending it was on: what a memory strategy puts
// in the window IS what having memories means under it, and the strategy is already that
// knob — `keyword-search` is the arm that pins nothing — while a skills catalogue the
// agent is never shown leaves it able to read a skill only by being handed its name,
// which is the capability disabled with extra steps rather than an arm of a study.
//
// Two behaviours follow and are worth stating: the pinned memory index cannot be
// withheld, and a linked holder is always told when another holder adds, revises or
// removes a memory.
function ownershipParam(what: string): ParamSpec {
  return {
    key: "ownership",
    label: "Ownership",
    kind: "select",
    options: MODULE_OWNERSHIP_OPTIONS,
    hint: `Whether this agent's prompt carries ${what}. Owned rebuilds it into the window on its own schedule and describes it in the system prompt, so the agent is told what it holds on every turn. Unowned removes both, and leaves the tools, the state and the telemetry unchanged: the agent reaches ${what} through its tools instead, and pays no context for it between calls.`,
  };
}

// The workspace-relative directory gg reads authored skills from when a
// configuration names none (`crates/gg/src/skills.rs`).
export const DEFAULT_SKILLS_DIR = ".gg/skills";

// The skills gg ships itself — one per family of the functions it offers
// (`FAMILIES` in `crates/gg/src/skills.builtin.rs`), in the order gg lists them, which
// is roughly "the workspace, then the work, then yourself".
//
// They exist because the overwhelming majority of runs author no skills at all: the
// capability was a mechanism with an empty library, and did nothing whatever unless
// somebody had thought to fill it. Not a word of one is prose kept anywhere — a
// built-in is generated from the same live tool definitions and documentation runtime
// the agent's own calls come from, so it cannot drift from the tools it describes.
//
// The ids are the skill *names*, which is what `read_skill` takes and what this param
// records, so they are the same strings gg matches on both sides.
export const BUILT_IN_SKILL_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  {
    value: "gg-filesystem",
    label: "gg-filesystem — reading, writing and editing workspace files",
  },
  { value: "gg-shell", label: "gg-shell — running shell commands" },
  {
    value: "gg-project",
    label: "gg-project — the epic/issue board other agents implement from",
  },
  {
    value: "gg-tasks",
    label: "gg-tasks — the agent's own blocked-by task list",
  },
  {
    value: "gg-memory",
    label: "gg-memory — memories that outlive the conversation",
  },
  {
    value: "gg-skills",
    label: "gg-skills — reading skills, including this one",
  },
  {
    value: "gg-context",
    label:
      "gg-context — evicting, archiving, searching and compacting its window",
  },
  {
    value: "gg-delegation",
    label: "gg-delegation — spawning child agents and handing its session on",
  },
  {
    value: "gg-views",
    label:
      "gg-views — showing itself a file, a value or a signature (code mode)",
  },
  {
    value: "gg-programs",
    label: "gg-programs — fetching a program it already ran (code mode)",
  },
  {
    value: "gg-session",
    label: "gg-session — the one call that ends its session",
  },
];

// What a built-in skill IS, said once here rather than eleven times on the checkboxes:
// where its content comes from, why an agent may be offered fewer than eleven, and what
// switching one off actually does.
//
// The "only when the agent has it" rule is the load-bearing half. A family is offered
// only when this agent really holds at least one of its functions, so the list is a
// ceiling rather than a roster: switching nothing off on an agent with no board still
// yields no `gg-project`.
export const BUILT_IN_SKILLS_HINT = `Skills gg writes itself, one per family of the functions this agent has — generated from its live tools rather than authored, so they cannot describe a tool it was not given. Under tool calling a built-in's body is the family's real tool definitions and parameters; under responses-as-code it opens a documentation view per function on the turn after it is read. A family is offered only when the agent holds at least one of its functions, and a skill of the same name in the skills directory replaces it. Switching one off withholds it from this agent entirely — the family's functions still work, the manual for them is simply not there. ${TOGGLES_HINT}`;

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
// The memory bounds gg falls back to (`crates/gg/src/memories.rs`). They were written
// for a scratchpad of a handful of short notes and are now sized for a store an agent
// really curates: 64 notes of 4 096 characters, with no aggregate ceiling on the
// scratchpad at all — which is why there is no `DEFAULT_MEMORY_MAX_TOTAL_LEN` here to
// seed that field with. The description ceiling is 256 characters under every strategy,
// because a description is an index line the window pays for on every turn.
export const DEFAULT_MEMORY_MAX_COUNT = 64;
export const DEFAULT_MEMORY_MAX_LEN_PER = 4096;
export const DEFAULT_MEMORY_MAX_LEN_DESCRIPTION = 256;
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

// The memory **scopes** (see gg/memories): which memory instance an agent instance binds
// to. Orthogonal to the strategy, which decides what a memory *is*; this decides whose it
// is. The empty value is the default (`isolated`), which is the only behaviour gg had
// before instances could be shared and is what every existing configuration keeps.
export const MEMORY_SCOPE_OPTIONS = [
  { value: "", label: "Isolated (default)" },
  { value: "shared", label: "Shared across this agent's instances" },
  { value: "inherited", label: "Inherited from the spawner" },
  { value: "read-only", label: "Inherited, read-only" },
] as const;

// What the scope picker means, in one paragraph, including the two rules that make the
// four coherent and that a reader of a recorded configuration has to know.
export const MEMORY_SCOPE_HINT =
  "Which memory instance this agent binds. Isolated gives every instance its own. Shared binds one store per agent profile, so parallel instances of this agent curate it together. Inherited binds the spawner's store when this agent is spawned as a subagent (and its own otherwise), chaining however deep. Read-only is inherited without write access, and only for an inherited handle: an agent that ends up with its own store may write it, and a read-only agent's own inherited subagent gets write access back. Linked holders are told, in their next prompt, when another holder adds, revises or removes a memory.";

// The memory strategies that bound the store by a **count** of notes: the scratchpad
// (whose notes live in the window) and keyword search. A markdown run is bounded by its
// index instead, since every memory needs a line in it.
export const COUNTED_MEMORY_STRATEGIES = ["", "keyword-search"] as const;

// The scratchpad strategy alone — the only one whose notes are carried in the window, and
// so the only one an aggregate length budget could bound (it has none by default; the
// field is offered here because this is the only strategy where setting one means
// anything).
export const SCRATCHPAD_MEMORY_STRATEGY = [""] as const;

// The strategy that keeps a pinned markdown index — the only one with an index to bound.
export const INDEXED_MEMORY_STRATEGY = ["markdown"] as const;

// The strategy that offers `search_memories` — the only one with results to bound.
export const SEARCHING_MEMORY_STRATEGY = ["keyword-search"] as const;

// What each memory strategy does — the detail lifted off the picker's option labels
// into the field's help tooltip.
export const MEMORY_STRATEGY_HINT =
  "Scratchpad keeps every memory's body in the context window, bounded by a count and a per-note character ceiling (and by an aggregate budget, if you set one — there is no default). Markdown pins only an index of slugs and descriptions, and the model reads a memory's contents on demand; the index length is what bounds the population. Keyword search pins nothing at all — the model finds a memory with `search_memories` and reads it back. Under every strategy the memories live inside gg, never on disk.";

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
    hint: "May be spawned with `spawn_subagent`. Needs the Subagents capability to be reachable.",
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

// The per-hook timeout gg falls back to when a hook declares none (`DEFAULT_HOOK_TIMEOUT`
// in `crates/gg/src/hooks.rs`). Generous, because a hook command is typically a build or
// a test suite rather than a quick check.
export const DEFAULT_HOOK_TIMEOUT_SECS = 300;

// The compaction strategies gg resolves at run time (`crates/gg/src/compaction.rs`),
// in editor order — grouped by who condenses the thread: the working agent itself (the
// first two and the last) or a separate handoff model, out of band. An unrecognized name
// falls back to the default rather than failing to launch, so the field stays a closed
// picker rather than free text.
export const SUMMARIZER_OPTIONS = [
  { value: "", label: "Self-summarization (default)" },
  { value: "self-compaction", label: "Self-compaction" },
  { value: "handoff-summarization", label: "Handoff summarization" },
  { value: "handoff-compaction", label: "Handoff compaction" },
  { value: "memory-compaction", label: "Memory compaction" },
] as const;

// The two strategies that condense the thread on a **separate** model — the only ones
// that read the compaction capability's `model` param, and so the only ones its control
// is offered under.
export const HANDOFF_SUMMARIZERS = [
  "handoff-summarization",
  "handoff-compaction",
] as const;

// What each compaction strategy does — the detail lifted off the picker's option
// labels into the field's help tooltip.
export const SUMMARIZER_HINT =
  "Self-summarization (the default) asks the agent, in its own thread, to write the summary its next context is rebuilt from. Self-compaction gives the agent a `compact` tool it calls with a summary AND the files to re-read, so it chooses what survives. The two Handoff strategies do the same two jobs on a separate model (set below), which reads the thread as labelled messages and never interrupts the agent. Memory compaction requires Memories: the agent writes its working state to memories instead of a summary, and those cross the boundary verbatim.";

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
        defaultValue: String(DEFAULT_SHELL_MAX_LINES),
        showWhenImplementation: TRUNCATING_SHELL_OUTPUT_MODES,
        hint: "Trailing lines of a truncated command's output returned inline. Clear it for no line ceiling.",
      },
      {
        key: "maxChars",
        label: "Max characters",
        kind: "number",
        defaultValue: String(DEFAULT_SHELL_MAX_CHARS),
        showWhenImplementation: TRUNCATING_SHELL_OUTPUT_MODES,
        hint: "Trailing characters of a truncated command's output returned inline. With both ceilings set, the tighter one decides; clear both and gg uses its defaults.",
      },
    ],
    tools: ["shell"],
  },
  // --- Filesystem -------------------------------------------------------------
  //
  // One capability per filesystem primitive rather than a single `filesystem`
  // umbrella: each tool is its own experimental variable, with its own
  // implementation and params.
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
        showWhenImplementation: CAPPED_READ_MODES,
        hint: "Lines per call under either capped mode.",
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
    id: RESPONSES_AS_CODE_CAP_ID,
    name: "Responses as code",
    // No group: this entry is the RaC [agent type](GgAgentMode)'s settings panel, and
    // the type selector is its switch, so it is never listed as a capability row. See
    // `group`.
    //
    // `purpose` is required of every spec and this one is read nowhere: the APIs panel
    // is the tab, and the tab strip already says what it is.
    purpose:
      "The agent's whole reply is a program over the tools, run in a wasm sandbox.",
    params: [
      {
        key: "language",
        label: "Program language",
        kind: "select",
        options: PROGRAM_LANGUAGE_OPTIONS,
        hint: PROGRAM_LANGUAGE_HINT,
      },
      {
        key: "timeoutSecs",
        label: "Execution timeout (seconds)",
        kind: "number",
        placeholder: "e.g. 30",
        hint: "Wall-clock ceiling on one program's guest execution. Time the program spends parked in a tool call is excluded. gg's default is 30 seconds.",
      },
      {
        key: "maxMemoryBytes",
        label: "Max memory (bytes)",
        kind: "bytes",
        placeholder: "e.g. 67108864",
      },
      {
        key: "docViewTypes",
        label: "Documentation types",
        kind: "select",
        options: DOC_VIEW_TYPES_OPTIONS,
        hint: DOC_VIEW_TYPES_HINT,
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
  {
    id: "docview-close",
    name: "Close documentation",
    group: "Context",
    // Nothing opens a documentation view outside responses-as-code, so there is nothing for a
    // tool-calling agent to close.
    modes: ["rac"],
    defaultOn: false,
    purpose:
      "Let the agent take a documentation view back out of its own context window.",
  },
  {
    id: "program-library",
    name: "Program library",
    group: "Models & tools",
    // There are no programs in a tool-calling session to keep, and gg gates the
    // capability on the execution mode itself, so it is offered to a RaC agent only.
    modes: ["rac"],
    purpose:
      "Keep every program the agent runs, so it can fetch one back, patch it, and hand it over to be run.",
    params: [
      {
        key: "keep",
        label: "Programs kept",
        kind: "number",
        placeholder: "e.g. 20",
        hint: "How many of the agent's most recent programs are retained and can be fetched with `programs.get`. Older ones are dropped, and asking for one says which turns are still held. `0` keeps every program of the session; empty is gg's default of 20.",
      },
    ],
  },
  // --- Context ----------------------------------------------------------------
  {
    id: "context-window-override",
    name: "Context Window Override",
    group: "Context",
    purpose:
      "Run the model against a smaller context window than its real one.",
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
      "Seed the agent's opening context with the test case's specifications and reference images.",
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
        kind: "model",
        slotKey: "modelSlot",
        placeholder: "e.g. openai/gpt-4.1-mini",
        // Only the handoff strategies condense on another model at all, so the field
        // is offered only under them rather than sitting inert beside every other
        // strategy.
        showWhenImplementation: HANDOFF_SUMMARIZERS,
        hint: "The model that condenses the thread instead of the agent. Take it from a model slot to pick it when the run is launched, or pin one here. Leave it unset (or name a model that will not resolve) and gg condenses on the agent's own model rather than skipping the compaction.",
      },
    ],
    tools: ["compact"],
  },
  {
    id: "agent-managed-context",
    name: "Agent-managed context",
    group: "Context",
    purpose:
      "The agent reclaims window space itself: evicting file views, archiving thread sections.",
    params: [ownershipParam("what it has archived")],
    tools: ["evict_file_view", "archive_thread", "search_archive"],
    toolAblation: [
      { label: "Evict file views", tools: ["evict_file_view"] },
      {
        label: "Archive & search the thread",
        tools: ["archive_thread", "search_archive"],
        hint: "`archive_thread` and `search_archive` are withheld together: an archive the agent cannot search back is unreadable.",
      },
    ],
  },
  // --- Knowledge --------------------------------------------------------------
  {
    id: "skills",
    name: "Skills",
    group: "Knowledge",
    // Not "authored markdown" any more, and the change is bigger than the wording: a
    // skill may be prose, an importable code module bound at `lib.<key>` in every later
    // program's scope, a script that runs once when the skill is first read, or any
    // combination — and gg ships eleven of its own, so the capability is worth enabling
    // in a workspace that authored none.
    purpose:
      "Skills — prose, code, or both — catalogued in the prompt and pinned once read.",
    defaultOn: true,
    params: [
      {
        key: "dir",
        label: "Skills directory",
        kind: "text",
        defaultValue: DEFAULT_SKILLS_DIR,
        hint: "Where in the workspace gg reads authored skills from. Relative paths are joined onto the workspace; an absolute path is used as-is. A `<name>.md` file there is a prose skill; a `<name>/` directory is one too, with its front matter and body in a required `skill.md` beside an optional `skill.<ext>` (a module the agent's programs can call) and `on-use.<ext>` (a script that runs once, when the skill is first read). The extension is the program language of the agent reading it — `skill.ts` for a TypeScript agent — so a directory may carry one per language.",
      },
      {
        key: "builtIns",
        label: "Built-in skills",
        kind: "toggles",
        options: BUILT_IN_SKILL_OPTIONS,
        hint: BUILT_IN_SKILLS_HINT,
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
    // Each limit is offered only under the strategies that read it — gg ignores the rest,
    // and a box that changes nothing can only mislead. A value stored for a limit the
    // current strategy hides is still kept and re-saved, so one capability set can still
    // be swept across all three arms without retyping its params. Zero means unlimited
    // everywhere.
    params: [
      {
        key: "scope",
        label: "Scope",
        kind: "select",
        options: MEMORY_SCOPE_OPTIONS,
        hint: MEMORY_SCOPE_HINT,
      },
      {
        key: "maxCount",
        label: "Max memories",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_COUNT),
        showWhenImplementation: COUNTED_MEMORY_STRATEGIES,
        hint: `How many notes the model may keep at once; gg's default is ${DEFAULT_MEMORY_MAX_COUNT}. 0 for unlimited.`,
      },
      {
        key: "maxLenPerMemory",
        label: "Max length each (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_PER),
        hint: `Character ceiling on any one note's body — ${DEFAULT_MEMORY_MAX_LEN_PER} by default, and 8192 under the two file-shaped strategies, whose bodies are not in the window. A code memory's module and its on-use script are not bodies and are charged to neither this nor the total: they are a capability the agent gains, not context it carries. 0 for unlimited.`,
      },
      {
        key: "maxTotalLen",
        label: "Max length total (chars)",
        kind: "number",
        // No `defaultValue`: the scratchpad has no aggregate ceiling of its own any
        // more, so seeding one here would invent a budget gg does not impose and quietly
        // save it into every configuration opened in the editor.
        placeholder: "unlimited",
        showWhenImplementation: SCRATCHPAD_MEMORY_STRATEGY,
        hint: "Character ceiling across all note bodies together — the budget for what the window carries. Empty is no ceiling, which is gg's default: the per-note ceiling and the count are what bound a scratchpad now. 0 is unlimited too.",
      },
      {
        key: "maxLenIndex",
        label: "Max index length (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_INDEX),
        showWhenImplementation: INDEXED_MEMORY_STRATEGY,
        hint: "Character ceiling on the pinned index. A create whose entry would not fit is refused, so this is what bounds how many memories a markdown run can hold. 0 for unlimited.",
      },
      {
        key: "maxLenDescription",
        label: "Max description length (chars)",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_LEN_DESCRIPTION),
        hint: `Character ceiling on a memory's one-line description; gg's default is ${DEFAULT_MEMORY_MAX_LEN_DESCRIPTION}, under every strategy. A description is an index line, not a body — under the markdown strategy the window pays for every one of them on every turn, and under the others it is what a search result or a linked-holder notice shows. 0 for unlimited.`,
      },
      {
        key: "maxResults",
        label: "Max search results",
        kind: "number",
        defaultValue: String(DEFAULT_MEMORY_MAX_RESULTS),
        showWhenImplementation: SEARCHING_MEMORY_STRATEGY,
        hint: "How many memories one `search_memories` call reports. 0 for unlimited.",
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
      // No `ownership` param: the task list is always carried in its holder's prompt. It
      // is what the agent steers by from turn to turn, so an unowned one — reachable
      // through the tools and absent from the prompt — is not a shape this capability has.
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
      "A run-global board of scoped issues gg dispatches to agents as their blockers clear.",
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
        hint: "How many times gg re-dispatches an issue whose assigned agent ended without finishing — a spent turn ceiling, a breached limit, a model error — before marking the issue failed.",
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
      ownershipParam("the board"),
    ],
    tools: [
      "create_epic",
      "create_issue",
      "update_issue",
      "set_issue_blocked_by",
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
        hint: "Off gives this agent read-only access to the board — it still sees it and waits on issues, but files no new work.",
      },
      {
        label: "Revise the board",
        tools: ["update_issue", "remove_epic", "remove_issue"],
      },
    ],
  },
  // --- Delegation -------------------------------------------------------------
  {
    id: "subagents",
    name: "Subagents",
    group: "Delegation",
    purpose:
      "Spawn other agents — run in parallel, block on them, message them, receive their return value.",
    params: [
      // The parallelism cap is deliberately **not** here: it bounds the whole run's
      // concurrency (including the agents a board dispatches, with no subagents
      // capability in sight), so it lives with the run limits below.
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
    id: "agent-persistence",
    name: "Agent persistence",
    group: "Delegation",
    purpose:
      "One instance of this agent runs at a time, and each opens on the views the last one left open.",
    defaultOn: false,
  },
  {
    id: "exec",
    name: "Exec",
    group: "Delegation",
    purpose:
      "Let this agent replace itself with one running another profile, carrying its whole conversation across.",
    defaultOn: false,
    tools: ["exec"],
  },
  {
    id: "fork",
    name: "Fork",
    group: "Delegation",
    purpose:
      "Let this agent run a copy of itself — a child that opens knowing everything its parent knew.",
    defaultOn: false,
    tools: ["fork"],
  },
  {
    id: FSM_CAP_ID,
    name: "Process",
    // No group: this entry is never listed among an agent's capabilities. See `group`.
    // A machine is its `states`: gg refuses to launch an agent that enables this and
    // declares none, because an FSM agent has no turns of its own.
    requiresAuthoring: true,
    // Never rendered as a capability row either: this entry is the FSM [agent
    // type](GgAgentMode)'s settings panel — the machine itself.
    purpose:
      "Run this agent as a state machine whose states each run one of the other agent profiles.",
    defaultOn: false,
    params: [
      {
        key: FSM_STATES_PARAM,
        label: "States",
        kind: "states",
        hint: "The machine, in order — the first state is the one it enters. Each state runs an agent profile this configuration declares (never another machine), and each transition names the state it leads to, when the model should take it, and which modules travel with it. A transition carries only the modules it names; one that names none starts its successor on nothing. A new transition is pre-filled with History.",
      },
    ],
    tools: ["transition_state"],
    // No ablation slider: withholding `transition_state` leaves a machine that can
    // only ever sit in its entry state, which is not an arm anyone would run.
  },
];

// The entries the editor renders somewhere other than the capability list, resolved
// once. Neither is listed among an agent's capabilities — both
// [mode-markers](isModeCapability) are turned on by the [agent type](GgAgentMode)
// selector and their params authored in the panel that type opens — but both are still
// specs, so the editor needs them.
export const RESPONSES_AS_CODE_CAP: CapSpec = CAPABILITIES.find(
  (c) => c.id === RESPONSES_AS_CODE_CAP_ID,
)!;
export const FSM_CAP: CapSpec = CAPABILITIES.find((c) => c.id === FSM_CAP_ID)!;
export const DEFAULT_CAP_IDS = CAPABILITIES.filter((c) => c.defaultOn).map(
  (c) => c.id,
);
// The module kinds whose capability still offers an [ownership](ownershipParam) control,
// derived from the catalog rather than listed a second time — so a capability that gains
// or loses the param carries this along with it instead of leaving a reader of a module
// surface to be told about a declaration nobody could have made.
//
// That is what it is for: the observed side of the module surfaces compares what a profile
// asked for against what its instances got, and a kind that cannot be asked has to be read
// as "nothing declared" rather than as the param's old default. See `declaredModuleConfig`.
export const OWNERSHIP_MODULE_KINDS: ReadonlySet<GgModuleKind> = new Set(
  [...MODULE_CAPABILITY_IDS]
    .filter(([, capability]) =>
      CAPABILITIES.find((cap) => cap.id === capability)?.params?.some(
        (param) => param.key === "ownership",
      ),
    )
    .map(([kind]) => kind),
);

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

// How many agents gg runs at once when a configuration names no cap. Unlike the
// ceilings, this one is always in force — a run always has *some* pool — so the
// default is a number rather than "off".
export const DEFAULT_MAX_PARALLEL = 16;

// One execution ceiling's control. `key` is the wire field on
// `GgCapabilitySet.limits`; `kind` is what makes the value legible *and* checkable
// — a `count` is a whole number of turns, seconds or errors, a `fraction` is a rate
// in 0–1, and an `amount` is money, which is the only one of the three that is
// meaningfully fractional above 1.
export interface RunLimitSpec {
  key: keyof GgRunLimits;
  label: string;
  // `mib` is a size the operator reads and writes in **mebibytes** while the wire field
  // stays the byte count gg reads: the draft holds the MiB figure, and [ggConfigDraft]
  // multiplies it out on save and divides it back on load. It is its own kind rather than
  // a `count` with a unit in its label because of that conversion, and because a value
  // that is not a whole MiB is legitimate here — a stored ceiling that is not a round
  // multiple has to survive a round-trip.
  kind: "count" | "fraction" | "amount" | "mib";
  placeholder?: string;
  hint: string;
  // The value gg falls back to when this ceiling is unset, seeded into a fresh
  // configuration's field so it shows gg's real default rather than an empty box. The
  // two error ceilings have one; the turn ceiling is unbounded by default and runtime
  // and cost are off when empty, so those seed nothing.
  defaultValue?: string;
}

// One mebibyte in bytes — the factor the `mib` ceiling converts through, spelled once
// because both the load and the save path multiply by it.
export const BYTES_PER_MIB = 1024 * 1024;

// gg's default ceiling on the replay capture journal, in MiB. Unlike the others this one
// is always in force — capture runs for every run — so the default is a number rather
// than "off".
export const DEFAULT_REPLAY_MAX_MIB = 256;

// The guardrails, in the order they read as a sentence: how much of the run happens
// at once, then how long it may go on for, then how badly it may go, then how much it
// may cost — and last, the one that bounds not the run but the record kept of it.
//
// `key` is typed as `keyof GgRunLimits`, and [ggConfigDraft]'s draft is a total
// record over the same keys, so a ceiling added to the contract cannot ship without
// a control here.
export const RUN_LIMIT_SPECS: ReadonlyArray<RunLimitSpec> = [
  {
    key: "maxParallel",
    label: "Max parallel agents",
    kind: "count",
    defaultValue: String(DEFAULT_MAX_PARALLEL),
    placeholder: `e.g. ${DEFAULT_MAX_PARALLEL}`,
    hint: `How many of the run's agents may run at once, counting the root and every subagent, issue implementer and reviewer; gg's default is ${DEFAULT_MAX_PARALLEL}. An agent spawned while the pool is full queues for a slot rather than being refused, so this stops nothing — it only serializes the run. A suspended agent (waiting on its subagents or an issue) frees its slot, and takes priority over any not-yet-started agent when one opens up.`,
  },
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
    hint: `How many error turns in a row end an agent; gg's default is ${DEFAULT_MAX_CONSECUTIVE_ERRORS}. A turn is an error when the work it declared could not be carried out — a failed model call, a program that did not compile, threw, or was stopped at a sandbox ceiling. A tool call that failed inside a program that carried on is not one.`,
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
    hint: `How many of an agent's most recent turns the rate is measured over, and also the minimum sample: the ceiling cannot fire until the agent has taken this many turns. gg's default is ${DEFAULT_ERROR_RATE_WINDOW}.`,
  },
  {
    key: "maxCost",
    label: "Cost (USD)",
    kind: "amount",
    placeholder: "e.g. 25",
    hint: "Ceiling on the whole run's accumulated cost, checked at each agent's turn boundary. The turn that crosses it completes, so the recorded cost can exceed it by up to one turn per running agent. A run whose model reports no cost is never stopped by it.",
  },
  {
    key: "replayMaxBytes",
    label: "Session journal (MiB)",
    kind: "mib",
    placeholder: `e.g. ${DEFAULT_REPLAY_MAX_MIB}`,
    hint: `Ceiling on the session capture journal gg writes as it runs — the one thing a run that hangs leaves behind. Crossing it stops capture and marks the record truncated; the run itself continues. Empty means gg's default of ${DEFAULT_REPLAY_MAX_MIB} MiB, and 0 is read as no ceiling at all.`,
  },
];
