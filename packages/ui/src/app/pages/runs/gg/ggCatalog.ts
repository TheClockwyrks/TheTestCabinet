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

// The profile with `agentId`, falling back to the Root when the run declares no such
// profile or the id is not yet known — an agent whose spawn event has not arrived carries
// no profile id, and the Root is the working guess until it does. Null before gg announces
// the configuration at all.
//
// Resolution is by [slug](GgAgentConfig.slug) and only by slug, mirroring
// `GgCapabilitySet::agent`. Every set reaching these surfaces is a *recorded* one, whose
// internal ids the launch resolved away, and every telemetry row names a profile by its
// slug. Two profiles may carry one display name, so a lookup by name would silently merge
// them into whichever came first.
export function agentProfile(
  set: GgCapabilitySet | null,
  agentId: string | null | undefined,
): GgAgentConfig | null {
  if (!set?.agents?.length) return null;
  return (
    (agentId ? set.agents.find((a) => a.slug === agentId) : undefined) ??
    set.agents[0]!
  );
}

// One profile's display name, or the slug itself where the run declares no such profile — a
// dangling reference reads as the slug it failed to resolve rather than as nothing. Mirrors
// `GgCapabilitySet::agent_name`.
//
// The single place a profile slug becomes prose. For prose only: names may repeat, so a
// surface that has to name a profile unambiguously names its slug (and one that lists
// profiles side by side shows both).
export function agentProfileName(
  set: GgCapabilitySet | null,
  agentId: string,
): string {
  return set?.agents?.find((a) => a.slug === agentId)?.name ?? agentId;
}

// Whether the profile with `agentId` has the capability on — the per-agent question, and
// the one every agent-scoped surface (which files its folder offers, which panes its
// Knowledge file splits into, which bands its context graph draws) has to ask.
export function agentCapabilityOn(
  set: GgCapabilitySet | null,
  agentId: string | null | undefined,
  id: string,
): boolean {
  return (
    agentProfile(set, agentId)?.capabilities.some(
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

// The **display name** a fresh configuration's root agent is *born* with. It is a starting
// value and nothing more: a profile's name is prose, mutable and not unique, and nothing
// resolves a reference by reading it. Which profile is the root is a flag the editor holds
// (and, on the wire, position — gg reads the root off `agents[0]`), so this can be renamed
// to anything and the role moved to another profile. Mirrors `ROOT_AGENT` in
// `crates/core/src/gg.rs`.
export const ROOT_AGENT = "Root";

// The id a fresh configuration's root profile is minted with, and what a reference means
// when it means "whichever profile drives this run". Mirrors `ROOT_PROFILE_ID` in
// `crates/core/src/gg.rs`. Unlike the name beside it an id is never rewritten, so this one
// really does identify the root of a default set.
export const ROOT_PROFILE_ID = "root";

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
// switched one at a time. The agent type decides which capabilities are offered in the
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
      "Responses as code: the model's whole reply is a program over the same functions, in one of the eleven languages this agent names, run in a wasm sandbox. One turn can make dozens of calls, branch on their results, and loop.",
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
// coerces into the JSON params object: fraction/number/bytes → a JSON number, select and
// text → a JSON string, toggles → a JSON object of `{ option: <state> }` written the way
// [toggleSet] says, boolean → `true` or `false`, whichever way its slider is sitting.
//
// What an *empty* control writes is decided by [required], not by the kind: a required
// param always writes something (a toggle set writes its whole membership, a slider that
// is off writes `false`), and an empty required text, number or selection is a save the
// form refuses. An optional param's empty control writes no key, because for those the
// absent key is the setting.
//
// Every param gg actually reads has a control here — there is deliberately no raw
// JSON escape hatch in the editor, since the console knows gg's whole param schema.
// A param a *stored* configuration carries that no control here covers — a key from a
// newer client — is preserved verbatim through a round-trip rather
// than shown, so reopening and saving never drops it.
export interface ParamSpec {
  key: string;
  label: string;
  // `agent` renders a <select> over the configuration's own profiles — labelled by name,
  // valued (and stored, as a JSON string) by [id](GgAgentConfig::id) — so a param can point
  // at an agent profile: how the run-level "which agent runs this?" knobs
  // (merge/issue/judge) are configured. The list of choices is threaded in by the editor.
  // A `boolean` param is a **feature switch**, not a value: it renders beside the
  // per-feature sliders (the "Features" box) rather than in the param grid, because what
  // it varies is what an offered call demands rather than a number the call reads.
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
    | "percent"
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
  // What the control is seeded with the moment the capability is switched on, and what
  // an older stored configuration missing this param is filled in with when it is opened
  // ([draftFromCapabilitySet]). It is a starting point in front of an operator, never a
  // fallback: the configuration carries the figure that is in the field, and clearing the
  // field of a [required] param is an error rather than a deferral to gg.
  //
  // Every required param has one, and they are the same figures `GgCapabilityConfig::enabled`
  // authors (the authoring catalog in `crates/core/src/gg.rs`), so a capability switched on
  // here and one switched on there are the same capability. Two exceptions, both
  // deliberate: a `boolean` needs none, since its slider always shows and always writes
  // one of its two states, and responses-as-code's `language` must never acquire one —
  // it is the axis a cross-language study slices its arms on, so it is the single required
  // value nobody may choose for the operator.
  defaultValue?: string;
  // Whether gg refuses a launch this param is absent from — which is every param but the
  // four gg reads a setting out of an absence for (compaction's `maxRetries`, `model` and
  // `modelSlot`, and project management's `reviewers`). Optional is not the same as
  // unseeded: `maxRetries` and agent-managed context's `signalThresholdPercent` are both
  // written with the figure their absence already meant, so that every control in a
  // capability's grid shows a value. A required control always
  // writes: it is seeded when the capability is switched on, filled in when a stored
  // configuration is short of it, and refused by the save gate when it is emptied. The
  // form reports it where the operator can still fix it, rather than letting the launch
  // be the first to say so.
  required?: boolean;
  // How gg reads the object a `toggles` param writes, and therefore what the form has to
  // write into it. Required on a `toggles` param and meaningless on any other.
  //
  // `exhaustive`: the object names EVERY member. gg arms no member an operator did not
  // write, so one that leaves a member out refuses the launch — and gg's two scalar
  // shorthands, `true` and `false`, are every member on and every member off.
  //
  // `withholding`: the object names the members held BACK, and one it does not mention is
  // offered. `{}` is the legitimate "withhold nothing", and there is no scalar form.
  toggleSet?: "exhaustive" | "withholding";
  // The closed set of values a `select` offers, or the independently switchable
  // members a `toggles` param is made of.
  //
  // `seedOff` marks a member the [authoring catalog](defaultValue) writes as OFF when the
  // capability is freshly switched on — a starting point in front of the operator, not an
  // arm gg would read out of an absence. `hint` is hover text for a member whose label
  // cannot carry why it exists.
  options?: ReadonlyArray<{
    value: string;
    label: string;
    seedOff?: boolean;
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

// The two sentences a `toggles` param's hint ends with, one per [ParamSpec.toggleSet], so
// the rule is stated once in one wording wherever it applies. Neither names a particular
// kind of member: what the toggles ARE is the surrounding hint's and the members' own
// labels' job.
//
// An exhaustive set is recorded whole because gg reads it whole — it arms no member an
// operator did not write, and a configuration naming two of three has not said what the
// third arm was. A withholding set records the switches it takes away, because a member it
// does not name is one gg offers.
const EXHAUSTIVE_TOGGLES_HINT =
  "Every switch here is recorded, on or off — gg arms none of them for you.";
const WITHHOLDING_TOGGLES_HINT =
  "Only the ones you switch off are recorded; anything left on is offered.";

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
  // text — an operator should not have to remember how a mode is spelled. The first row
  // is the arm a freshly enabled capability is written with (see [authoredImplementation]),
  // and every row names an arm: gg reads no implementation out of an unwritten one, so a
  // picker offers no way to select "unspecified". The one empty value in the catalog is
  // autoload specifications' unlocked arm, which gg spells as the absent key
  // ([requiresImplementation]). Option labels stay terse (the mode's name); what each mode
  // does belongs in `implementationHint`.
  implementationOptions?: ReadonlyArray<{ value: string; label: string }>;
  // The help-tooltip text for the implementation field — what the modes mean, kept
  // off the picker's option labels so the dropdown reads as a list of names.
  implementationHint?: string;
  // Dedicated param controls; anything else goes in the generic JSON editor.
  params?: ReadonlyArray<ParamSpec>;
  // The gg **tool names** this capability offers a tool-calling agent — the vocabulary
  // its `tools` allowlist is written in, and the `toolOffered` facet targets the analyze
  // page offers.
  tools?: ReadonlyArray<string>;
  // The **operation ids** this capability offers a responses-as-code agent — the
  // vocabulary its `operations` allowlist is written in.
  //
  // It is a second list rather than a rendering of the first, because the two surfaces
  // are independent: gg's operations table decides what a program may call and gg's tool
  // registry decides what a tool call may name, and neither is derived from the other.
  // The lists therefore do not line up entry for entry — `read-file` buys one tool and
  // two operations (a read into a variable, and a read straight into the window), and
  // `docview-close` and `program-library` buy operations and no tool at
  // all — which is the whole reason a capability has to state both.
  operations?: ReadonlyArray<string>;
  // The capability's separately-grantable sub-features, surfaced as per-feature sliders
  // in its expanded config. Each entry is one slider that adds (or removes) its whole
  // bundle from the agent's allowlist at once — so a slider maps to a coherent feature an
  // operator would actually vary, not a raw call. Calls that are only meaningful together
  // share one slider, and a capability's core calls (the ones that come with it) are
  // deliberately absent, so no slider can leave the capability in a state nobody would
  // run. A capability whose surface is atomic (the two workspace writers, say) declares
  // none, and the capability toggle is its only granularity.
  //
  // A bundle names its calls in **both** vocabularies for the reason `operations` is a
  // second list at all: the editor writes whichever one the agent's type reads, and the
  // two halves of a feature are not the same names.
  features?: ReadonlyArray<{
    label: string;
    tools: ReadonlyArray<string>;
    operations: ReadonlyArray<string>;
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
// exists to allow. The values are gg's implementation ids (`crates/core/src/gg.rs`), and
// every row is one of them: gg reads no arm out of an unwritten `implementation`, so
// there is no row here that writes nothing.
export const READ_MODE_OPTIONS = [
  { value: "unlimited", label: "Unlimited" },
  { value: "default-cap", label: "Default cap" },
] as const;

// What each read mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const READ_MODE_HINT =
  "Unlimited returns the whole file in one call. Default cap returns the line cap unless the model asks for more, which is always honoured — no mode can refuse a whole-file read.";

// The read modes that apply the line cap — everything except `unlimited`, which
// returns the whole file and never reads it.
export const CAPPED_READ_MODES = ["default-cap"] as const;

// The line cap a freshly enabled read-file capability is written with — the same figure
// `GgCapabilityConfig::enabled` authors. It is a starting point in front of an operator,
// not a fallback: the capability carries whatever number is in the field, and clearing
// the field is an error rather than a deferral to gg.
export const AUTHORED_READ_LINE_CAP = 250;

// Where a `shell` command's output goes — the shell capability's implementation. The
// values are gg's implementation ids (`crates/core/src/gg.rs`), and every row is one of
// them: gg reads no arm out of an unwritten `implementation`, so there is no row here that
// writes nothing. Both truncating modes write every command's stdout and stderr to a
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
  { value: "offload", label: "Offload to files" },
  { value: "inline", label: "Inline" },
] as const;

// The same two modes, plus the one thing a *hook*'s output field can say that a
// capability's cannot: follow the agent's own shell configuration. That is inheritance
// rather than a mode of its own — a hook with no output mode runs under whatever its
// agent's shell is configured with — which is why it is offered here and nowhere else.
export const HOOK_OUTPUT_OPTIONS = [
  { value: "", label: "Follow the agent" },
  ...SHELL_OUTPUT_OPTIONS,
] as const;

// The shell output modes that truncate a command's output to the two ceilings below —
// everything except `inline`, which returns the whole of it and reads neither param.
export const TRUNCATING_SHELL_OUTPUT_MODES = ["offload"] as const;

// What each output mode does — the detail lifted off the picker's option labels into
// the field's help tooltip.
export const SHELL_OUTPUT_HINT =
  "Offload returns the tail of every command's output and writes the full stdout and stderr to a file pair under /tmp/gg-shell, naming the pair when it cut something. Inline returns the whole output (capped at 16 KiB) and writes nothing to disk.";

// The two ceilings a freshly enabled shell capability is written with. A truncating mode
// reads both and gg supplies neither, so these are what the form puts in front of an
// operator to keep or change — not figures a launch can land on.
export const AUTHORED_SHELL_MAX_LINES = 250;
export const AUTHORED_SHELL_MAX_CHARS = 4096;

// Whether the autoload-specifications capability **locks** the injected specs into the
// window. This is the one implementation picker with an empty row, and the empty row is a
// real arm rather than a deferral: `locked` is the capability's only named implementation
// (`crates/core/src/gg.rs`), so writing nothing is itself the declaration that the seeded
// specifications are ordinary, droppable file views. Both rows therefore say what the run
// does, and neither leaves gg to decide.
export const AUTOLOAD_LOCKED_OPTIONS = [
  { value: "", label: "Not locked" },
  { value: "locked", label: "Locked" },
] as const;

// What the locked lever does — the detail lifted off the picker's option labels into the
// field's help tooltip.
export const AUTOLOAD_LOCKED_HINT =
  "Not locked injects the specs as ordinary file reads that compaction may summarize away and agent-managed context may evict. Locked pins them into the window verbatim across every compaction boundary and spares them from eviction.";

// --- Program language ---------------------------------------------------------------
//
// Which language an agent writes its programs in. Every language offers the *same*
// capability surface under its own spellings, so this is the one axis a cross-language
// study varies — and gg records it on the run and on each agent's surface so the arms can
// be told apart afterwards.
//
// It is the one required param the form does not fill in, and the reason is that same
// axis: a language gg picked — or that this picker picked — would be a difference between
// two arms that no document records. A code agent that names none is refused at launch, so
// a fresh agent opens on the picker's placeholder row and the save gate names the field
// until the operator answers it.
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

// The empty row is a placeholder, not a choice: it is what a fresh code agent opens on
// and what a stored configuration carrying no `language` shows, and leaving it there is
// the one required value the save gate cannot fill in for the operator. Every other row is
// a language gg can drive.
export const PROGRAM_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: "" | GgProgramLanguage;
  label: string;
}> = [
  { value: "", label: "Choose a language…" },
  ...Object.entries(PROGRAM_LANGUAGE_LABELS).map(([value, label]) => ({
    value: value as GgProgramLanguage,
    label,
  })),
];

export const PROGRAM_LANGUAGE_HINT =
  "The language this agent's programs are written in. Each language ships its own hand-written SDK over the same typed sandbox surface, so what differs between two arms of a study is the spelling of a call, never which calls exist. JavaScript is the exception and is deliberate: it is the TypeScript arm with the type check removed and nothing else changed — the same signatures, annotations included — so an A/B across the two measures what checking a program before it runs is worth. Python is its own guest, a committed CPython, and its programs are checked by nothing before they run. Ruby is compiled to JavaScript by a committed Opal before it crosses, so its programs are read and refused before they run without their types ever being checked — the one arm that separates compiling a program from typing it. PureScript is compiled and fully type-checked by a real `purs` in the run image, against a library set gg carries, so it is the other end of that axis: a wrong argument shape, a missing case or a missing instance costs a diagnostic rather than a turn. Java is the only arm whose program passes through two compilers — `javac` and then TeaVM — inside a JVM gg keeps warm between programs, so it is both type-checked and the most expensive arm to compile, and a class outside TeaVM's classlib is a located compile error rather than a run-time surprise. Kotlin rides that same road from bytecode onwards and is the A/B against it: the same two compilers, the same guest and the same classlib, so what differs between the pair is the language and its SDK rather than the toolchain — a program here is a Kotlin script, and its surface expresses every optional argument as a default passed by name where Java's needs an overload. Rust and Swift are a different shape rather than a different language: neither ships a guest at all, because their compilers produce the program rather than something that later reads one, so each turn compiles the component it is then evaluated by. Rust's is the cheapest compile of any checked arm and its programs are ~25 KB; Swift's reply is compiled byte for byte, with no wrapper and no line offset, and is the one arm that pays more to instantiate a program than to compile it. C++ is the third of that shape and the cheapest of the three per turn, because the prelude its programs are compiled against is precompiled once per machine — its reply is compiled byte for byte too, it is the only arm whose guest has working exceptions, and it is the only one where undefined behavior can end a program with nothing to say about why. C# is neither shape: Roslyn compiles the reply to an IL assembly on the host in about a third of a second, the bytes cross as base64, and a committed guest holding a Mono IL interpreter and the whole .NET class library loads them — so it is type-checked like a compiled arm, costs one compiler and no engine work per turn like an interpreted one, and has the best error surface of any of them, because an unhandled exception arrives with its type, its message and its managed stack. There is no default: gg drives no run in a language nobody chose, so a code agent has to name one and a launch that omits it is refused.";

// Which SDK types a documentation lookup opens beside the function it was asked for —
// three INDEPENDENT toggles rather than one three-way arm, because what a return type
// costs and what a declared failure buys are separate questions and a study slices on
// each of them. A configuration states all three; `parameters` carries its own
// [seedOff](ParamSpec.options) flag, since it is the one a fresh capability opens with
// switched off.
export const DOC_VIEW_TYPES_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  seedOff?: boolean;
  hint?: string;
}> = [
  {
    value: "return",
    label: "return — the types the signature hands back",
    hint: "Lands the agent on what it can do with the value it is about to get. A fresh capability starts it on.",
  },
  {
    value: "parameters",
    label: "parameters — the types its arguments declare",
    seedOff: true,
    hint: "The one of the three a fresh capability starts switched off: an argument's type is already written into the signature the agent is reading, so opening it is more context up front against fewer follow-up lookups. Like the other two, what the run does with it is whatever this switch says.",
  },
  {
    value: "errors",
    label: "errors — the failures its documentation declares it throws",
    hint: "The error types the function's own documentation comment names, in whatever tag its language declares one with. It is the one source that is not in the signature at all, so nothing else in this list can reach it. A fresh capability starts it on.",
  },
];

export const DOC_VIEW_TYPES_HINT = `Opening a function's documentation also opens SDK types beside it, as views of their own — each source switched on its own, and what one open places is the union of them. Always exactly one level: a type's own view never drags in a further type. ${EXHAUSTIVE_TOGGLES_HINT}`;

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
  // What the knob is seeded with the moment the detector is armed, and what an armed
  // stored declaration missing this knob is filled in with when it is opened. An armed
  // detector writes all five: the rule trips on the five of them together, so one armed on
  // figures nobody chose would measure gg rather than the model, and gg has none of its own
  // to lend. A disarmed detector owes none of them, and a knob it carries anyway is kept —
  // the operator tuned it and switched it off.
  authored: number;
}

export const LOOP_DETECTION_SPECS: ReadonlyArray<LoopDetectionSpec> = [
  {
    key: "windowWords",
    label: "Window (words)",
    authored: 256,
    hint: "How many of the most recent words the detector looks back over. A word is a whitespace-separated run of characters — plus a fixed-width slice whenever a run exceeds gg's internal cap, which is what makes a whitespace-free loop (`a();a();a();…`) detectable rather than one unbounded word.",
  },
  {
    key: "repeatThreshold",
    label: "Repeats before suspicious",
    authored: 32,
    hint: "How many times one word may occur inside the window before it counts as an offender — strictly more than this makes one. Raising it tolerates denser legitimate repetition (a data literal, a long table) at the cost of catching a loop later. 32 is a word occupying more than an eighth of a 256-word window.",
  },
  {
    key: "minOffenders",
    label: "Offenders to saturate",
    authored: 2,
    hint: "How many DISTINCT offenders must be present at once for the window to count as saturated. More than one is required because a single very common token (`the`, `0,`, a brace) is ordinary, while a loop repeats a whole fragment and so saturates several words together.",
  },
  {
    key: "minSaturatedRun",
    label: "Saturated words before abandoning",
    authored: 3000,
    hint: "How many consecutive words must arrive while the window stays saturated before the reply is abandoned. This is the term that separates a loop from legitimately repetitive content: a tilemap literal or a long table saturates the window and then ENDS, while a loop saturates it and never stops. 0 abandons as soon as the window saturates — the unmodified frequency rule, and a deliberate setting rather than a mistake.",
  },
  {
    key: "maxResponseChars",
    label: "Reply ceiling (characters)",
    authored: 250_000,
    hint: "A hard ceiling on one reply, and the backstop for a runaway that is not repetitive enough to trip the window rule. 0 turns the backstop off and leaves only the repetition rule.",
  },
];

// --- Modules --------------------------------------------------------------------
//
// Every unit of per-agent state gg keeps behind a capability is a **module** (see
// gg/modules): memories, the task list, the board, the skills read-set and the thread
// archive, plus the conversation window itself. One thing about a module is authored
// here — which modules an FSM transition hands to the next state (the transfer list on
// each edge). The transfer list names a closed taxonomy, so it is spelled once.

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
// capability an operator would tune. This map answers "what would I go and configure to
// change this module?", which every kind but one has an answer to.
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
  agentId: string | null | undefined,
  capabilityId: string,
  key: string,
): unknown {
  const capability = agentProfile(set, agentId)?.capabilities.find(
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

/**
 * The arm a freshly switched-on capability is written with: the first row of its picker,
 * which is the arm the authoring catalog in `crates/core/src/gg.rs` names for it. The empty
 * string for a capability that offers no arms at all, and for autoload specifications,
 * whose unwritten implementation *is* its unlocked arm.
 */
export function authoredImplementation(cap: CapSpec): string {
  return cap.implementationOptions?.[0]?.value ?? "";
}

/**
 * Whether an enabled `cap` has to name an arm — true for the four pickers every row of
 * which is a real implementation (shell, read-file, memories, compaction), and false for
 * autoload specifications, where writing nothing is the declaration that the seeded
 * specifications are ordinary file views. A capability with no closed set of arms requires
 * none either: a free-text implementation field names a strategy gg resolves at run time,
 * and there is no list here to say what a fresh one would be.
 */
export function requiresImplementation(cap: CapSpec): boolean {
  const options = cap.implementationOptions ?? [];
  return options.length > 0 && options.every((o) => o.value !== "");
}

// The workspace-relative directory a freshly enabled skills capability is written with
// (`GG_WORKSPACE_SKILLS_DIR` in `crates/core/src/gg.rs`). gg reads the directory the
// configuration names and looks in no other, so this is the field's starting value rather
// than somewhere gg would look on its own.
export const AUTHORED_SKILLS_DIR = ".gg/skills";

// The twelve skills gg ships itself — one per family of the functions it offers
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
    value: "gg-docs",
    label:
      "gg-docs — finding a function by keyword and reclaiming what it read (code mode)",
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

// What a built-in skill IS, said once here rather than twelve times on the checkboxes:
// where its content comes from, why an agent may be offered fewer than twelve, and what
// switching one off actually does.
//
// The "only when the agent has it" rule is the load-bearing half. A family is offered
// only when this agent really holds at least one of its functions, so the list is a
// ceiling rather than a roster: switching nothing off on an agent with no board still
// yields no `gg-project`.
export const BUILT_IN_SKILLS_HINT = `Skills gg writes itself, one per family of the functions this agent has — generated from its live tools rather than authored, so they cannot describe a tool it was not given. Under tool calling a built-in's body is the family's real tool definitions and parameters; under responses-as-code it opens a documentation view per function on the turn after it is used. A family is offered only when the agent holds at least one of its functions, and a skill of the same name in the skills directory replaces it. Switching one off withholds it from this agent entirely — the family's functions still work, the manual for them is simply not there. ${WITHHOLDING_TOGGLES_HINT}`;

// The bounds a freshly enabled tasks or project-management capability is written with,
// the same figures `GgCapabilityConfig::enabled` authors (`crates/core/src/gg.rs`). Every
// one of them is a required param: the capability carries the number in its field, and an
// emptied field is a save the form refuses rather than a bound gg would supply.
export const AUTHORED_MAX_TASKS = 100;
export const AUTHORED_MAX_EPICS = 50;
export const AUTHORED_MAX_ISSUES = 2000;
// How many times gg re-dispatches an issue whose agent ended without finishing before
// marking it `failed`. `0` is a legitimate setting — one attempt and no retry — which is
// why it is a figure the operator keeps or changes rather than an empty field.
export const AUTHORED_MAX_RETRIES = 1;
// The memory bounds a freshly enabled memories capability is written with — the
// scratchpad's, because the scratchpad is the arm a fresh capability selects. The three
// the scratchpad does not apply are written `0`, which is the params object's own spelling
// of "no ceiling": what bounds a scratchpad is the count and the per-note ceiling, and the
// description ceiling every strategy reads. An operator who moves the strategy picker to
// an arm that reads one of the zeroed limits sets the figure it should run under, the same
// way every other required number is set.
export const AUTHORED_MEMORY_MAX_COUNT = 64;
export const AUTHORED_MEMORY_MAX_LEN_PER = 4096;
export const AUTHORED_MEMORY_MAX_LEN_DESCRIPTION = 256;
export const AUTHORED_MEMORY_MAX_TOTAL_LEN = 0;
export const AUTHORED_MEMORY_MAX_LEN_INDEX = 0;
export const AUTHORED_MEMORY_MAX_RESULTS = 0;

// How a run's memories are organized (`crates/gg/src/memories.rs`) — the memory
// strategy, which decides which memory tools exist, which of the limits apply, and what
// the context window carries. The values are gg's strategy ids, all three of them real:
// an unwritten strategy is not a scratchpad, it is a launch gg refuses.
export const MEMORY_STRATEGY_OPTIONS = [
  { value: "scratchpad", label: "Scratchpad" },
  { value: "markdown", label: "Markdown + index" },
  { value: "keyword-search", label: "Keyword search" },
] as const;

// The memory **scopes** (see gg/memories): which memory instance an agent instance binds
// to. Orthogonal to the strategy, which decides what a memory *is*; this decides whose it
// is. `isolated` — an instance per agent instance — is what a fresh capability is written
// with, and it is written, not assumed.
export const MEMORY_SCOPE_OPTIONS = [
  { value: "isolated", label: "Isolated" },
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
export const COUNTED_MEMORY_STRATEGIES = [
  "scratchpad",
  "keyword-search",
] as const;

// The scratchpad strategy alone — the only one whose notes are carried in the window, and
// so the only one an aggregate length budget could bound (`0` is how a configuration says
// it has none; the field is offered here because this is the only strategy where setting
// one means anything).
export const SCRATCHPAD_MEMORY_STRATEGY = ["scratchpad"] as const;

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

// The timeout a freshly added command hook is written with. Generous, because a hook
// command is typically a build or a test suite rather than a quick check — and a figure
// rather than an empty field, because gg kills a hook at the ceiling the hook declares and
// has no ceiling of its own to lend one that declares none.
export const AUTHORED_HOOK_TIMEOUT_SECS = 300;

// The compaction strategies gg resolves at run time (`crates/gg/src/compaction.rs`),
// in editor order — grouped by who condenses the thread: the working agent itself (the
// first two and the last) or a separate handoff model, out of band. A closed picker
// rather than free text because an unrecognized name refuses the launch, and every row is
// a strategy: an enabled compaction that names none is refused too.
export const SUMMARIZER_OPTIONS = [
  { value: "self-summarization", label: "Self-summarization" },
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
  "Self-summarization asks the agent, in its own thread, to write the summary its next context is rebuilt from. Self-compaction gives the agent a `compact` tool it calls with a summary AND the files to re-read, so it chooses what survives. The two Handoff strategies do the same two jobs on a separate model (set below), which reads the thread as labelled messages and never interrupts the agent. Memory compaction requires Memories: the agent writes its working state to memories instead of a summary, and those cross the boundary verbatim.";

// The remaining figures a freshly switched-on capability is written with, each named
// beside no other vocabulary of its own. Like every [defaultValue](ParamSpec.defaultValue)
// they are the authoring catalog's (`crates/core/src/gg.rs`) and not gg's: gg reads the
// number in the document and has none of its own to fall back on.

// A narrowing an order of magnitude under a large model's real window, which is what the
// context-window override is reached for: it puts a compaction boundary within reach of a
// run that would otherwise have to buy a million tokens of input to see one.
export const AUTHORED_WINDOW_LIMIT = 100_000;
// A fifth of the window held back for the summarization call.
export const AUTHORED_SUMMARY_HEADROOM = 0.2;
// The shortlist of largest file views an agent-managed-context agent's prompt names.
export const AUTHORED_TOP_FILE_VIEWS = 5;
// How full the window an agent may fill has to be before it is shown the context-usage
// block. The one figure gg reads out of a document that does not write it, so a capability
// switched on without touching the field runs at this share.
export const AUTHORED_SIGNAL_THRESHOLD_PERCENT = 75;
// Deep enough for a root that delegates to a lead that delegates to a worker, and shallow
// enough that a runaway roster cannot open a fleet.
export const AUTHORED_MAX_DEPTH = 3;
// One program's wall-clock and memory ceilings inside the wasm sandbox: thirty seconds,
// and 256 MiB.
export const AUTHORED_PROGRAM_TIMEOUT_SECS = 30;
export const AUTHORED_PROGRAM_MAX_MEMORY_BYTES = 268_435_456;
// How many of a code agent's most recent programs the library holds.
export const AUTHORED_PROGRAMS_KEPT = 20;
// How long the id the library assigns each program is. Four characters of cuid2's
// alphabet is about 1.7 million ids, and ids are per agent, so a longer value only
// matters for an agent that runs thousands of programs in one session.
export const AUTHORED_PROGRAM_ID_LENGTH = 4;

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
        required: true,
        defaultValue: String(AUTHORED_SHELL_MAX_LINES),
        showWhenImplementation: TRUNCATING_SHELL_OUTPUT_MODES,
        hint: "Trailing lines of a truncated command's output returned inline. Written whichever output mode is selected, so moving the picker onto a truncating one needs no retype.",
      },
      {
        key: "maxChars",
        label: "Max characters",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_SHELL_MAX_CHARS),
        showWhenImplementation: TRUNCATING_SHELL_OUTPUT_MODES,
        hint: "Trailing characters of a truncated command's output returned inline. The tighter of the two ceilings decides what comes back; both are written, because a truncating mode reads both and gg supplies neither.",
      },
    ],
    tools: ["shell"],
    operations: ["shell.shell"],
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
        required: true,
        defaultValue: String(AUTHORED_READ_LINE_CAP),
        showWhenImplementation: CAPPED_READ_MODES,
        hint: "Lines per call under a capped read mode. Written under the unlimited mode too, which reads it under neither name — so switching the picker to a capped mode is one click rather than a retype.",
      },
    ],
    tools: ["read_file"],
    // Two operations over one read: into a variable, and straight into the agent's own
    // window. gg buys both with this one capability.
    operations: ["files.read_file", "views.open_file"],
  },
  {
    id: "write-file",
    name: "Write file",
    group: "Filesystem",
    purpose: "Create or overwrite a whole file in the run's workspace.",
    defaultOn: true,
    tools: ["write_file"],
    operations: ["files.write_file"],
  },
  {
    id: "edit-file",
    name: "Edit file",
    group: "Filesystem",
    purpose:
      "Patch a file by exact, unique string replacement — the alternative to rewriting it whole.",
    defaultOn: true,
    tools: ["edit_file"],
    operations: ["files.edit_file"],
  },
  {
    id: "list-dir",
    name: "List directory",
    group: "Filesystem",
    purpose: "List a directory's entries in the run's workspace.",
    defaultOn: true,
    tools: ["list_dir"],
    operations: ["files.list_dir"],
  },
  {
    id: "search",
    name: "Search",
    group: "Filesystem",
    purpose:
      "Search the workspace's files for a pattern and get back the matching lines with their path and line number. Honors ignore files: what `.gitignore` and its kin exclude is never scanned.",
    defaultOn: true,
    tools: ["search"],
    operations: ["files.search"],
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
        // The one required param with no seeded value, and the only field in the form an
        // operator has to answer before a fresh code agent can be saved. See
        // [ParamSpec.defaultValue]: the language is the axis a cross-language study slices
        // its arms on, so neither gg nor this form may pick it.
        key: "language",
        label: "Program language",
        kind: "select",
        options: PROGRAM_LANGUAGE_OPTIONS,
        required: true,
        hint: PROGRAM_LANGUAGE_HINT,
      },
      {
        key: "timeoutSecs",
        label: "Execution timeout (seconds)",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_PROGRAM_TIMEOUT_SECS),
        hint: "Wall-clock ceiling on one program's guest execution. Time the program spends parked in a tool call is excluded, so this bounds the work the program itself does rather than the turn it belongs to.",
      },
      {
        key: "maxMemoryBytes",
        label: "Max memory (bytes)",
        kind: "bytes",
        required: true,
        defaultValue: String(AUTHORED_PROGRAM_MAX_MEMORY_BYTES),
        hint: "Ceiling on the memory the wasm sandbox may hand one program. A program that asks for more is stopped at the ceiling, which is an error turn rather than a run that dies.",
      },
      {
        key: "docViewTypes",
        label: "Documentation types",
        kind: "toggles",
        toggleSet: "exhaustive",
        required: true,
        options: DOC_VIEW_TYPES_OPTIONS,
        hint: DOC_VIEW_TYPES_HINT,
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
    // No `tools`: closing a documentation view is a call no tool-calling agent has, which
    // is what `modes` above already says. A capability with an API surface and no tool
    // surface is ordinary — the two are independent vocabularies, not two spellings of
    // one list.
    operations: ["docs.close", "docs.close_all"],
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
        required: true,
        defaultValue: String(AUTHORED_PROGRAMS_KEPT),
        hint: "How many of the agent's most recent programs are retained and can be fetched with `programs.get` by the id each was acknowledged with. Older ones are dropped, and asking for one says which ids are still held (and their turns). `0` keeps every program of the session — the setting for a study that reads them all back, spelled as a figure like every other.",
      },
      {
        key: "idLength",
        label: "Id length",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_PROGRAM_ID_LENGTH),
        hint: "How many characters the id assigned to each program is — the body of the `submit_program` acknowledgement, and what `programs.get` takes. Ids are scoped to the one agent, and 4 characters is about 1.7 million of them, so a longer value (up to 32) only matters for an agent that runs thousands of programs in one session; shorter than 2 is refused.",
      },
    ],
    // No `tools`, for the reason `modes` gives: there are no programs in a tool-calling
    // session to keep.
    operations: ["programs.history", "programs.get", "programs.rerun"],
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
        required: true,
        defaultValue: String(AUTHORED_WINDOW_LIMIT),
        hint: "The window to run the model against, in tokens. Can only narrow: a value above the model catalog's figure for the model is clamped to it. Imposing the narrowing is the whole of what this capability does, so there is no figure here that means no override — switch the capability off for that.",
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
    params: [
      {
        key: "images",
        label: "Attach reference images",
        kind: "boolean",
        required: true,
        hint: "On, a seeded reference mockup arrives as the picture itself. Off, it arrives as its label, format and size, and the agent reads the file when it wants to look. A picture is charged to the window by its dimensions and charged again on every request the view survives, so a case's mockups can outweigh the specifications they illustrate. A model that cannot see images is never sent one either way.",
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
        key: "summaryHeadroom",
        label: "Summary headroom",
        kind: "fraction",
        required: true,
        defaultValue: String(AUTHORED_SUMMARY_HEADROOM),
        hint: "Fraction of the window held back from the agent so the summarization call — which reads the whole thread and writes a summary — fits. This also defines the trigger: a compaction fires once the window is 1 − headroom full (the working window is full and only the headroom remains).",
      },
      {
        // Optional to gg — an absent `maxRetries` is none — but seeded here all the same,
        // and written down as the `0` it already meant. A field left blank to mean a
        // figure the operator has to know is the one control in this grid that could not
        // be read at a glance, and it sat next to a sibling that shows its own default;
        // `0` on the screen and `0` in the document say the same thing to gg as an
        // absence did, so the form says it rather than implying it.
        key: "maxRetries",
        label: "Max retries",
        kind: "number",
        defaultValue: "0",
        hint: "How many times gg compacts again after a boundary that left the window still at the threshold, before ending the agent as failed. None is the right setting unless a strategy is being studied whose first summary can come back nearly as long as the thread it replaced: at 0 there is one compaction, and an agent that boundary could not relieve has failed.",
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
        // One of the three params whose absence is the setting, so it carries no
        // [required] flag and no seeded value: a new configuration that asked for a
        // summarizer model nobody chose would be the form deciding the arm.
        hint: "The model that condenses the thread instead of the agent. Take it from a model slot to pick it when the run is launched, or pin one here. Left unset, the agent condenses on its own model — which is a setting rather than a gap, and the one every configuration that names no summarizer runs under.",
      },
    ],
    tools: ["compact"],
    operations: ["context.compact"],
  },
  {
    id: "agent-managed-context",
    name: "Agent-managed context",
    group: "Context",
    purpose:
      "The agent reclaims window space itself: evicting file views, archiving thread sections, and — under responses as code — closing the views it opened.",
    params: [
      {
        key: "topFileViews",
        label: "File views kept",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_TOP_FILE_VIEWS),
        hint: "How many of the agent's largest file views its prompt names when it is asked to reclaim window space — the shortlist it evicts from, rather than a ceiling on how many views it may hold.",
      },
      {
        // The one param gg reads a figure out of a document that does not write it, so
        // this field is seeded but carries no [required] flag: clearing it runs the same
        // share, and a new document is written with it either way.
        key: "signalThresholdPercent",
        label: "Signal at",
        kind: "percent",
        defaultValue: String(AUTHORED_SIGNAL_THRESHOLD_PERCENT),
        hint: "How full the window has to be, as a percentage, before the agent is shown the context-usage block at all. The share is of the window the agent may actually fill — the model's window less whatever an enabled Compaction holds back — which is the same figure the block then reports. Below it there is no block, since a block reporting a window that is 6% full costs tokens to ask for a reclaim worth nothing. Set 0 to show it every turn.",
      },
    ],
    tools: ["evict_file_view", "archive_thread", "search_archive"],
    // The view call is responses-as-code only: a tool-calling agent has no `view`
    // object, so it has no tool beside it. Closing a view is context management, which is
    // why it is this capability's rather than bound to every program.
    operations: [
      "context.evict_file_view",
      "context.archive_thread",
      "context.search_archive",
      "views.close",
    ],
    features: [
      {
        label: "Evict file views",
        tools: ["evict_file_view"],
        operations: ["context.evict_file_view"],
      },
      {
        label: "Archive & search the thread",
        tools: ["archive_thread", "search_archive"],
        operations: ["context.archive_thread", "context.search_archive"],
        hint: "Archiving and searching the archive are granted together: an archive the agent cannot search back is unreadable.",
      },
      {
        label: "Close views",
        tools: [],
        operations: ["views.close"],
        hint: "Responses as code only — a tool-calling agent reclaims file views with the eviction slider and has no text views to close.",
      },
    ],
  },
  // --- Knowledge --------------------------------------------------------------
  {
    id: "skills",
    name: "Skills",
    group: "Knowledge",
    // A skill may be prose, a code module the agent's programs import, a script gg runs
    // on every use, or any combination — and gg ships twelve of its own, so the
    // capability is worth enabling in a workspace that authored none.
    purpose:
      "Skills — prose, code, or both — catalogued in the prompt and pinned once read.",
    defaultOn: true,
    params: [
      {
        key: "dir",
        label: "Skills directory",
        kind: "text",
        required: true,
        defaultValue: AUTHORED_SKILLS_DIR,
        hint: "Where this agent reads its authored skills from. A skills library belongs to the agent, so each profile names its own directory and two profiles naming one directory share the load. Relative paths are joined onto the workspace; an absolute path is used as-is. A `<name>.md` file there is a prose skill; a `<name>/` directory is one too, with its front matter and body in a required `skill.md` beside an optional `skill.<ext>` (a module the agent's programs import) and `on-use.<ext>` (a script gg runs on every use). The extension is the program language of the agent using it — `skill.ts` for a TypeScript agent — so a directory may carry one per language.",
      },
      {
        key: "builtIns",
        label: "Built-in skills",
        kind: "toggles",
        toggleSet: "withholding",
        required: true,
        options: BUILT_IN_SKILL_OPTIONS,
        hint: BUILT_IN_SKILLS_HINT,
      },
    ],
    tools: ["read_skill"],
    operations: ["skills.read_skill"],
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
    // and a box that changes nothing can only mislead. All six are written whichever
    // strategy is selected, so one capability set can be swept across all three arms
    // without retyping its params, and a hidden limit is the figure the arm that reads it
    // would run under. `0` is a written setting, not an omission: it says the limit is off.
    params: [
      {
        key: "scope",
        label: "Scope",
        kind: "select",
        required: true,
        defaultValue: MEMORY_SCOPE_OPTIONS[0].value,
        options: MEMORY_SCOPE_OPTIONS,
        hint: MEMORY_SCOPE_HINT,
      },
      {
        key: "maxCount",
        label: "Max memories",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_COUNT),
        showWhenImplementation: COUNTED_MEMORY_STRATEGIES,
        hint: "How many notes the model may keep at once. 0 for unlimited.",
      },
      {
        key: "maxLenPerMemory",
        label: "Max length each (chars)",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_LEN_PER),
        hint: "Character ceiling on any one note's body, read under every strategy — though the two file-shaped ones keep their bodies out of the window, so a larger figure costs the window nothing there. A code memory's module and its on-use script are not bodies and are charged to neither this nor the total: they are a capability the agent gains, not context it carries. 0 for unlimited.",
      },
      {
        key: "maxTotalLen",
        label: "Max length total (chars)",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_TOTAL_LEN),
        showWhenImplementation: SCRATCHPAD_MEMORY_STRATEGY,
        hint: "Character ceiling across all note bodies together — the budget for what the window carries. A fresh capability writes 0, which is no aggregate ceiling: the per-note ceiling and the count are what bound a scratchpad unless you set one here.",
      },
      {
        key: "maxLenIndex",
        label: "Max index length (chars)",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_LEN_INDEX),
        showWhenImplementation: INDEXED_MEMORY_STRATEGY,
        hint: "Character ceiling on the pinned index. A create whose entry would not fit is refused, so this is what bounds how many memories a markdown run can hold. 0 for unlimited, which is what a fresh capability writes because it selects the scratchpad — set a figure when you move to the markdown strategy.",
      },
      {
        key: "maxLenDescription",
        label: "Max description length (chars)",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_LEN_DESCRIPTION),
        hint: "Character ceiling on a memory's one-line description, read under every strategy. A description is an index line, not a body — under the markdown strategy the window pays for every one of them on every turn, and under the others it is what a search result or a linked-holder notice shows. 0 for unlimited.",
      },
      {
        key: "maxResults",
        label: "Max search results",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MEMORY_MAX_RESULTS),
        showWhenImplementation: SEARCHING_MEMORY_STRATEGY,
        hint: "How many memories one `search_memories` call reports. 0 for unlimited, which is what a fresh capability writes because it selects the scratchpad — set a figure when you move to keyword search.",
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
    operations: [
      "memories.write_memory",
      "memories.update_memory",
      "memories.create_memory",
      "memories.read_memory",
      "memories.edit_memory",
      "memories.search_memories",
      "memories.delete_memory",
    ],
    features: [
      {
        label: "Revise memories",
        tools: ["update_memory", "edit_memory", "delete_memory"],
        operations: [
          "memories.update_memory",
          "memories.edit_memory",
          "memories.delete_memory",
        ],
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
        required: true,
        defaultValue: TASKS_MODE_OPTIONS[0].value,
        hint: TASKS_MODE_HINT,
        options: TASKS_MODE_OPTIONS,
      },
      {
        key: "maxTasks",
        label: "Max tasks",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MAX_TASKS),
        hint: "How many tasks the list may hold at once.",
      },
      // The task list is always carried in its holder's prompt: it is what the agent
      // steers by from turn to turn.
    ],
    tools: [
      "add_task",
      "update_task",
      "set_blocked_by",
      "complete_task",
      "remove_task",
    ],
    operations: [
      "tasks.add_task",
      "tasks.update_task",
      "tasks.set_blocked_by",
      "tasks.complete_task",
      "tasks.remove_task",
    ],
    features: [
      {
        label: "Task dependencies",
        tools: ["set_blocked_by"],
        operations: ["tasks.set_blocked_by"],
        hint: "Off makes the list flat — tasks can't be marked blocked-by one another.",
      },
      {
        label: "Revise tasks",
        tools: ["update_task", "remove_task"],
        operations: ["tasks.update_task", "tasks.remove_task"],
      },
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
        required: true,
        defaultValue: String(AUTHORED_MAX_EPICS),
        hint: "How many epics the board may hold.",
      },
      {
        key: "maxIssues",
        label: "Max issues",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MAX_ISSUES),
        hint: "How many issues the board may hold.",
      },
      {
        key: "maxRetries",
        label: "Max retries",
        kind: "number",
        required: true,
        defaultValue: String(AUTHORED_MAX_RETRIES),
        hint: "How many times gg re-dispatches an issue whose assigned agent ended without finishing — a spent turn ceiling, a breached limit, a model error — before marking the issue failed. 0 is a setting: one attempt, and a failure is final.",
      },
      {
        key: "mergeAgentId",
        label: "Merge agent",
        kind: "agent",
        required: true,
        defaultValue: ROOT_PROFILE_ID,
        hint: "Every issue works in its own git worktree, merged back when it is accepted; when that merge conflicts with work another issue landed first, this agent is dispatched into the workspace to resolve it and finish the merge. It must have the Shell capability, and the board has one — so a configuration with a board names it.",
      },
      {
        // The board's one optional param: a set that requires no reviewers is a board
        // whose issues are accepted on the implementer's word, which is a real
        // configuration rather than a missing one.
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
      "remove_epic",
      "remove_issue",
      "wait_for_issue",
    ],
    operations: [
      "board.create_epic",
      "board.create_issue",
      "board.update_issue",
      "board.set_issue_blocked_by",
      "board.remove_epic",
      "board.remove_issue",
      "board.wait_for_issue",
    ],
    // The blocked-by DAG (`set_issue_blocked_by`) and `wait_for_issue` are deliberately
    // absent: they are what makes a board a board rather than a list, so they come with
    // the capability and no slider can take them away.
    features: [
      {
        label: "Issue creation",
        tools: ["create_epic", "create_issue"],
        operations: ["board.create_epic", "board.create_issue"],
        hint: "Off gives this agent read-only access to the board — it still sees it and waits on issues, but files no new work.",
      },
      {
        label: "Revise the board",
        tools: ["update_issue", "remove_epic", "remove_issue"],
        operations: [
          "board.update_issue",
          "board.remove_epic",
          "board.remove_issue",
        ],
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
        required: true,
        defaultValue: String(AUTHORED_MAX_DEPTH),
        hint: "Recursion bound (a spawn at max depth is refused). Counted from the root, which sits at depth zero.",
      },
    ],
    tools: ["spawn_subagent", "wait_for_subagents", "send_message"],
    operations: [
      "delegation.spawn_subagent",
      "delegation.wait_for_subagents",
      "delegation.send_message",
    ],
    features: [
      {
        label: "Inter-agent messaging",
        tools: ["send_message"],
        operations: ["delegation.send_message"],
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
    operations: ["delegation.exec"],
  },
  {
    id: "fork",
    name: "Fork",
    group: "Delegation",
    purpose:
      "Let this agent run a copy of itself — a child that opens knowing everything its parent knew.",
    defaultOn: false,
    tools: ["fork"],
    operations: ["delegation.fork"],
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
        required: true,
        hint: "The machine, in order — the first state is the one it enters. Each state runs an agent profile this configuration declares (never another machine), and each transition names the state it leads to, when the model should take it, and which modules travel with it. A transition carries only the modules it names; one that names none starts its successor on nothing. A new transition is pre-filled with History.",
      },
    ],
    // Declared so the analyze page can name the transition under the machine that buys it,
    // and read by no allowlist: [grantsOf] seeds nothing from a mode marker, so this name
    // reaches no agent's `tools` or `operations`. gg offers the transition from where an
    // instance STANDS — the machine is declared on this shell profile and the agent running
    // a state is an ordinary profile that knows nothing about it — on both surfaces alike.
    tools: ["transition_state"],
    operations: ["delegation.transition_state"],
    // No feature slider: withholding the transition leaves a machine that can only ever
    // sit in its entry state, which is not a configuration anyone would run.
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

// --- The opening turn -------------------------------------------------------------
//
// What gg puts in front of a code agent's first turn is per-agent configuration
// (`GgAgentConfig.openingTurn`): the modules whose brief and function list the window
// opens with, and the functions whose full documentation it opens with. gg decides
// neither list — it reads the configuration, drops what the agent does not hold, and
// seeds nothing at all when both lists come out empty.

/**
 * gg's cross-arm modules, in the order gg's own operations table groups them
 * (`crates/gg/src/sandbox/operations.rs`). The id is the namespace half of an operation id
 * (`files` in `files.read_file`), and is what an opening turn's `modules` list names.
 *
 * A static table rather than something derived from the capability catalog because a module
 * is gg's grouping, not the console's: two capabilities may sell operations of one module
 * (`read-file` and `search` both sell `files.*`), and one capability may sell operations of
 * two (`agent-managed-context` sells `context.*` and `views.close`). The purpose is written
 * here in the console's voice, the same way a capability's is.
 */
export const GG_MODULES: ReadonlyArray<{
  id: string;
  name: string;
  purpose: string;
}> = [
  {
    id: "shell",
    name: "Shell",
    purpose: "Run shell commands in the run container.",
  },
  {
    id: "files",
    name: "Files",
    purpose: "Read, write, edit, list and search the workspace's files.",
  },
  {
    id: "skills",
    name: "Skills",
    purpose: "Read a skill from the agent's skills library into the window.",
  },
  {
    id: "memories",
    name: "Memories",
    purpose: "Write, read, edit, search and delete the agent's memories.",
  },
  {
    id: "tasks",
    name: "Tasks",
    purpose:
      "Keep the agent's own task list: add, update, block, complete, remove.",
  },
  {
    id: "board",
    name: "Board",
    purpose:
      "File epics and issues on the run's project board, and wait on them.",
  },
  {
    id: "context",
    name: "Context",
    purpose:
      "Manage the window itself: evict file views, archive and search the thread, compact.",
  },
  {
    id: "delegation",
    name: "Delegation",
    purpose:
      "Put other agents to work: spawn, wait on, message, hand off to and fork them.",
  },
  {
    id: "docs",
    name: "Docs",
    purpose: "Search this API's documentation, and close what a search opened.",
  },
  {
    id: "views",
    name: "Views",
    purpose:
      "Open a file, a computed text or a function's documentation as a view in the window, and close one.",
  },
  {
    id: "programs",
    name: "Programs",
    purpose: "Look up, read and re-run the programs earlier turns executed.",
  },
];

/**
 * The three operations bound to every program whatever a run enables — a program must
 * always be able to find what it holds and show its model something — so every agent holds
 * them and no capability offers them. Mirrors `Binding::Always` in gg's operations table.
 */
export const ALWAYS_BOUND_OPERATIONS: ReadonlyArray<string> = [
  "docs.search",
  "views.open_text",
  "views.open_docs_view",
];

/**
 * The opening turn a fresh agent is seeded with — what `GgAgentConfig::root()` writes, and
 * the two lists gg used to hard-code before they became configuration: the workspace and
 * shell modules listed, and the five calls a program needs to look around with opened.
 */
export const DEFAULT_OPENING_TURN: {
  modules: ReadonlyArray<string>;
  functions: ReadonlyArray<string>;
} = {
  modules: ["files", "shell"],
  functions: [
    "docs.search",
    "views.open_docs_view",
    "views.open_text",
    "views.open_file",
    "files.search",
  ],
};

/** One function an opening turn may open the documentation of, and who offers it. */
export interface OpeningTurnFunction {
  /** The operation id — `files.read_file`. */
  id: string;
  /** The module the id belongs to — its namespace half. */
  module: string;
  /**
   * The capability that offers this operation, or `null` for one of the
   * [always-bound three](ALWAYS_BOUND_OPERATIONS), which every agent holds unconditionally.
   */
  offeredBy: CapSpec | null;
}

/**
 * Every operation an opening turn may name, grouped by module in [GG_MODULES] order and,
 * within a module, in the order the capability catalog offers them: the always-bound three
 * first, then each capability's operations (its feature bundles included).
 *
 * Derived from the catalog rather than listed a second time, so a capability that gains an
 * operation gains a row here without a second table to keep in step. A [mode marker](isModeCapability)
 * offers nothing: its one operation (`delegation.transition_state`) is bound by where an
 * instance stands in its machine, not by configuration, and gg refuses an opening turn that
 * promises it.
 */
export function openingTurnFunctions(): ReadonlyArray<OpeningTurnFunction> {
  const rows: OpeningTurnFunction[] = [];
  const seen = new Set<string>();
  const push = (id: string, offeredBy: CapSpec | null) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, module: id.split(".")[0] ?? id, offeredBy });
  };
  for (const id of ALWAYS_BOUND_OPERATIONS) push(id, null);
  for (const cap of CAPABILITIES) {
    if (isModeCapability(cap.id)) continue;
    for (const id of cap.operations ?? []) push(id, cap);
    for (const feature of cap.features ?? []) {
      for (const id of feature.operations) push(id, cap);
    }
  }
  const order = new Map(GG_MODULES.map((m, i) => [m.id, i] as const));
  // A stable sort by module, so the within-module order above is kept.
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        (order.get(a.row.module) ?? GG_MODULES.length) -
          (order.get(b.row.module) ?? GG_MODULES.length) || a.i - b.i,
    )
    .map(({ row }) => row);
}

// --- Run limits -----------------------------------------------------------------
//
// The execution ceilings a run is bounded by. Deliberately **not** [CapSpec]s: a
// capability is a feature, with calls and an on/off switch a configuration varies,
// while a ceiling is an operator's guardrail that applies to every capability and to
// both execution modes at once. Keeping them out of
// [CAPABILITIES] is what keeps them out of [CAP_GROUPS] and out of the
// `capabilityEnabled` facet space, where "is the cost ceiling enabled?" would be a
// dimension no study wants to slice its results by.

// The two ceilings a run cannot be conducted without. Every other ceiling is unarmed
// when its field is empty — gg arms no error ceiling, no turn ceiling, no runtime and no
// cost nobody wrote — while these two have no "off" a run could proceed under: a run
// always has *some* pool, and the capture journal is always being written.
export const AUTHORED_MAX_PARALLEL = 16;

// The error-ceiling guardrails a fresh configuration is seeded with: five error turns in
// a row, or a fifth of the last fifty turns, ends an agent. Unlike the two required
// ceilings these are clearable — an emptied field is that ceiling unarmed, exactly as a
// stored configuration that omitted it. The seeding is the console's; gg's own contract
// still arms nothing a saved configuration does not write.
export const AUTHORED_MAX_CONSECUTIVE_ERRORS = 5;
export const AUTHORED_MAX_ERROR_RATE = 0.2;
export const AUTHORED_ERROR_RATE_WINDOW = 50;

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
  // What a fresh configuration's field is seeded with — and, when the ceiling is
  // [required](RunLimitSpec.required), what an older stored one missing it is filled in
  // with when it is opened. An optional ceiling's figure is a clearable guardrail: it
  // seeds fresh configurations only, because filling it into a stored document that left
  // the ceiling out would arm one nobody asked for.
  defaultValue?: string;
  // Whether gg refuses a run this ceiling is absent from. True of the parallelism cap and
  // the journal ceiling, which bound something every run does, and of nothing else: an
  // empty turn, runtime, cost or error field is that ceiling switched off, which is a
  // setting gg records as one.
  required?: boolean;
}

// One mebibyte in bytes — the factor the `mib` ceiling converts through, spelled once
// because both the load and the save path multiply by it.
export const BYTES_PER_MIB = 1024 * 1024;

// The other of the two: the ceiling on the replay capture journal, in MiB. Sized to be
// unreachable by a run that is behaving and reachable by one that is not.
export const AUTHORED_REPLAY_MAX_MIB = 256;

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
    required: true,
    defaultValue: String(AUTHORED_MAX_PARALLEL),
    hint: "How many of the run's agents may run at once, counting the root and every subagent, issue implementer and reviewer. An agent spawned while the pool is full queues for a slot rather than being refused, so this stops nothing — it only serializes the run. A suspended agent (waiting on its subagents or an issue) frees its slot, and takes priority over any not-yet-started agent when one opens up. Every run has a pool, so this one is always written.",
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
    placeholder: "no ceiling",
    hint: "Wall-clock budget for the whole run, observed by every agent at its own turn boundary. Empty arms no such ceiling — the host caps the run's wall-clock either way. A run that spends a ceiling you set ends timed_out.",
  },
  {
    key: "maxConsecutiveErrors",
    label: "Consecutive errors",
    kind: "count",
    placeholder: "no ceiling",
    defaultValue: String(AUTHORED_MAX_CONSECUTIVE_ERRORS),
    hint: "How many error turns in a row end an agent. Seeded as a guardrail into a fresh configuration; clear the field to unarm the ceiling, and a run whose model errors every turn spends its turns, its runtime or its cost instead. A turn is an error when the work it declared could not be carried out — a failed model call, a program that did not compile, threw, or was stopped at a sandbox ceiling. A tool call that failed inside a program that carried on is not one.",
  },
  {
    key: "maxErrorRate",
    label: "Error rate",
    kind: "fraction",
    placeholder: "no ceiling",
    defaultValue: String(AUTHORED_MAX_ERROR_RATE),
    hint: "The fraction of an agent's recent turns that may be errors, breached only strictly above this — at 0.5 over a window of ten, five errors is not a breach and six is. Needs a window; either alone is no ceiling at all. Seeded with its window as a guardrail into a fresh configuration; clear both fields to unarm.",
  },
  {
    key: "errorRateWindow",
    label: "Error-rate window (turns)",
    kind: "count",
    placeholder: "no ceiling",
    defaultValue: String(AUTHORED_ERROR_RATE_WINDOW),
    hint: "How many of an agent's most recent turns the rate is measured over, and also the minimum sample: the ceiling cannot fire until the agent has taken this many turns. Seeded with the rate as a guardrail into a fresh configuration; clear both fields to unarm.",
  },
  {
    key: "maxCost",
    label: "Cost (USD)",
    kind: "amount",
    placeholder: "no ceiling",
    hint: "Ceiling on the whole run's accumulated cost, checked at each agent's turn boundary. Empty arms no such ceiling. The turn that crosses one completes, so the recorded cost can exceed it by up to one turn per running agent. A run whose model reports no cost is never stopped by it.",
  },
  {
    key: "replayMaxBytes",
    label: "Session journal (MiB)",
    kind: "mib",
    required: true,
    defaultValue: String(AUTHORED_REPLAY_MAX_MIB),
    hint: "Ceiling on the session capture journal gg writes as it runs — the one thing a run that hangs leaves behind. Crossing it stops capture and marks the record truncated; the run itself continues. Every run writes the journal, so this one is always written, and it has no unbounded setting: 0 would stop capture before its first line and is refused.",
  },
];
