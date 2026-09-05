import { useState } from "react";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
} from "@clockwyrks/run-record/gg-system-prompt";
import type { GgSubagentScope } from "@clockwyrks/run-record/gg";
import { SegmentedControl } from "@clockwyrks/ui";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { ResetControl } from "../../../components/ResetControl";
import { familyOf } from "../../../data/families";
import {
  AGENT_MODES,
  AGENT_MODE_HINT,
  CAP_GROUPS,
  DEFAULT_OPENING_TURN,
  FSM_CAP,
  GG_MODULES,
  LOOP_DETECTION_HINT,
  LOOP_DETECTION_SPECS,
  MAX_OPENING_TREE_DEPTH,
  OPENING_TREE_OPERATION,
  RESPONSES_AS_CODE_CAP,
  SUBAGENT_SCOPES,
  capabilitiesForMode,
  openingTurnFunctions,
  type CapGroup,
  type CapSpec,
  type GgAgentMode,
  type LoopDetectionSpec,
} from "./ggCatalog";
import {
  CapabilityBody,
  CapField,
  FieldLabel,
  HelpTip,
  Switch,
} from "./GgCapabilityFields";
import { GgEditorTabs, type GgEditorTab } from "./GgEditorTabs";
import { GgHookList } from "./GgHookRows";
import {
  MODEL_PARAMS,
  agentParamErrors,
  blankModelSlot,
  capabilityDraftFor,
  armLoopDetection,
  defaultOpeningTurn,
  isValidAgentSlug,
  loopDetectionError,
  loopDetectionWarning,
  moduleHeld,
  openingTurnIsDefault,
  operationHeld,
  referencedModelSlots,
  setFeatureBundle,
  withCapabilityGrants,
  type GgAgentDraft,
  type GgCapabilityDraft,
  type GgConfigDraft,
  type GgHookDraft,
  type GgModelSlotDraft,
  type GgOpeningTreeDraft,
} from "./ggConfigDraft";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

// gg reaches every model through OpenRouter, so a binding must name the model's
// *OpenRouter* slug (`openai/gpt-5.6-sol`). Scoping the picker to this family makes it
// commit the right alias for a model catalogued under several.
const GG_MODEL_FAMILY = familyOf("gg");

// The agent-type selector's segments, derived from the catalog so a type added there
// appears here without a second list to keep in step.
const AGENT_MODE_OPTIONS = AGENT_MODES.map((mode) => ({
  value: mode.value,
  label: mode.label,
}));

/**
 * A typed depth for the opening tree's field: a whole number inside the range gg honours.
 *
 * The field is clamped rather than validated because every value outside `1..=`
 * [MAX_OPENING_TREE_DEPTH] refuses the launch, and a form that can write one is a form
 * that saves a configuration nothing will run. A field cleared to nothing reads as the
 * default rather than as zero.
 */
function clampTreeDepth(written: string): number {
  const parsed = Number.parseInt(written, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_OPENING_TURN.tree.depth;
  return Math.min(Math.max(parsed, 1), MAX_OPENING_TREE_DEPTH);
}

/** The per-agent editor's sections. */
type AgentTab =
  | "agent"
  | "tools"
  | "apis"
  | "opening"
  | "slots"
  | "roster"
  | "hooks"
  | "states";

/**
 * Which sections an agent of this type has, in display order.
 *
 * The tab set is a function of the agent's **type** and nothing else, because the type is
 * what decides which of these things gg will read. A machine takes no turns, so it has no
 * tools, no APIs, nobody to spawn, no lifecycle of its own to hook and — running no model
 * — nothing a model slot could fill; it has states, which no other type has. Tools and
 * RaC are the same capabilities offered two ways, so each gets the tab named for the
 * shape it actually meets them in. The opening turn is a code agent's alone: gg seeds it
 * as a program run before the model's first, and a tool-calling agent writes no program
 * for one to be seeded in front of.
 *
 * Absent rather than disabled: an empty section for a value gg would never read invites
 * configuring a run that does not exist.
 */
function tabsForMode(mode: GgAgentMode): ReadonlyArray<AgentTab> {
  if (mode === "fsm") return ["agent", "states"];
  return [
    "agent",
    ...(mode === "rac" ? (["apis", "opening"] as const) : (["tools"] as const)),
    "slots",
    "roster",
    "hooks",
  ];
}

const AGENT_TAB_LABELS: Record<AgentTab, string> = {
  agent: "Agent",
  tools: "Tools",
  apis: "APIs",
  opening: "Opening Turn",
  slots: "Slots",
  roster: "Roster",
  hooks: "Hooks",
  states: "States",
};

interface GgAgentEditorProps {
  /** The whole configuration — a machine's states name *other* profiles, and the roster lists them. */
  config: GgConfigDraft;
  /** The profile being edited. */
  agent: GgAgentDraft;
  /** Apply a patch to this profile. */
  onPatch: (patch: Partial<GgAgentDraft>) => void;
  /**
   * Rename this profile's [slug](GgAgentDraft.slug).
   *
   * Its own prop rather than a field of [onPatch] because a slug is the one field of a
   * profile the configuration around it has an opinion about — it has to be unique among
   * the profiles beside it — so it is set through the draft ([renameAgentSlug]) and this
   * view only reports what the operator typed.
   */
  onRenameSlug: (slug: string) => void;
  /** The model catalog backing the pickers (free text is still allowed). */
  models: Model[];
  readOnly: boolean;
  /**
   * The agent's one-line purpose, when it has somewhere to live: a saved library entry
   * carries one, a profile inside a configuration does not.
   *
   * Passed in rather than read off the draft because it belongs to the *library entry*
   * and not to the profile — but it is edited here all the same, because the Agent tab is
   * where the rest of the entry's identity is written. A page that hoists it above the
   * tab strip leaves one field of the form stranded outside the form.
   */
  description?: string;
  onDescriptionChange?: (next: string) => void;
}

/**
 * The per-agent editor: one agent profile's type, and everything that type makes it.
 *
 * Organized into tabs rather than one long column because an agent is several unrelated
 * decisions — what it *is*, what it may *do*, who it may *put to work*, what it is *held
 * to* — and a column makes an operator scroll past three of them to check the fourth.
 * Which tabs exist follows from the agent's type ([tabsForMode]).
 */
export function GgAgentEditor({
  config,
  agent,
  onPatch,
  onRenameSlug,
  models,
  readOnly,
  description,
  onDescriptionChange,
}: GgAgentEditorProps) {
  // Which capability groups are collapsed on the Tools/APIs tab.
  const [collapsed, setCollapsed] = useState<Set<CapGroup>>(
    () => new Set(CAP_GROUPS.filter((g) => !g.startOpen).map((g) => g.group)),
  );
  // Whether the (collapsed-by-default) full system-prompt template is expanded.
  const [promptOpen, setPromptOpen] = useState(false);
  const [tab, setTab] = useState<AgentTab>("agent");

  const tabs = tabsForMode(agent.mode);
  // Switching type can take the open tab away with it (Tools → FSM). Fall back to the
  // one section every type has rather than rendering nothing.
  const activeTab = tabs.includes(tab) ? tab : "agent";

  const isRoot = agent.id === config.rootAgentId;
  const isMachine = agent.mode === "fsm";
  // The whole configuration is passed, not this profile alone: a machine's states name
  // *other* profiles, so whether they name anything real is a question about the set.
  const paramsErrors = agentParamErrors(agent, config.agents);
  // The slots this agent's own bindings choose from: a model slot belongs to the profile
  // that defers to it, and the configuration's slots ([GgConfigDraft.modelSlots]) are
  // launch inputs that *fill* these rather than another list to bind against.
  const boundSlot = agent.modelSlots.find((s) => s.id === agent.modelSlotId);
  // Which of this agent's declarations something actually binds. A slot nothing binds is
  // dropped on save, so the Slots tab says so beside the declaration rather than letting
  // an operator name a launch input that would feed nothing.
  const referencedSlots = referencedModelSlots(agent);
  const modeSpec = AGENT_MODES.find((m) => m.value === agent.mode);
  // The capabilities this agent's type reads — empty for a machine, which is why it has
  // no Tools or APIs tab at all.
  const modeCaps = capabilitiesForMode(agent.mode);

  const updateCap = (id: string, patch: Partial<GgCapabilityDraft>) =>
    onPatch({
      capabilities: {
        ...agent.capabilities,
        [id]: {
          ...(agent.capabilities[id] ?? capabilityDraftFor(id)),
          ...patch,
        },
      },
    });
  const setParam = (id: string, key: string, param: string) => {
    const base = agent.capabilities[id] ?? capabilityDraftFor(id);
    updateCap(id, { params: { ...(base.params ?? {}), [key]: param } });
  };
  // Drop a param key entirely, which is a different state from setting it empty: a
  // `model` param defers to a slot exactly while its slot key is *present*, so "pin a
  // model instead" has to remove the key rather than blank it.
  const clearParam = (id: string, key: string) => {
    const base = agent.capabilities[id] ?? capabilityDraftFor(id);
    const params = { ...(base.params ?? {}) };
    delete params[key];
    updateCap(id, { params });
  };
  // Switching a capability writes its grant beside its flag: on hands over everything it
  // offers, off takes all of it back. The two must move together — a capability that is on
  // and grants nothing is an agent with a board it cannot file to — and doing it here
  // rather than in the toggle's own handler is what keeps the pairing true of every place
  // a capability can be switched.
  const setCapabilityEnabled = (cap: CapSpec, enabled: boolean) =>
    onPatch({
      capabilities: {
        ...agent.capabilities,
        [cap.id]: {
          ...(agent.capabilities[cap.id] ?? capabilityDraftFor(cap.id)),
          enabled,
        },
      },
      ...withCapabilityGrants(agent, cap, enabled),
    });
  const setFeature = (
    bundle: { tools: ReadonlyArray<string>; operations: ReadonlyArray<string> },
    on: boolean,
  ) => onPatch(setFeatureBundle(agent, bundle, on));
  // The opening turn's two lists, each edited one entry at a time. An entry is appended
  // rather than re-sorted, because order is meaningful — the functions are opened in the
  // listed order — and removed by name. Nothing here asks whether the entry is held: the
  // draft keeps whatever was listed, and only the held entries are written
  // ([heldOpeningTurn]), which is what lets a capability be switched off and on again
  // without the operator re-listing what it sells.
  const setOpeningEntry = (
    list: "modules" | "functions",
    id: string,
    on: boolean,
  ) => {
    const current = agent.openingTurn[list];
    const next = on
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((entry) => entry !== id);
    onPatch({ openingTurn: { ...agent.openingTurn, [list]: next } });
  };
  // The tree's two knobs, kept independent: switching it off leaves the depth exactly as
  // it is, so switching it back on restores the window the operator chose rather than
  // gg's default.
  // Whether this agent may walk the workspace at all. gg drops a tree it does not hold at
  // seed time, so a switch that promised one would be a control for a value the run never
  // reads.
  const treeHeld = operationHeld(agent, OPENING_TREE_OPERATION);
  const setOpeningTree = (patch: Partial<GgOpeningTreeDraft>) => {
    onPatch({
      openingTurn: {
        ...agent.openingTurn,
        tree: { ...agent.openingTurn.tree, ...patch },
      },
    });
  };
  // Loop detection's switch and its knobs, written separately: the knobs survive the
  // switch going off, so an operator who tunes the detector and then disarms it finds
  // their settings still there when they arm it again.
  // Arming seeds the five knobs it is short of, because an armed detector writes all
  // five and gg lends none of them; disarming leaves every knob exactly as it is.
  const setLoopEnabled = (enabled: boolean) =>
    onPatch({
      loopDetection: enabled
        ? armLoopDetection(agent.loopDetection)
        : { ...agent.loopDetection, enabled },
    });
  const setLoopKnob = (key: LoopDetectionSpec["key"], next: string) =>
    onPatch({
      loopDetection: {
        ...agent.loopDetection,
        knobs: { ...agent.loopDetection.knobs, [key]: next },
      },
    });
  const loopError = loopDetectionError(agent.loopDetection);
  const loopWarning = loopDetectionWarning(agent.loopDetection);
  // Changing the type changes nothing else. Everything the other types were configured
  // with stays in the draft untouched, so switching away and back inside one session is
  // not an edit — the wind-back to a type's defaults happens when the agent is
  // *committed* (`resetAgentForMode`), not while it is being edited.
  const setMode = (mode: GgAgentMode) => onPatch({ mode });

  // This agent's own slot declarations. Editing one in place keeps its id, which is what
  // every binding holds — so renaming a slot carries its bindings along instead of
  // orphaning them.
  const updateModelSlot = (id: string, patch: Partial<GgModelSlotDraft>) =>
    onPatch({
      modelSlots: agent.modelSlots.map((slot) =>
        slot.id === id ? { ...slot, ...patch } : slot,
      ),
    });
  const addModelSlot = () =>
    onPatch({ modelSlots: [...agent.modelSlots, blankModelSlot()] });
  /**
   * Remove a slot declaration, and unbind whatever named it: this agent's own model
   * binding, and every [`model` param](MODEL_PARAMS) that deferred to it. A binding left
   * holding the id of a declaration that no longer exists is a run gg could never give a
   * model, reported by nothing.
   *
   * Each is emptied rather than switched back to naming a model outright, because
   * "deferred to a slot" is what the operator chose and a removal is not them changing
   * their mind about it. Emptied, the control still reads as deferring and says, in the
   * negative cue, that it now defers to nothing — the same state (and the same complaint)
   * a stored configuration naming an undeclared slot loads into.
   */
  const removeModelSlot = (id: string) => {
    const capabilities = { ...agent.capabilities };
    for (const { capId, slotKey } of MODEL_PARAMS) {
      const cap = capabilities[capId] ?? capabilityDraftFor(capId);
      if (cap.params?.[slotKey] !== id) continue;
      capabilities[capId] = {
        ...cap,
        params: { ...cap.params, [slotKey]: "" },
      };
    }
    onPatch({
      modelSlots: agent.modelSlots.filter((slot) => slot.id !== id),
      capabilities,
      ...(agent.modelSlotId === id ? { modelSlotId: "" } : {}),
    });
  };

  function toggleGroup(group: CapGroup) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // The props every capability body takes, threaded once: which capability it is and how
  // to write to it is all that differs between the three places one is rendered.
  const capabilityFields = (cap: CapSpec) => ({
    cap,
    agent,
    agents: config.agents,
    // A capability's `model` param defers to one of *this agent's* slots, the same as the
    // agent's own binding — the configuration's slots fill those, and are not bound to.
    modelSlots: agent.modelSlots,
    models,
    isRoot,
    readOnly,
    error: paramsErrors[cap.id],
    onUpdateCap: (patch: Partial<GgCapabilityDraft>) =>
      updateCap(cap.id, patch),
    onSetParam: (key: string, param: string) => setParam(cap.id, key, param),
    onClearParam: (key: string) => clearParam(cap.id, key),
    onSetFeature: setFeature,
  });

  // A roster entry exists exactly while it carries at least one scope: turning the
  // last one off removes it, and turning the first one on adds it. There is no
  // separate "listed" toggle, because an entry that is listed but usable for nothing
  // is a state with no meaning gg could act on.
  const toggleSubagentScope = (
    targetId: string,
    scope: GgSubagentScope,
    on: boolean,
  ) => {
    const entry = agent.subagents.find((s) => s.agentId === targetId);
    const scopes = on
      ? [...(entry?.scopes ?? []), scope]
      : (entry?.scopes ?? []).filter((s) => s !== scope);
    const others = agent.subagents.filter((s) => s.agentId !== targetId);
    onPatch({
      subagents: scopes.length
        ? [
            ...others,
            {
              agentId: targetId,
              description: entry?.description ?? "",
              scopes,
            },
          ]
        : others,
    });
  };
  const setSubagentDescription = (targetId: string, description: string) =>
    onPatch({
      subagents: agent.subagents.map((s) =>
        s.agentId === targetId ? { ...s, description } : s,
      ),
    });

  // gg renders one of two built-in system prompts per agent, chosen by its type: the
  // responses-as-code arm teaches the code protocol; the tool-calling arm names the
  // free-standing tools. The editor seeds (and resets to) whichever default this agent
  // will actually run against, so an operator starts from the prompt gg would have used.
  //
  // The code arm is one template for every program language. It names no function, so a
  // call's spelling — the one thing that differs between two languages — is not in it,
  // and what a model cannot discover about its own language is a segment gg gates while
  // rendering. So the agent's program language does not choose a template here, and an
  // operator editing this one is editing what every code agent is held to.
  const defaultPrompt =
    agent.mode === "rac"
      ? DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE
      : DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE;

  // The full system prompt shown in the (collapsed-by-default) editor: this agent's
  // override, or the built-in default for its type. Editing it to exactly that default
  // stores no override.
  const promptValue = agent.systemPromptTemplate || defaultPrompt;
  const promptOverridden = agent.systemPromptTemplate.trim().length > 0;
  const setPrompt = (next: string) =>
    onPatch({ systemPromptTemplate: next === defaultPrompt ? "" : next });

  // What is wrong on each tab, so a fault stays findable from whichever tab is open. A
  // tabbed form hides most of itself; without this, "the `compaction` model names no
  // declared slot" is a complaint about a control three tabs away.
  const capabilityProblems = modeCaps.filter(
    (cap) => paramsErrors[cap.id],
  ).length;
  // Why this profile's slug is unusable, or null. Both faults are the operator's to fix
  // by typing: the shape gg holds a slug to, and the one thing about a slug that cannot be
  // decided by looking at this profile alone — whether another profile already answers to
  // it, which would leave the model shown one name for two profiles and unable to say
  // which of them it meant.
  const slugError = !isValidAgentSlug(agent.slug)
    ? "A slug is lowercase letters and digits in groups separated by single hyphens."
    : config.agents.filter((a) => a.slug === agent.slug).length > 1
      ? "Another agent in this configuration carries this slug, so the model would be shown one name for two profiles."
      : null;
  // A declaration is faulty when it could not be named at launch (nameless, or one of two
  // sharing a name) or when something binds it and nothing would ever fill it: an agent
  // slot reaches the launch form either by being passthrough or by a configuration slot
  // naming it, and one that reaches it neither way leaves its bindings with no model. An
  // *unbound* declaration is not counted — it is dropped on save, which the tab says
  // beside the slot rather than in the strip.
  const slotProblems = agent.modelSlots.filter((slot) => {
    const name = slot.name.trim();
    if (!name) return true;
    if (agent.modelSlots.filter((s) => s.name.trim() === name).length > 1)
      return true;
    if (slot.passthrough || !referencedSlots.has(slot.id)) return false;
    return !config.modelSlots.some((input) =>
      input.targets.some(
        (target) => target.agentId === agent.id && target.slotId === slot.id,
      ),
    );
  }).length;
  const problems: Partial<Record<AgentTab, number>> = {
    agent:
      (agent.name.trim() ? 0 : 1) +
      (slugError ? 1 : 0) +
      (!isMachine && agent.modelSource === "model-slot" && !boundSlot ? 1 : 0) +
      (!isMachine && loopError ? 1 : 0),
    [agent.mode === "rac" ? "apis" : "tools"]: capabilityProblems,
    slots: slotProblems,
    states: paramsErrors[FSM_CAP.id] ? 1 : 0,
  };

  const tabStrip: GgEditorTab<AgentTab>[] = tabs.map((key) => ({
    key,
    label: AGENT_TAB_LABELS[key],
    problems: problems[key] ?? 0,
  }));

  return (
    <>
      <GgEditorTabs
        tabs={tabStrip}
        active={activeTab}
        onChange={setTab}
        ariaLabel="Agent sections"
      />

      {activeTab === "agent" && (
        <>
          {/* Every agent's name is editable, the root's included: the root is a flag on
              the configuration, not a name, and a name is prose — nothing resolves a
              reference by reading one, so renaming is free and two profiles may share one.
              The slug beside it is the name the *model* is shown and passes back, and the
              one a run's telemetry keys on, and it is the operator's to write: it is prose
              the model reads, so "reviewer" or "merge-bot" is worth more than whatever was
              minted from the name the profile was created under. Nothing inside the draft
              points at it — every reference names the profile's internal id — so renaming
              it costs nothing but has to stay unique across the configuration, which is
              why it goes through [renameAgentSlug] rather than a patch. */}
          <div className={gg.agentHeading}>
            <label className={`${runExec.field} ${gg.slotNameField}`}>
              <span className={runExec.fieldLabel}>
                Agent name
                {isRoot && <span className={gg.rootBadge}>root</span>}
              </span>
              <input
                className={runExec.input}
                type="text"
                value={agent.name}
                disabled={readOnly}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder="e.g. reviewer"
              />
            </label>
            <label className={`${runExec.field} ${gg.agentIdField}`}>
              <span className={runExec.fieldLabel}>
                Slug
                <HelpTip text="The name the model is shown and passes back when it spawns, dispatches or transitions to this profile, and the name the run's telemetry, its record and the query language key on afterwards. The model reads it, so it is lowercase letters and digits in groups separated by single hyphens, unique within the configuration, and worth making it say what the profile is for. Nothing in the configuration points at it, so renaming it here changes this one name and nothing else." />
              </span>
              <input
                className={runExec.input}
                type="text"
                value={agent.slug}
                disabled={readOnly}
                onChange={(e) => onRenameSlug(e.target.value)}
                placeholder="e.g. reviewer"
                spellCheck={false}
              />
            </label>
          </div>
          {slugError && <p className={gg.fieldError}>{slugError}</p>}

          {/* The library entry's one-line purpose, where the entry is what is being
              edited. It sits under the name and slug it describes, on the same tab: it is
              part of the agent's identity, not chrome above the form. */}
          {onDescriptionChange && (
            <label className={`${runExec.field} ${gg.agentDescriptionField}`}>
              <span className={runExec.fieldLabel}>Description (optional)</span>
              <input
                className={runExec.input}
                type="text"
                value={description ?? ""}
                disabled={readOnly}
                placeholder="what this agent is for"
                onChange={(e) => onDescriptionChange(e.target.value)}
              />
            </label>
          )}

          {/* Agent type — how this agent is implemented, and so what the rest of this
              editor even offers. Above everything conditional, because it is the choice
              the other sections are a consequence of rather than one of them. */}
          <section className={gg.modeWidget}>
            <p className={runExec.sectionLabel}>
              Agent type
              <HelpTip text={AGENT_MODE_HINT} />
            </p>
            <SegmentedControl
              options={AGENT_MODE_OPTIONS}
              value={agent.mode}
              onChange={setMode}
              ariaLabel="Agent type"
              disabled={readOnly}
            />
            {modeSpec && <p className={gg.modePurpose}>{modeSpec.purpose}</p>}
          </section>

          {/* Everything below is a worker's. A machine takes no turns, so it runs no
              model, keeps no cache, has no reply to watch for a loop and renders no
              prompt: a control for a value gg would never read is worse than no control,
              because it invites configuring a run that does not exist. */}
          {!isMachine && (
            <>
              <div className={gg.slotFields}>
                <label className={`${runExec.field} ${gg.slotSourceField}`}>
                  <span className={runExec.fieldLabel}>Model from</span>
                  <select
                    className={runExec.select}
                    value={agent.modelSource}
                    disabled={readOnly}
                    onChange={(e) =>
                      onPatch({
                        modelSource: e.target
                          .value as GgAgentDraft["modelSource"],
                      })
                    }
                  >
                    <option value="model-slot">a model slot (at launch)</option>
                    <option value="model">a specific model (fixed here)</option>
                  </select>
                </label>
                {agent.modelSource === "model-slot" ? (
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>Model slot</span>
                    <select
                      className={runExec.select}
                      value={agent.modelSlotId}
                      disabled={readOnly}
                      onChange={(e) => onPatch({ modelSlotId: e.target.value })}
                    >
                      {/* The offered slots are the ones this agent declares, by id — a
                          slot the operator renamed keeps its binding, and one they
                          deleted leaves the agent on "(none)" rather than on a name
                          nothing answers to. */}
                      {!boundSlot && (
                        <option value={agent.modelSlotId}>(none)</option>
                      )}
                      {agent.modelSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.name.trim() || "(unnamed slot)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>Model</span>
                    <ModelCombobox
                      value={agent.modelId}
                      onChange={(v) => onPatch({ modelId: v })}
                      models={models}
                      harnessFamily={GG_MODEL_FAMILY}
                      inputClassName={runExec.input}
                      disabled={readOnly}
                      placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                    />
                  </label>
                )}
                <label className={`${runExec.field} ${gg.cacheTtlField}`}>
                  <FieldLabel
                    label="Prompt cache"
                    hint="How long this agent asks the provider to keep its stable cache entries: its opening context and the cached points a later turn reads. The one-hour lifetime is charged a higher write premium (on Anthropic, 2× the input rate against 5 minutes' 1.25×), and is only read back by an agent whose turns are long enough, or spread far enough apart, that five minutes would have expired before the next one."
                  />
                  <select
                    className={runExec.select}
                    value={agent.promptCacheTtl}
                    disabled={readOnly}
                    onChange={(e) =>
                      onPatch({
                        promptCacheTtl: e.target
                          .value as GgAgentDraft["promptCacheTtl"],
                      })
                    }
                  >
                    <option value="standard">5 minutes</option>
                    <option value="extended">1 hour (costs more)</option>
                  </select>
                </label>
              </div>
              {agent.modelSource === "model-slot" && !boundSlot && (
                <p className={gg.fieldError}>
                  This agent defers to no model slot, so a run could never give
                  it a model. Pick one of the slots it declares, or pin it a
                  model.
                </p>
              )}
              {agent.promptCacheTtl === "extended" && (
                <p className={gg.cacheTtlNote}>
                  Worth it for an agent that delegates, or whose turns run
                  builds and test suites; wasted on one that answers quickly and
                  is never resumed.
                </p>
              )}

              {/* Two things gg does *around* this agent, rather than anything the agent
                  may do: watch its reply arrive, and write down what happened. Neither
                  belongs on the Tools or APIs tab, which answers "what is this agent
                  offered?" — nothing here is offered to the model, and the model is told
                  about none of it. They are nonetheless authored exactly like a
                  capability — a switch, a purpose, and a body revealed once it is on —
                  because that is the shape an operator already knows for "a thing gg does
                  that you turn on". */}
              <div className={gg.capList}>
                <div
                  className={`${gg.capRow}${
                    agent.loopDetection.enabled ? "" : ` ${gg.capOff}`
                  }`}
                >
                  <label className={gg.capHeader}>
                    <Switch
                      checked={agent.loopDetection.enabled}
                      disabled={readOnly}
                      onChange={setLoopEnabled}
                    />
                    <span className={gg.capName}>Loop detection</span>
                    <HelpTip text={LOOP_DETECTION_HINT} />
                  </label>
                  <p className={gg.capPurpose}>
                    Abandon and retry a reply that has degenerated into
                    repetition, instead of paying for it to the model&rsquo;s
                    output cap. Arming it moves this agent onto gg&rsquo;s
                    streaming transport.
                  </p>
                  {/* The knobs are shown only while the detector is armed — a disarmed
                      agent's are still recorded and still come back, but a grid of
                      numbers nothing will read invites tuning a detector that is not
                      running. */}
                  {agent.loopDetection.enabled && (
                    <div className={gg.capBody}>
                      <div className={gg.capParamGrid}>
                        {LOOP_DETECTION_SPECS.map((spec) => (
                          <CapField
                            key={spec.key}
                            label={spec.label}
                            hint={spec.hint}
                            modified={
                              !readOnly &&
                              agent.loopDetection.knobs[spec.key] !==
                                String(spec.authored)
                            }
                            onReset={() =>
                              setLoopKnob(spec.key, String(spec.authored))
                            }
                          >
                            {(id) => (
                              <input
                                id={id}
                                className={runExec.input}
                                type="number"
                                min={0}
                                step={1}
                                value={agent.loopDetection.knobs[spec.key]}
                                disabled={readOnly}
                                onChange={(e) =>
                                  setLoopKnob(spec.key, e.target.value)
                                }
                                // The figure the knob was armed with, so a field an
                                // operator has cleared still shows what putting it back
                                // would mean. Bare, because a placeholder is already read
                                // as "what goes here" and prefixing it doubled the width
                                // of every one of these fields.
                                placeholder={spec.authored.toLocaleString(
                                  "en-US",
                                )}
                              />
                            )}
                          </CapField>
                        ))}
                      </div>
                      {loopError ? (
                        <p className={gg.fieldError}>{loopError}</p>
                      ) : (
                        loopWarning && (
                          <p className={gg.limitWarning}>{loopWarning}</p>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Custom instructions — the field an operator edits normally; inserted
                  into the system prompt. */}
              <p
                className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
              >
                Custom instructions
              </p>
              <textarea
                className={gg.textarea}
                value={agent.customInstructions}
                disabled={readOnly}
                onChange={(e) =>
                  onPatch({ customInstructions: e.target.value })
                }
                placeholder="Extra instructions for this agent, inserted into its system prompt."
                rows={4}
              />

              {/* System prompt — the full Handlebars template, collapsed by default.
                  Editing it is the escape hatch; most operators only touch Custom
                  instructions. */}
              <div className={gg.group}>
                <button
                  type="button"
                  className={gg.groupHeader}
                  onClick={() => setPromptOpen((v) => !v)}
                  aria-expanded={promptOpen}
                >
                  <span className={gg.groupToggle}>
                    {promptOpen ? "▾" : "▸"}
                  </span>
                  <span className={gg.groupName}>System Prompt</span>
                  <span className={gg.groupCount}>
                    {promptOverridden ? "overridden" : "default"}
                  </span>
                </button>
                {promptOpen && (
                  <div className={gg.capList}>
                    <p className={`${runExec.muted}`}>
                      The full template gg renders for this agent. Custom
                      instructions are inserted at the{" "}
                      <code>{"{{customInstructions}}"}</code> block near the
                      top. Edit here only to rewrite the whole prompt; leaving
                      it equal to the default stores no override.
                    </p>
                    <textarea
                      className={`${gg.textarea} ${gg.promptTextarea}`}
                      value={promptValue}
                      disabled={readOnly}
                      onChange={(e) => setPrompt(e.target.value)}
                      spellCheck={false}
                      rows={20}
                    />
                    {!readOnly && promptOverridden && (
                      <button
                        type="button"
                        className={runExec.secondary}
                        onClick={() => setPrompt(defaultPrompt)}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Tools / APIs — the same capability catalog, named for the shape this agent's
          type meets it in. The tab strip already names the section, so the groups are the
          whole of it. The RaC arm leads with the sandbox's own settings, which are the
          type's configuration rather than a capability of it — panelled, and left
          unheaded for the same reason: the tab it can only appear on is called APIs. */}
      {(activeTab === "tools" || activeTab === "apis") && (
        <>
          {activeTab === "apis" && (
            <div
              className={gg.modePanel}
              role="group"
              aria-label="Responses as code"
            >
              <CapabilityBody {...capabilityFields(RESPONSES_AS_CODE_CAP)} />
            </div>
          )}

          {CAP_GROUPS.map(({ group }) => {
            const groupCaps = modeCaps.filter((c) => c.group === group);
            // A group every capability of which belongs to another type is not an empty
            // box to open, it is not a group of this agent's at all.
            if (!groupCaps.length) return null;
            const isCollapsed = collapsed.has(group);
            const onCount = groupCaps.filter(
              (c) => agent.capabilities[c.id]?.enabled,
            ).length;
            return (
              <div key={group} className={gg.group}>
                <button
                  type="button"
                  className={gg.groupHeader}
                  onClick={() => toggleGroup(group)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={gg.groupToggle}>
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className={gg.groupName}>{group}</span>
                  <span className={gg.groupCount}>
                    {onCount}/{groupCaps.length} on
                  </span>
                </button>
                {!isCollapsed && (
                  <div className={gg.capList}>
                    {groupCaps.map((cap) => {
                      const enabled = Boolean(
                        agent.capabilities[cap.id]?.enabled,
                      );
                      return (
                        <div
                          key={cap.id}
                          className={`${gg.capRow}${enabled ? "" : ` ${gg.capOff}`}`}
                        >
                          <label className={gg.capHeader}>
                            <Switch
                              checked={enabled}
                              disabled={readOnly}
                              onChange={(next) =>
                                setCapabilityEnabled(cap, next)
                              }
                            />
                            <span className={gg.capName}>{cap.name}</span>
                            <span className={gg.capId}>{cap.id}</span>
                          </label>
                          <p className={gg.capPurpose}>{cap.purpose}</p>
                          {enabled && (
                            <CapabilityBody {...capabilityFields(cap)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Opening turn — what gg puts in front of a code agent's first turn. Per module
          rather than per capability, because the lists gg reads are written in gg's own
          grouping (a module and its functions), and two capabilities may sell one module's
          functions. A module none of whose functions this agent holds is shown but cannot
          be listed: gg would drop it at seed time, and a switch that promised otherwise
          would be a control for a value the run never reads. */}
      {activeTab === "opening" && (
        <section className={gg.rosterWidget}>
          <p className={runExec.sectionLabel}>
            Opening turn
            <HelpTip text="Before this agent's first turn, gg writes and runs one program of its own: a documentation search naming every listed module, which leaves the module's brief and function list in the window, and then a documentation view opened per listed function, which puts its full signature there. Listing a module and opening a function's documentation are independent. A function's documentation can be opened without its module being listed, and a listed module opens no function on its own. Leaving both lists empty seeds no program at all." />
            {/* One reset for the tab as a whole: the two lists are one setting, seeded to
                the same default a fresh agent gets, and the control shows itself exactly
                while they have moved off it. Sat beside the section label rather than in a
                wrapping label, so it labels nothing but itself. */}
            {!readOnly && !openingTurnIsDefault(agent.openingTurn) && (
              <ResetControl
                label="Opening turn"
                onReset={() => onPatch({ openingTurn: defaultOpeningTurn() })}
              />
            )}
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            What this agent&rsquo;s window opens with. Listing a module puts its
            brief and the list of its functions in the window; opening a
            function&rsquo;s documentation puts its full signature there. The
            two are independent, and only what this agent holds can be listed or
            opened. The rest is dropped when the agent is saved.
          </p>
          <div className={gg.capList}>
            {/* The workspace tree, above the modules: it is the program's first statement
                and the only entry that is not a module or one of a module's functions. */}
            <div
              className={`${gg.capRow}${
                agent.openingTurn.tree.include && treeHeld ? "" : ` ${gg.capOff}`
              }`}
              role="group"
              aria-label="Workspace tree"
            >
              <label className={gg.capHeader}>
                <Switch
                  checked={agent.openingTurn.tree.include}
                  disabled={readOnly || !treeHeld}
                  onChange={(next) => setOpeningTree({ include: next })}
                />
                <span className={gg.capName}>Workspace tree</span>
                <span className={gg.capId}>{OPENING_TREE_OPERATION}</span>
              </label>
              <p className={gg.capPurpose}>
                Opens the window on the shape of the workspace, so the first turn
                does not spend itself guessing at paths. Ignored directories are
                left out.
              </p>
              {!treeHeld ? (
                <p className={gg.capPurpose}>
                  This agent does not hold {OPENING_TREE_OPERATION}, so no tree
                  can be opened.
                </p>
              ) : (
                <div className={gg.capBody}>
                  <div className={gg.capParamGrid}>
                    <CapField
                      label="Depth"
                      hint={`How many levels of children below the workspace root the tree renders. 1 is the root's own entries. gg walks at most ${MAX_OPENING_TREE_DEPTH}.`}
                      modified={
                        !readOnly &&
                        agent.openingTurn.tree.depth !==
                          DEFAULT_OPENING_TURN.tree.depth
                      }
                      onReset={() =>
                        setOpeningTree({
                          depth: DEFAULT_OPENING_TURN.tree.depth,
                        })
                      }
                    >
                      {(id) => (
                        <input
                          id={id}
                          className={runExec.input}
                          type="number"
                          min={1}
                          max={MAX_OPENING_TREE_DEPTH}
                          step={1}
                          value={agent.openingTurn.tree.depth}
                          disabled={readOnly}
                          onChange={(e) =>
                            setOpeningTree({
                              depth: clampTreeDepth(e.target.value),
                            })
                          }
                        />
                      )}
                    </CapField>
                  </div>
                </div>
              )}
            </div>
            {GG_MODULES.map((module) => {
              const held = moduleHeld(agent, module.id);
              const listed = agent.openingTurn.modules.includes(module.id);
              // The rows: every function of this module the agent holds, in catalog
              // order. A function it does not hold has no row at all rather than a
              // disabled one — the capability that would sell it is a tab away, and a
              // greyed checkbox says less than its absence does.
              const functions = openingTurnFunctions().filter(
                (fn) => fn.module === module.id && operationHeld(agent, fn.id),
              );
              return (
                <div
                  key={module.id}
                  className={`${gg.capRow}${listed && held ? "" : ` ${gg.capOff}`}`}
                  role="group"
                  aria-label={`${module.name} module`}
                >
                  <label className={gg.capHeader}>
                    <Switch
                      checked={listed}
                      disabled={readOnly || !held}
                      onChange={(next) =>
                        setOpeningEntry("modules", module.id, next)
                      }
                    />
                    <span className={gg.capName}>{module.name}</span>
                    <span className={gg.capId}>{module.id}</span>
                    <span className={gg.capId}>List module</span>
                  </label>
                  <p className={gg.capPurpose}>{module.purpose}</p>
                  {!held ? (
                    <p className={gg.capPurpose}>
                      No capability from this module is enabled, so it cannot be
                      listed.
                    </p>
                  ) : (
                    <div className={gg.capBody}>
                      {functions.map((fn) => (
                        <label key={fn.id} className={gg.featureLabel}>
                          <input
                            type="checkbox"
                            checked={agent.openingTurn.functions.includes(
                              fn.id,
                            )}
                            disabled={readOnly}
                            onChange={(e) =>
                              setOpeningEntry(
                                "functions",
                                fn.id,
                                e.target.checked,
                              )
                            }
                          />
                          <span className={gg.featureName}>{fn.id}</span>
                          <span className={gg.capId}>
                            Open documentation ·{" "}
                            {fn.offeredBy
                              ? `offered by ${fn.offeredBy.name}`
                              : "always available"}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Slots — the launch-time model parameters this agent's own bindings defer to.
          They belong to the agent rather than to the configuration around it, so a profile
          imported from the library brings the slots its bindings name with it, and the
          configuration decides how each one reaches the launch form. The tab strip already
          names the section, so the list is the whole of it bar the one line that says what
          a slot here is for. */}
      {activeTab === "slots" && (
        <div className={gg.slotList}>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            The models this agent is handed at launch. Its own binding, and
            every capability that picks a model of its own, defers to one of
            these, which is what lets one saved agent be run against a different
            model each time instead of baking one in.
          </p>
          {agent.modelSlots.map((slot) => {
            // What will put a model in this slot when the run starts. A passthrough slot
            // is asked for on its own; otherwise one of the configuration's own launch
            // inputs has to name it, and a slot neither of those reach is a binding with
            // nowhere to get a model from.
            const mapped = config.modelSlots.some((input) =>
              input.targets.some(
                (target) =>
                  target.agentId === agent.id && target.slotId === slot.id,
              ),
            );
            const bound = referencedSlots.has(slot.id);
            return (
              <div key={slot.id} className={gg.slotBlock}>
                <div className={gg.slotFields}>
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Slot name</span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={slot.name}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateModelSlot(slot.id, { name: e.target.value })
                      }
                      placeholder="e.g. primary"
                    />
                  </label>
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>
                      Default model (optional)
                    </span>
                    <ModelCombobox
                      value={slot.defaultModelId}
                      onChange={(v) =>
                        updateModelSlot(slot.id, { defaultModelId: v })
                      }
                      models={models}
                      harnessFamily={GG_MODEL_FAMILY}
                      inputClassName={runExec.input}
                      disabled={readOnly}
                      placeholder="left to the launcher"
                    />
                  </label>
                  <label className={gg.featureLabel}>
                    <input
                      type="checkbox"
                      checked={slot.passthrough}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateModelSlot(slot.id, {
                          passthrough: e.target.checked,
                        })
                      }
                    />
                    <span className={gg.featureName}>Passthrough</span>
                    <HelpTip
                      text={`A passthrough slot is asked for at launch on its own, under \`${agent.slug || "<slug>"}.${slot.name.trim() || "<slot name>"}\`, so this agent's model is chosen separately from every other agent's. A slot that is not passthrough is filled by one of the configuration's own slots naming it, which is how several agents are run off one launch input. A slot reaches the launch form one way or the other, and never both.`}
                    />
                  </label>
                  {!readOnly && (
                    <button
                      type="button"
                      className={gg.slotRemove}
                      onClick={() => removeModelSlot(slot.id)}
                      aria-label={`Remove the ${slot.name || "unnamed"} model slot`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {!bound ? (
                  <p className={gg.fieldError}>
                    This agent binds nothing to this slot, so it is dropped when
                    the agent is saved.
                  </p>
                ) : (
                  !slot.passthrough &&
                  !mapped && (
                    <p className={gg.limitWarning}>
                      Nothing fills this slot: mark it passthrough to have the
                      launch form ask for it on its own, or map one of the
                      configuration&rsquo;s slots onto it.
                    </p>
                  )
                )}
              </div>
            );
          })}
          {agent.modelSlots.length === 0 && (
            <p className={`${runExec.muted} ${gg.backdropNote}`}>
              No model slots. This agent must then pin its own model, fixed here
              for every run of it, rather than being handed one at launch.
            </p>
          )}
          {!readOnly && (
            <button
              type="button"
              className={runExec.secondary}
              onClick={addModelSlot}
            >
              + Add model slot
            </button>
          )}
        </div>
      )}

      {/* Roster — which other agents this one may put to work, and for what. An agent
          may list itself, for recursion. */}
      {activeTab === "roster" && (
        <section className={gg.rosterWidget}>
          <p className={runExec.sectionLabel}>Roster</p>
          <p className={runExec.muted}>
            The agents this one may put to work, and what for:{" "}
            <strong>Subagent</strong> (spawnable with{" "}
            <code>spawn_subagent</code>), <strong>Implementer</strong>{" "}
            (assignable as an issue&rsquo;s agent), and{" "}
            <strong>Reviewer</strong> (namable among an issue&rsquo;s
            reviewers). The three are independent. Describe when to use a
            target; the description is what this agent sees.
          </p>
          <div className={gg.subagentList}>
            {config.agents.map((target) => {
              const entry = agent.subagents.find(
                (s) => s.agentId === target.id,
              );
              const on = Boolean(entry);
              return (
                <div key={target.id} className={gg.subagentRow}>
                  {/* Named and identified: the name is what this row reads as, the slug is
                      what this agent's roster offers the model — and two profiles may carry
                      one name, which would otherwise be two rows nothing could tell apart.
                      The entry itself stores neither; it points at the target's internal
                      id, which is shown to nobody. */}
                  <span className={gg.featureName}>
                    {target.name || "unnamed"}
                    <span className={gg.capId}> {target.slug}</span>
                    {target.id === agent.id && (
                      <span className={gg.capId}> (self)</span>
                    )}
                  </span>
                  <span className={gg.subagentScopes}>
                    {SUBAGENT_SCOPES.map((scope) => (
                      <label
                        key={scope.value}
                        className={gg.featureLabel}
                        title={scope.hint}
                      >
                        <Switch
                          checked={Boolean(entry?.scopes.includes(scope.value))}
                          disabled={readOnly}
                          onChange={(next) =>
                            toggleSubagentScope(target.id, scope.value, next)
                          }
                        />
                        <span className={gg.capId}>{scope.label}</span>
                      </label>
                    ))}
                  </span>
                  {on && (
                    <input
                      className={`${runExec.input} ${gg.subagentDescription}`}
                      type="text"
                      value={entry?.description ?? ""}
                      disabled={readOnly}
                      onChange={(e) =>
                        setSubagentDescription(target.id, e.target.value)
                      }
                      placeholder="when to use this agent"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Hooks — the gates this agent is held to. Per agent because the agents of a run
          are not interchangeable: "the build must pass before you may stop" is right for
          an implementer, pointless for a planner, and wrong for a reviewer whose job is
          to report that the build does not pass. The run's own two ends are not here —
          they belong to the configuration, and fire once per run. */}
      {activeTab === "hooks" && (
        <section className={gg.rosterWidget}>
          <p className={runExec.sectionLabel}>
            Hooks
            <HelpTip text="Commands and scripts gg runs around what this agent does: a file write, a shell command, a compaction, and its own start and stop. A hook can stop the operation it precedes and put text in front of the model. The model is never told a hook exists, is offered no tool for one, and cannot decline one." />
          </p>
          <GgHookList
            hooks={agent.hooks}
            scope="agent"
            readOnly={readOnly}
            onChange={(hooks: GgHookDraft[]) => onPatch({ hooks })}
            emptyNote="No hooks."
          />
        </section>
      )}

      {/* The machine itself — the whole configuration of an FSM agent. */}
      {activeTab === "states" && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            States
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            {FSM_CAP.purpose} A machine has no turns of its own, which is why it
            is asked for no model, no prompt and no roster: each state runs the
            profile it names, with that profile&rsquo;s configuration.
          </p>
          {/* Labelled "state machine" rather than "states": the capability's own body
              already contains a group of that name (the state rows), and two groups an
              assistive technology cannot tell apart is worse than a heading that reads
              slightly differently from its tab. */}
          <div className={gg.modePanel} role="group" aria-label="State machine">
            <CapabilityBody {...capabilityFields(FSM_CAP)} />
          </div>
        </>
      )}
    </>
  );
}
