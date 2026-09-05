import { useEffect, useState } from "react";
import type { GgSavedAgent } from "@clockwyrks/run-record/gg";
import type { Model } from "../../../../client/types";
import {
  AGENT_MODES,
  RUN_LIMIT_SPECS,
  capabilitiesForMode,
  type RunLimitSpec,
} from "./ggCatalog";
import { CapField, HelpTip } from "./GgCapabilityFields";
import { GgAgentEditor } from "./GgAgentEditor";
import { GgAgentImportDialog } from "./GgAgentImportDialog";
import { GgEditorTabs, type GgEditorTab } from "./GgEditorTabs";
import { GgHookList } from "./GgHookRows";
import {
  draftAgentOverrides,
  importSavedAgent,
  overrideLabel,
  revertImportedAgent,
} from "./ggAgentLibrary";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { routes } from "../../../routes";
import { familyOf } from "../../../data/families";
import {
  agentStates,
  blankAgentDraft,
  blankConfigSlot,
  capabilityActive,
  dropAgentReferences,
  passthroughSlotName,
  referencedModelSlots,
  renameAgentSlug,
  runLimitsError,
  runLimitsWarning,
  seedAgentParams,
  unusedAgentName,
  type GgAgentDraft,
  type GgConfigDraft,
  type GgConfigSlotDraft,
  type GgHookDraft,
  type GgModelSlotDraft,
  type GgSlotTargetDraft,
} from "./ggConfigDraft";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

// gg reaches every model through OpenRouter, so a binding must name the model's
// *OpenRouter* slug (`openai/gpt-5.6-sol`). Scoping the picker to this family makes it
// commit the right alias for a model catalogued under several.
const GG_MODEL_FAMILY = familyOf("gg");

// The `step` a ceiling's number input moves in: whole turns/seconds/errors for a
// count, a twentieth for a rate, and anything for money.
function limitStep(kind: RunLimitSpec["kind"]): number | "any" {
  if (kind === "count" || kind === "mib") return 1;
  return kind === "fraction" ? 0.05 : "any";
}

// What an agent's row in the configuration's list says about it after its name: its
// type, and then what that type makes it — a worker's enabled capabilities, or a
// machine's states.
function agentSummary(agent: GgAgentDraft, label: string): string {
  if (agent.mode === "fsm") {
    const states = agentStates(agent).length;
    return `${label} · ${states} ${states === 1 ? "state" : "states"}`;
  }
  const on = capabilitiesForMode(agent.mode).filter((cap) =>
    capabilityActive(agent, cap),
  ).length;
  return `${label} · ${on} capabilities enabled`;
}

// --- The mapping between launch inputs and agent slots ------------------------------
//
// An **agent slot** is declared by the agent whose bindings defer to it; a **configuration
// slot** is a launch input this configuration declares, naming the agent slots it fills. A
// run asks for exactly one set of models — the configuration's own slots plus every agent
// slot marked passthrough — and every bound agent slot must reach that set exactly one way.
// The three functions below derive that whole picture from the draft, which is what the
// Slots tab edits and what its summary reports.

// The key one (agent, agent slot) pair is counted under. A NUL joins the two ids because
// neither can contain one, so no pair can be spelled two different ways.
function agentSlotKey(agentId: string, slotId: string): string {
  return `${agentId}\u0000${slotId}`;
}

// One agent slot as the configuration sees it, with what fills it.
interface AgentSlotView {
  agent: GgAgentDraft;
  slot: GgModelSlotDraft;
  // Whether that agent's own bindings actually defer to this slot. One nothing binds feeds
  // nothing — it is written to no capability set and asked about at no launch — so it owes
  // the mapping nothing either, and the agent's own Slots tab is where it is flagged.
  bound: boolean;
  // The [ids](GgConfigSlotDraft.id) of the configuration slots naming this pair. For a
  // bound slot exactly one of two things holds: this list carries one id, or the slot is
  // passthrough. Neither, both, or two ids is what the save gate refuses.
  filledBy: string[];
}

/**
 * Every agent slot this configuration's profiles declare, in agent order, each carrying
 * the configuration slots that fill it.
 *
 * Derived from the draft on every render rather than tracked as the operator types, so it
 * says the same thing after a reload as it does mid-edit — and so it cannot disagree with
 * [slotMappingError], which reads the same two sides.
 */
function agentSlotViews(value: GgConfigDraft): AgentSlotView[] {
  const filledBy = new Map<string, string[]>();
  for (const configSlot of value.modelSlots) {
    for (const target of configSlot.targets) {
      const key = agentSlotKey(target.agentId, target.slotId);
      filledBy.set(key, [...(filledBy.get(key) ?? []), configSlot.id]);
    }
  }
  return value.agents.flatMap((agent) => {
    const bound = referencedModelSlots(agent);
    return agent.modelSlots.map((slot) => ({
      agent,
      slot,
      bound: bound.has(slot.id),
      filledBy: filledBy.get(agentSlotKey(agent.id, slot.id)) ?? [],
    }));
  });
}

// How one (agent, agent slot) pair reads on screen: the agent's name for prose, its slug
// beside it because two profiles may legitimately carry one name and this is a *chooser* —
// two checkboxes reading identically is a choice an operator cannot make. Every other
// profile chooser in the editor appends the slug for the same reason.
function agentSlotLabel(view: AgentSlotView): string {
  const agent = view.agent.name.trim()
    ? `${view.agent.name.trim()} (${view.agent.slug})`
    : view.agent.slug;
  return `${agent} · ${view.slot.name.trim() || "unnamed"}`;
}

// One line in a configuration slot's list of the agent slots it fills.
interface TargetRow {
  key: string;
  agentId: string;
  slotId: string;
  label: string;
  checked: boolean;
  // Why this pair is not this configuration slot's to take, or `null` when it is. A pair
  // another slot already fills is shown rather than dropped from the list: "filled by
  // `writer`" is the answer to why it is missing, and hiding it leaves the question.
  taken: string | null;
  // What is wrong with the pair as this slot already holds it — it is passthrough as well,
  // nothing on that agent binds it any more, or the slot itself is gone. Every one of these
  // is cleared by unchecking the row, so the row stays live even while it is faulty.
  fault: string | null;
}

/**
 * The candidate list for one configuration slot: every bound, non-passthrough agent slot,
 * plus whatever this slot already targets — including a target that has since gone stale,
 * so it is cleared by the same checkbox the rest are.
 */
function targetRowsFor(
  value: GgConfigDraft,
  agentSlots: ReadonlyArray<AgentSlotView>,
  configSlot: GgConfigSlotDraft,
): TargetRow[] {
  const configSlotName = (id: string) =>
    value.modelSlots.find((s) => s.id === id)?.name.trim() || "unnamed";
  const rows: TargetRow[] = [];
  for (const view of agentSlots) {
    const checked = view.filledBy.includes(configSlot.id);
    const other = view.filledBy.find((id) => id !== configSlot.id);
    // A slot exposed on its own, or one nothing binds, is no candidate: filling the first
    // asks for two models for one binding, and the second for a model nothing reads.
    if (!checked && (!view.bound || view.slot.passthrough)) continue;
    rows.push({
      key: agentSlotKey(view.agent.id, view.slot.id),
      agentId: view.agent.id,
      slotId: view.slot.id,
      label: agentSlotLabel(view),
      checked,
      taken: !checked && other ? `filled by ${configSlotName(other)}` : null,
      fault: !checked
        ? null
        : view.slot.passthrough
          ? "also passthrough, so a launch would ask for it twice"
          : !view.bound
            ? "nothing on that agent defers to it"
            : other
              ? `also filled by ${configSlotName(other)}`
              : null,
    });
  }
  for (const target of configSlot.targets) {
    const known = agentSlots.some(
      (v) => v.agent.id === target.agentId && v.slot.id === target.slotId,
    );
    if (known) continue;
    rows.push({
      key: agentSlotKey(target.agentId, target.slotId),
      agentId: target.agentId,
      slotId: target.slotId,
      // Nothing readable is left to name it by: the target holds the profile's internal
      // id, which is opaque and was never shown, and the profile that gave it a slug is
      // gone. The fault below the row is the whole of what there is to say, and the row
      // exists so the same checkbox that clears the others clears this one.
      label: "(removed)",
      checked: true,
      taken: null,
      fault: "no agent in this configuration declares this slot",
    });
  }
  return rows;
}

// One launch input as the Slots tab's summary lists it: the name the new-run form asks
// under, and the agent slots the model collected under it is handed to.
interface LaunchInput {
  name: string;
  fills: string[];
}

/**
 * The one set of models a run of this configuration is launched with: every configuration
 * slot in declaration order, then every passthrough agent slot under the name the launch
 * form gives it. Mirrors [launchModelSlots], which does the same over the wire format.
 *
 * Names are *not* deduplicated here the way the wire-format reader deduplicates them: two
 * inputs answering to one name is a fault the save gate refuses, and a summary that quietly
 * showed one of them would hide it.
 */
function launchInputsOf(
  value: GgConfigDraft,
  agentSlots: ReadonlyArray<AgentSlotView>,
): LaunchInput[] {
  const pair = (agentId: string, slotId: string) =>
    agentSlots.find((v) => v.agent.id === agentId && v.slot.id === slotId);
  return [
    ...value.modelSlots.map((configSlot) => ({
      name: configSlot.name.trim() || "unnamed",
      fills: configSlot.targets.map((target) => {
        const view = pair(target.agentId, target.slotId);
        return view ? agentSlotLabel(view) : "a slot that no longer exists";
      }),
    })),
    ...agentSlots
      .filter((view) => view.bound && view.slot.passthrough)
      .map((view) => ({
        // Named after the profile's **slug**, because that is the name the launch form
        // gives it — [launchModelSlots] builds the same name off the same field, and a
        // summary that spelled it any other way would promise an input no run asks for.
        name: passthroughSlotName(view.agent.slug, view.slot.name.trim()),
        fills: [agentSlotLabel(view)],
      })),
  ];
}

/**
 * The note at the top of an imported profile's view: which saved agent it follows, what
 * this configuration has pinned, and the two ways out.
 *
 * The overrides are listed by name rather than counted, because "2 local changes" tells
 * an operator that something has drifted without telling them what — and the whole point
 * of the overlay is that the rest of the profile is still following the saved agent.
 */
function ImportedAgentNote({
  agent,
  overrides,
  readOnly,
  busy,
  onRevert,
  onDetach,
  onSaveToLibrary,
}: {
  agent: GgAgentDraft;
  overrides: ReadonlyArray<string>;
  readOnly: boolean;
  busy: boolean;
  onRevert: () => void;
  onDetach: () => void;
  onSaveToLibrary: (() => void) | undefined;
}) {
  const source = agent.source;
  // A profile declared inline. Offered the one step that changes that: writing it to
  // the library, which leaves this configuration following what it just wrote.
  if (!source) {
    if (readOnly || !onSaveToLibrary) return null;
    return (
      <section className={gg.importedNote}>
        <p className={gg.importedLead}>
          Declared in this configuration. Save it to your agent library to reuse
          it in others; this configuration then follows it wherever it has not
          pinned a field of its own.
        </p>
        <div className={gg.importedActions}>
          <button
            type="button"
            className={runExec.secondary}
            onClick={onSaveToLibrary}
            disabled={busy || !agent.name.trim()}
          >
            {busy ? "Saving…" : "Save to library"}
          </button>
        </div>
      </section>
    );
  }
  const href = routes.accountGgAgentEdit(source.agentId);
  if (!source.base) {
    return (
      <section className={gg.importedNote}>
        <p className={gg.importedLead}>
          Followed the saved agent <code>{source.name}</code>, which is no
          longer on this account. This profile is the configuration&rsquo;s own,
          and saving records it as such.
        </p>
      </section>
    );
  }
  return (
    <section className={gg.importedNote}>
      <p className={gg.importedLead}>
        Follows the saved agent{" "}
        <a href={href}>
          <code>{source.name}</code>
        </a>
        . Every field left alone here takes that agent as it stands; editing one
        pins it to this configuration and leaves the saved agent as it is.
      </p>
      <p className={gg.importedOverrides}>
        {overrides.length
          ? `Pinned here: ${overrides.map(overrideLabel).join(", ")}.`
          : "Nothing pinned here yet."}
      </p>
      {!readOnly && (
        <div className={gg.importedActions}>
          <button
            type="button"
            className={runExec.secondary}
            onClick={onRevert}
            disabled={overrides.length === 0}
          >
            Revert to the saved agent
          </button>
          <button
            type="button"
            className={runExec.secondary}
            onClick={onDetach}
          >
            Detach
          </button>
        </div>
      )}
    </section>
  );
}

/** The configuration editor's sections. */
type ConfigTab = "configuration" | "slots" | "agents";

const CONFIG_TABS: ReadonlyArray<{ key: ConfigTab; label: string }> = [
  { key: "configuration", label: "Configuration" },
  { key: "slots", label: "Slots" },
  { key: "agents", label: "Agents" },
];

interface GgConfigEditorProps {
  /** The configuration being edited. */
  value: GgConfigDraft;
  /** Called with the whole next draft on every edit. */
  onChange: (next: GgConfigDraft) => void;
  /** The configuration's name, edited on the Configuration tab. */
  name: string;
  onNameChange: (next: string) => void;
  /** Its one-line purpose. */
  description: string;
  onDescriptionChange: (next: string) => void;
  /**
   * The internal [id](GgAgentDraft.id) of the agent whose per-agent view is open, or `null`
   * for the configuration itself. Owned by the page rather than here, because which view is
   * open decides what the page shows around the editor: Save configuration belongs to the
   * configuration, and Cancel / Save agent to an agent.
   *
   * The internal id and not the [slug](GgAgentDraft.slug): the id is minted once, never
   * rewritten and unique whatever the operator types, so it names exactly one row even while
   * two profiles are sharing a slug — and a rename cannot move this view off the profile it
   * is open on.
   */
  editingAgentId: string | null;
  /**
   * Open an agent's view (or return to the configuration with `null`).
   *
   * `snapshot` is the draft to treat as what the agent was opened *on*, and is passed
   * only when opening an agent in the same act that produced it — importing a saved
   * agent opens the profile it just added, and the draft this callback would otherwise
   * see is the one from before the import. Without it, Cancel on a fresh import would
   * restore a configuration that never had it.
   */
  onEditingAgentChange: (
    agentId: string | null,
    snapshot?: GgConfigDraft,
  ) => void;
  /** The model catalog backing the pickers (free text is still allowed). */
  models: Model[];
  /**
   * The account's [saved agents](./ggAgentLibrary), which the Agents section imports
   * from. Empty when the operator has saved none, which leaves the section offering
   * only inline agents.
   */
  savedAgents?: GgSavedAgent[];
  /**
   * Write the named profile to the account's agent library and leave this configuration
   * following it. Omitted where there is nothing to write to (a signed-out or read-only
   * host), which is what hides the control.
   */
  onSaveAgentToLibrary?: (agentId: string) => void;
  /** Whether a library write is in flight, so the control says so. */
  savingAgent?: boolean;
  /** Render every control disabled. */
  readOnly?: boolean;
}

// The gg capability-set editor.
//
// The configuration itself is three sections — what it *is* (its name, its purpose and
// the ceilings every agent runs under), the **slots** it declares and the agent slots each
// of them fills, and its list of **agent profiles** — and opening a profile switches the
// whole editor to that agent's own tabbed view.
//
// An agent's **type** ([GgAgentMode]) is the first thing chosen about it, because it
// decides what the rest of the form even offers: Tools and RaC are two ways of driving
// the same capabilities (with a couple that only one of them reads), and FSM is not a
// worker at all — a machine has no capabilities of its own, so it is configured by its
// states instead. Capabilities are per agent, so one configuration can vary what each agent
// in a run can do, and give different agents different models or even different types.
//
// Which profile is the **root** — the one that drives the run's top-level session — is a
// flag on the draft, so it can be renamed to anything and moved to another profile;
// nothing here decides it by looking for a particular name.
//
// This is the one authoring surface for a gg configuration. It is deliberately *not* a
// launcher: a configuration carries no test case, and the models it does not pin outright
// are collected at launch, one per *launch input* — this configuration's own slots, plus
// every agent slot its profiles expose as passthrough. The Slots tab is where the two are
// mapped onto each other, and where the whole set is listed.
export function GgConfigEditor({
  value,
  onChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  editingAgentId,
  onEditingAgentChange,
  models,
  savedAgents = [],
  onSaveAgentToLibrary,
  savingAgent = false,
  readOnly = false,
}: GgConfigEditorProps) {
  const [tab, setTab] = useState<ConfigTab>("configuration");
  // Whether the library picker is open. Nothing else is held: the dialog hands back the
  // whole entry that was picked, so there is no half-made choice to keep between renders.
  const [importing, setImporting] = useState(false);

  // A guard against a stale id (the open agent was removed out from under the view):
  // fall back to the configuration rather than rendering nothing at all.
  const openAgentExists = value.agents.some((a) => a.id === editingAgentId);
  useEffect(() => {
    if (editingAgentId !== null && !openAgentExists) onEditingAgentChange(null);
  }, [editingAgentId, openAgentExists, onEditingAgentChange]);

  // --- Agent mutators -------------------------------------------------------
  //
  // Every one of these names the row it acts on by its internal [id](GgAgentDraft.id).
  // Nothing else in the draft will do: a slug is the operator's to write and two rows may
  // carry one while they are being told apart, so a mutator keyed by slug would open, patch
  // or remove both at once — and a position moves under a removal. The internal id is
  // minted per profile and never rewritten, so it names one row for as long as the row
  // exists.
  function updateAgent(agentId: string, patch: Partial<GgAgentDraft>) {
    onChange({
      ...value,
      agents: value.agents.map((a) =>
        a.id === agentId ? { ...a, ...patch } : a,
      ),
    });
  }
  function addAgent() {
    // A default label to rename, a slug minted unique against the profiles it joins, its
    // own passthrough `primary` slot (so it asks for one model at launch without the
    // configuration declaring anything), and its run-level agent params pointed at the root.
    const added = blankAgentDraft(
      unusedAgentName(value.agents),
      [],
      {},
      value.agents,
    );
    const agents = [
      ...value.agents,
      seedAgentParams(added, value.rootAgentId || added.id),
    ];
    onChange({
      ...value,
      agents,
      // The first agent added to an empty configuration is its root: a configuration
      // always has one as soon as it has any agent at all.
      rootAgentId: value.rootAgentId || added.id,
    });
  }
  function removeAgent(agentId: string) {
    const remaining = value.agents.filter((a) => a.id !== agentId);
    // Removing the root hands the role to whatever is left, so a configuration is never
    // left with agents but no root. Removing the last agent leaves none — a legitimate
    // editing state on the way to replacing them, which the save gate refuses.
    const rootAgentId =
      agentId === value.rootAgentId
        ? (remaining[0]?.id ?? "")
        : value.rootAgentId;
    onChange({
      ...value,
      agents: dropAgentReferences(remaining, agentId, rootAgentId),
      rootAgentId,
    });
  }
  function makeRoot(agentId: string) {
    onChange({ ...value, rootAgentId: agentId });
  }

  // --- Imported agents ------------------------------------------------------
  //
  // An imported profile follows a saved agent in every field this configuration has not
  // edited. Which fields those are is derived by comparing the profile against the saved
  // agent, so the two controls below are the whole vocabulary: revert drops this
  // configuration's values and takes the saved agent's, and detach keeps the values and
  // stops following anything.
  function importAgent(saved: GgSavedAgent) {
    const imported = importSavedAgent(value, saved);
    onChange(imported.draft);
    setImporting(false);
    // Straight into the imported profile: an operator imports an agent in order to place
    // it in this configuration, and its roster and slot binding are what they came for. The
    // import mints the profile an id of its own and hands it back, so this opens exactly
    // the row it added even when the slug it arrived under is one another profile carries.
    onEditingAgentChange(imported.agentId, imported.draft);
  }
  function detachAgent(agentId: string) {
    updateAgent(agentId, { source: null });
  }
  function revertAgent(agentId: string) {
    onChange(revertImportedAgent(value, agentId));
  }

  // --- Configuration-slot (launch input) mutators ---------------------------
  //
  // A configuration slot is a launch input plus the agent slots it fills. The slots it
  // fills are declared by the agents themselves, so nothing here creates, renames or
  // removes one: this tab only decides which launch input reaches which agent binding.
  function updateConfigSlot(slotId: string, patch: Partial<GgConfigSlotDraft>) {
    onChange({
      ...value,
      modelSlots: value.modelSlots.map((s) =>
        s.id === slotId ? { ...s, ...patch } : s,
      ),
    });
  }
  function addConfigSlot() {
    onChange({
      ...value,
      modelSlots: [...value.modelSlots, blankConfigSlot()],
    });
  }
  function removeConfigSlot(slotId: string) {
    // The agent slots it filled are left reaching no launch input rather than silently
    // handed to another configuration slot or flipped to passthrough: which model each of
    // them should run on is the operator's call, and the summary below — and the save gate
    // — name them until it is made.
    onChange({
      ...value,
      modelSlots: value.modelSlots.filter((s) => s.id !== slotId),
    });
  }
  function toggleTarget(
    slotId: string,
    target: GgSlotTargetDraft,
    fills: boolean,
  ) {
    const configSlot = value.modelSlots.find((s) => s.id === slotId);
    if (!configSlot) return;
    updateConfigSlot(slotId, {
      targets: fills
        ? [...configSlot.targets, target]
        : configSlot.targets.filter(
            (t) => t.agentId !== target.agentId || t.slotId !== target.slotId,
          ),
    });
  }

  // --- Renaming a profile ---------------------------------------------------
  //
  // A slug is the operator's to write, and setting it is the whole of the rename
  // ([renameAgentSlug]): nothing in the configuration points at a slug, so a roster entry,
  // an `agent` param, a machine's state, the root flag and a configuration slot's target
  // all go on naming the profile's internal id and need no fixing up.
  //
  // Nor does this view, and the host is told nothing: which profile is open is that same
  // id. That is also what leaves Cancel restoring the profile as it stood — under the slug
  // it stood under — rather than banking the rename as the state it was opened on.
  function renameOpenSlug(agentId: string, slug: string) {
    onChange(renameAgentSlug(value, agentId, slug));
  }

  function setLimit(key: RunLimitSpec["key"], limit: string) {
    onChange({ ...value, limits: { ...value.limits, [key]: limit } });
  }

  // --- The open agent -------------------------------------------------------
  const openAgent = value.agents.find((a) => a.id === editingAgentId);
  if (editingAgentId !== null) {
    // The effect above is already returning to the configuration; render nothing for the
    // one frame in between rather than crashing on the missing profile.
    if (!openAgent) return null;
    return (
      <>
        <ImportedAgentNote
          agent={openAgent}
          overrides={draftAgentOverrides(value, openAgent.id)}
          readOnly={readOnly}
          busy={savingAgent}
          onRevert={() => revertAgent(openAgent.id)}
          onDetach={() => detachAgent(openAgent.id)}
          onSaveToLibrary={
            onSaveAgentToLibrary
              ? () => onSaveAgentToLibrary(openAgent.id)
              : undefined
          }
        />
        <GgAgentEditor
          config={value}
          agent={openAgent}
          onPatch={(patch) => updateAgent(openAgent.id, patch)}
          onRenameSlug={(slug) => renameOpenSlug(openAgent.id, slug)}
          models={models}
          readOnly={readOnly}
        />
      </>
    );
  }

  const limitsError = runLimitsError(value.limits);
  const limitsWarning = runLimitsWarning(value.limits);

  // The mapping this tab edits, and the two sides of it that are faults. Both lists are
  // what [slotMappingError] refuses the save on: a bound agent slot reaching no launch
  // input has no model to run, and one reaching two would be asked about twice.
  const agentSlots = agentSlotViews(value);
  const launchInputs = launchInputsOf(value, agentSlots);
  const unreachedSlots = agentSlots.filter(
    (view) =>
      view.bound && !view.slot.passthrough && view.filledBy.length === 0,
  );
  const doubledSlots = agentSlots.filter(
    (view) =>
      view.bound &&
      (view.filledBy.length > 1 ||
        (view.slot.passthrough && view.filledBy.length > 0)),
  );
  // A launch input has to be named, and named once: two answering to one name is one model
  // picker for two different bindings. Both halves of the launch form are counted — a
  // configuration slot may collide with another, or with the `<slug>.<slot>` a passthrough
  // slot is exposed under — because the save gate refuses either and a tab that flagged only
  // the first would send an operator looking for a fault it never showed.
  const configSlotNames = value.modelSlots.map((s) => s.name.trim());
  const passthroughNames = agentSlots
    .filter((view) => view.bound && view.slot.passthrough)
    .map((view) => passthroughSlotName(view.agent.slug, view.slot.name.trim()));
  const badSlotNames =
    value.modelSlots.filter(
      (slot, i) =>
        !slot.name.trim() || configSlotNames.indexOf(slot.name.trim()) !== i,
    ).length +
    passthroughNames.filter((name) => configSlotNames.includes(name)).length;
  const danglingTargets = value.modelSlots.reduce(
    (count, slot) =>
      count +
      slot.targets.filter(
        (target) =>
          !agentSlots.some(
            (view) =>
              view.agent.id === target.agentId &&
              view.slot.id === target.slotId,
          ),
      ).length,
    0,
  );
  // Two profiles under one slug is not an editing state anything can resolve for the
  // operator: it is the one name the model is shown for both, so a roster would offer it
  // twice and every row of the run's telemetry would name both at once. Counted per row, so
  // the badge says how many rows to look at.
  const duplicateSlugs = value.agents.filter(
    (agent) => value.agents.filter((a) => a.slug === agent.slug).length > 1,
  ).length;

  // What is wrong on each tab, so a fault stays findable from whichever tab is open.
  const tabs: GgEditorTab<ConfigTab>[] = CONFIG_TABS.map(({ key, label }) => ({
    key,
    label,
    problems:
      key === "configuration"
        ? (name.trim() ? 0 : 1) + (limitsError ? 1 : 0)
        : key === "slots"
          ? badSlotNames +
            danglingTargets +
            unreachedSlots.length +
            doubledSlots.length
          : (value.agents.length === 0 ? 1 : 0) + duplicateSlugs,
  }));

  return (
    <>
      <GgEditorTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        ariaLabel="Configuration sections"
      />

      {tab === "configuration" && (
        <>
          <div className={runExec.fields}>
            <label className={runExec.field}>
              <span className={runExec.fieldLabel}>Configuration name</span>
              <input
                className={runExec.input}
                type="text"
                value={name}
                disabled={readOnly}
                placeholder="e.g. no-compaction"
                onChange={(e) => onNameChange(e.target.value)}
              />
            </label>
            <label className={runExec.field}>
              <span className={runExec.fieldLabel}>Description (optional)</span>
              <input
                className={runExec.input}
                type="text"
                value={description}
                disabled={readOnly}
                placeholder="what this arm is for"
                onChange={(e) => onDescriptionChange(e.target.value)}
              />
            </label>
          </div>

          {/* Run limits — the operator's guardrails, applied to every agent and every
              agent type at once, so they sit on the configuration rather than inside one
              agent. */}
          <section className={gg.limitsWidget}>
            <p className={runExec.sectionLabel}>
              Run limits
              <HelpTip text="The ceilings a run is bounded by, applied to every agent whatever its type. A run stopped by one records which one stopped it. Leaving a field empty leaves that ceiling unarmed, since gg arms none nobody wrote. The two exceptions every run has are the agent pool and the capture journal, which are always written." />
            </p>
            <div className={gg.limitGrid}>
              {RUN_LIMIT_SPECS.map((spec) => (
                // A seeded ceiling — required or error guardrail — can be "moved off"
                // its authored figure, so it carries the reset. An unseeded ceiling's
                // empty field is the setting rather than a blank standing in for one, so
                // it is offered no reset — there is nothing to put it back to.
                <CapField
                  key={spec.key}
                  label={spec.label}
                  hint={spec.hint}
                  modified={
                    !readOnly &&
                    spec.defaultValue !== undefined &&
                    value.limits[spec.key] !== spec.defaultValue
                  }
                  onReset={
                    spec.defaultValue === undefined
                      ? undefined
                      : () => setLimit(spec.key, spec.defaultValue!)
                  }
                >
                  {(id) => (
                    <input
                      id={id}
                      className={runExec.input}
                      type="number"
                      min={0}
                      max={spec.kind === "fraction" ? 1 : undefined}
                      step={limitStep(spec.kind)}
                      value={value.limits[spec.key]}
                      disabled={readOnly}
                      onChange={(e) => setLimit(spec.key, e.target.value)}
                      placeholder={spec.placeholder}
                    />
                  )}
                </CapField>
              ))}
            </div>
            {limitsError ? (
              <p className={gg.fieldError}>{limitsError}</p>
            ) : (
              limitsWarning && (
                <p className={gg.limitWarning}>{limitsWarning}</p>
              )
            )}
          </section>

          {/* Session hooks — the run's own two ends. Only these two live here: every
              other event fires because a particular agent wrote, ran, compacted, started
              or stopped, and is declared on that agent. These two have no agent they
              could belong to — the run has not started when the first fires and has
              finished when the second does. */}
          <section className={gg.limitsWidget}>
            <p className={runExec.sectionLabel}>
              Session hooks
              <HelpTip text="Commands and scripts gg runs at the run's two ends: before the root agent's first turn, and after its last. Session start may put text in front of the root; session end can neither block nor insert, and is where a run reports on itself. The model is never told a hook exists." />
            </p>
            <GgHookList
              hooks={value.hooks}
              scope="session"
              readOnly={readOnly}
              onChange={(hooks: GgHookDraft[]) => onChange({ ...value, hooks })}
              emptyNote="No session hooks."
            />
          </section>
        </>
      )}

      {/* The tab strip already names this section, so the slot list is the whole of
          it — a heading repeating the tab's own word would only push the first slot
          further down the form.

          Each block is one **launch input**: its name, the model the new-run form
          pre-fills it with, and the agent slots the model collected under it is handed
          to. The slots themselves belong to the agents that declare them, so this tab
          maps rather than declares — a checkbox list, because one launch input filling
          several agents' slots at once is the whole reason to declare one. */}
      {tab === "slots" && (
        <div className={gg.slotList}>
          {value.modelSlots.map((configSlot) => {
            const rows = targetRowsFor(value, agentSlots, configSlot);
            return (
              <div key={configSlot.id} className={gg.slotBlock}>
                <div className={gg.slotFields}>
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Slot name</span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={configSlot.name}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateConfigSlot(configSlot.id, {
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g. primary"
                    />
                  </label>
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>
                      Default model (optional)
                    </span>
                    <ModelCombobox
                      value={configSlot.defaultModelId}
                      onChange={(v) =>
                        updateConfigSlot(configSlot.id, { defaultModelId: v })
                      }
                      models={models}
                      harnessFamily={GG_MODEL_FAMILY}
                      inputClassName={runExec.input}
                      disabled={readOnly}
                      placeholder="left to the launcher"
                    />
                  </label>
                  {!readOnly && (
                    <button
                      type="button"
                      className={gg.slotRemove}
                      onClick={() => removeConfigSlot(configSlot.id)}
                      aria-label={`Remove the ${configSlot.name || "unnamed"} configuration slot`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div
                  className={gg.slotTargets}
                  role="group"
                  aria-label={`Agent slots the ${configSlot.name.trim() || "unnamed"} configuration slot fills`}
                >
                  <span className={runExec.fieldLabel}>Fills</span>
                  {rows.length === 0 ? (
                    <p className={gg.slotTargetNote}>
                      Nothing to fill: every slot this configuration&rsquo;s
                      agents defer to is either exposed on its own or already
                      filled by another configuration slot.
                    </p>
                  ) : (
                    <div className={gg.toggleList}>
                      {rows.map((row) => (
                        <label
                          key={row.key}
                          className={`${gg.toggleItem} ${row.taken ? gg.slotTargetTaken : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={row.checked}
                            disabled={readOnly || Boolean(row.taken)}
                            onChange={(e) =>
                              toggleTarget(
                                configSlot.id,
                                { agentId: row.agentId, slotId: row.slotId },
                                e.target.checked,
                              )
                            }
                          />
                          <span>{row.label}</span>
                          {row.taken && (
                            <span className={gg.slotTargetNote}>
                              {row.taken}
                            </span>
                          )}
                          {row.fault && (
                            <span className={gg.slotTargetFault}>
                              {row.fault}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {configSlot.targets.length === 0 && (
                  <p className={gg.fieldError}>
                    This slot fills nothing, so a launch would ask for a model
                    and hand it to no agent.
                  </p>
                )}
              </div>
            );
          })}
          {value.modelSlots.length === 0 && (
            <p className={`${runExec.muted} ${gg.backdropNote}`}>
              No configuration slots. Each agent&rsquo;s own slots then reach
              the launch form on their own. A configuration slot is how one
              launch input fills several agents&rsquo; slots at once.
            </p>
          )}
          {!readOnly && (
            <button
              type="button"
              className={runExec.secondary}
              onClick={addConfigSlot}
            >
              + Add configuration slot
            </button>
          )}

          {/* What a launch actually asks for, which is the one thing neither half of the
              mapping says on its own: this configuration's slots are here, the agents'
              passthrough slots are on the agents, and a run collects one model for each
              of them. Read-only — every line of it is edited above or on an agent — and
              the faults under it are the ones the save gate refuses, gathered where the
              picture they break is on screen. */}
          <section className={`${gg.limitsWidget} ${gg.launchSummary}`}>
            <p className={runExec.sectionLabel}>
              Exposed at launch
              <HelpTip text="The one set of models a run of this configuration is launched with: every configuration slot, then every agent slot marked passthrough, which the launch form names after the agent that declares it. A binding this configuration pinned outright was decided when it was written and is never asked about." />
            </p>
            {launchInputs.length === 0 ? (
              <p className={runExec.muted}>
                Nothing. A launch asks for no model at all, so every agent runs
                on the model its own binding pins.
              </p>
            ) : (
              <ul className={gg.launchList}>
                {launchInputs.map((input, i) => (
                  <li key={`${input.name}-${i}`} className={gg.launchRow}>
                    <code className={gg.launchName}>{input.name}</code>
                    <span className={gg.launchFills}>
                      {input.fills.length
                        ? `→ ${input.fills.join(", ")}`
                        : "→ nothing"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {unreachedSlots.map((view) => (
              <p
                key={agentSlotKey(view.agent.id, view.slot.id)}
                className={gg.fieldError}
              >
                <code>{view.slot.name.trim() || "unnamed"}</code> on{" "}
                <code>{view.agent.name.trim() || view.agent.slug}</code> reaches
                no launch input, so its bindings would run on no model. Fill it
                with a configuration slot above, or mark it passthrough on that
                agent.
              </p>
            ))}
            {doubledSlots.map((view) => (
              <p
                key={agentSlotKey(view.agent.id, view.slot.id)}
                className={gg.fieldError}
              >
                <code>{view.slot.name.trim() || "unnamed"}</code> on{" "}
                <code>{view.agent.name.trim() || view.agent.slug}</code> reaches
                the launch form more than once. One binding takes exactly one
                launch input, so clear its passthrough or drop a configuration
                slot that fills it.
              </p>
            ))}
          </section>
        </div>
      )}

      {/* As with the slots, the tab strip names this section; what an agent is and
          what the root does are said by the per-agent view and the `root` badge on
          the row that carries it, not by a paragraph above the list. */}
      {tab === "agents" && (
        <>
          <div className={gg.slotList}>
            {value.agents.map((agent) => {
              // The slots a binding defers to are the agent's own, so the row's summary
              // reads the name off the profile rather than off the configuration.
              const slotName = agent.modelSlots.find(
                (s) => s.id === agent.modelSlotId,
              )?.name;
              const duplicateSlug =
                value.agents.filter((a) => a.slug === agent.slug).length > 1;
              // A machine contributes no model half to its row: it runs none, so "no
              // model" would read as something missing rather than as the type it is.
              const modelSummary =
                agent.mode === "fsm"
                  ? null
                  : agent.modelSource === "model-slot"
                    ? `slot: ${slotName?.trim() || "none"}`
                    : agent.modelId || "no model";
              const modeLabel =
                AGENT_MODES.find((m) => m.value === agent.mode)?.label ?? "";
              const isRootAgent = agent.id === value.rootAgentId;
              // What this profile follows, if anything. A profile whose saved agent is
              // gone says so on the row rather than quietly reading as inline: it is
              // still whole, but it has stopped following what it was imported from.
              const source = agent.source;
              const pinned = source?.base
                ? draftAgentOverrides(value, agent.id).length
                : 0;
              return (
                <div key={agent.id} className={gg.slotBlock}>
                  <div className={gg.agentRow}>
                    {/* Name over its summary, so a row reads as a heading with a
                        subtitle rather than one long line. */}
                    <span className={gg.agentIdentity}>
                      <span className={gg.agentNameLine}>
                        <span className={gg.capName}>
                          {agent.name || "unnamed"}
                        </span>
                        {isRootAgent && (
                          <span className={gg.rootBadge}>root</span>
                        )}
                        {source && (
                          <span className={gg.sharedBadge}>
                            {source.base
                              ? `follows ${source.name}`
                              : `followed ${source.name} (gone)`}
                          </span>
                        )}
                      </span>
                      <span className={gg.capId}>
                        {/* The profile's slug leads the summary line: it is the name the
                            model is shown and the name a run's telemetry keys on, and it
                            is unique where names are prose that may repeat — so it is the
                            half of the row that tells two profiles apart. The internal id
                            is shown nowhere; it is nobody's to read. */}
                        {agent.slug} · {agentSummary(agent, modeLabel)}
                        {modelSummary ? ` · ${modelSummary}` : ""}
                        {agent.hooks.length
                          ? ` · ${agent.hooks.length} ${agent.hooks.length === 1 ? "hook" : "hooks"}`
                          : ""}
                        {pinned
                          ? ` · ${pinned} ${pinned === 1 ? "field" : "fields"} pinned here`
                          : ""}
                      </span>
                    </span>
                    {!readOnly && !isRootAgent && (
                      <button
                        type="button"
                        className={runExec.secondary}
                        onClick={() => makeRoot(agent.id)}
                      >
                        Make root
                      </button>
                    )}
                    <span className={gg.agentActions}>
                      <button
                        type="button"
                        className={runExec.secondary}
                        onClick={() => onEditingAgentChange(agent.id)}
                      >
                        {readOnly ? "View" : "Edit"}
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          className={gg.slotRemove}
                          onClick={() => removeAgent(agent.id)}
                          aria-label={`Remove the ${agent.name || "unnamed"} agent`}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </div>
                  {/* A slug is operator-authored and is the one name the model is shown
                      for a profile, so two rows carrying one is not a matter of taste: a
                      roster would offer the same name twice, and the model's answer would
                      name both profiles at once. Said on each of the rows involved,
                      because either one is where it gets fixed. */}
                  {duplicateSlug && (
                    <p className={gg.fieldError}>
                      Another profile carries the slug <code>{agent.slug}</code>
                      , so a reference to either would name both. Rename one of
                      them, or override the imported profile&rsquo;s slug.
                    </p>
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <div className={gg.agentAddRow}>
                <button
                  type="button"
                  className={runExec.secondary}
                  onClick={addAgent}
                >
                  + Add agent
                </button>
                {/* Importing a saved agent is the other way to declare a profile: the
                    configuration then follows that agent wherever it has not pinned a
                    field of its own. One button, which raises a list of the library's
                    entries with the note each carries — a `<select>` beside it could show
                    only bare names, which is not enough to tell two entries apart. */}
                {savedAgents.length === 0 ? (
                  <span className={runExec.muted}>
                    Save an{" "}
                    <a href={routes.accountGgAgents()}>agent to your library</a>{" "}
                    to import it here.
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`${runExec.secondary} ${gg.agentImportButton}`}
                    onClick={() => setImporting(true)}
                  >
                    + Import agent
                  </button>
                )}
              </div>
            )}
          </div>
          {value.agents.length === 0 && (
            <p className={gg.fieldError}>
              This configuration has no agents. Add at least one before saving
              it.
            </p>
          )}
          {/* The library is a prop, so it can re-resolve to empty while the picker is
              open — a modal offering nothing is worse than the empty-state note on the
              row, which at least links to the library. */}
          {importing && savedAgents.length > 0 && (
            <GgAgentImportDialog
              savedAgents={savedAgents}
              onPick={importAgent}
              onDismiss={() => setImporting(false)}
            />
          )}
        </>
      )}
    </>
  );
}
