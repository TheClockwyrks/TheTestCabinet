import { useState } from "react";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
} from "@test-cabinet/run-record/gg-system-prompt";
import type { GgSubagentScope } from "@test-cabinet/run-record/gg";
import { SegmentedControl } from "@test-cabinet/ui";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  AGENT_MODES,
  AGENT_MODE_HINT,
  CAP_GROUPS,
  FSM_CAP,
  LOOP_DETECTION_HINT,
  LOOP_DETECTION_SPECS,
  RESPONSES_AS_CODE_CAP,
  SUBAGENT_SCOPES,
  capabilitiesForMode,
  type CapGroup,
  type CapSpec,
  type GgAgentMode,
  type LoopDetectionSpec,
} from "./ggCatalog";
import {
  CapabilityBody,
  FieldLabel,
  HelpTip,
  Switch,
} from "./GgCapabilityFields";
import { GgEditorTabs, type GgEditorTab } from "./GgEditorTabs";
import { GgHookList } from "./GgHookRows";
import {
  agentParamErrors,
  blankCapabilityDraft,
  loopDetectionError,
  loopDetectionWarning,
  setFeatureBundle,
  withCapabilityGrants,
  type GgAgentDraft,
  type GgCapabilityDraft,
  type GgConfigDraft,
  type GgHookDraft,
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

/** The per-agent editor's sections. */
type AgentTab = "agent" | "tools" | "apis" | "roster" | "hooks" | "states";

/**
 * Which sections an agent of this type has, in display order.
 *
 * The tab set is a function of the agent's **type** and nothing else, because the type is
 * what decides which of these things gg will read. A machine takes no turns, so it has no
 * tools, no APIs, nobody to spawn and no lifecycle of its own to hook — it has states,
 * which no other type has. Tools and RaC are the same capabilities offered two ways, so
 * each gets the tab named for the shape it actually meets them in.
 *
 * Absent rather than disabled: an empty section for a value gg would never read invites
 * configuring a run that does not exist.
 */
function tabsForMode(mode: GgAgentMode): ReadonlyArray<AgentTab> {
  if (mode === "fsm") return ["agent", "states"];
  return ["agent", mode === "rac" ? "apis" : "tools", "roster", "hooks"];
}

const AGENT_TAB_LABELS: Record<AgentTab, string> = {
  agent: "Agent",
  tools: "Tools",
  apis: "APIs",
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
  /** The model catalog backing the pickers (free text is still allowed). */
  models: Model[];
  readOnly: boolean;
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
  models,
  readOnly,
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
  const boundSlot = config.modelSlots.find((s) => s.id === agent.modelSlotId);
  const modeSpec = AGENT_MODES.find((m) => m.value === agent.mode);
  // The capabilities this agent's type reads — empty for a machine, which is why it has
  // no Tools or APIs tab at all.
  const modeCaps = capabilitiesForMode(agent.mode);

  const updateCap = (id: string, patch: Partial<GgCapabilityDraft>) =>
    onPatch({
      capabilities: {
        ...agent.capabilities,
        [id]: {
          ...(agent.capabilities[id] ?? blankCapabilityDraft()),
          ...patch,
        },
      },
    });
  const setParam = (id: string, key: string, param: string) => {
    const base = agent.capabilities[id] ?? blankCapabilityDraft();
    updateCap(id, { params: { ...(base.params ?? {}), [key]: param } });
  };
  // Drop a param key entirely, which is a different state from setting it empty: a
  // `model` param defers to a slot exactly while its slot key is *present*, so "pin a
  // model instead" has to remove the key rather than blank it.
  const clearParam = (id: string, key: string) => {
    const base = agent.capabilities[id] ?? blankCapabilityDraft();
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
          ...(agent.capabilities[cap.id] ?? blankCapabilityDraft()),
          enabled,
        },
      },
      ...withCapabilityGrants(agent, cap, enabled),
    });
  const setFeature = (
    bundle: { tools: ReadonlyArray<string>; operations: ReadonlyArray<string> },
    on: boolean,
  ) => onPatch(setFeatureBundle(agent, bundle, on));
  // Loop detection's switch and its knobs, written separately: the knobs survive the
  // switch going off, so an operator who tunes the detector and then disarms it finds
  // their settings still there when they arm it again.
  const setLoopEnabled = (enabled: boolean) =>
    onPatch({ loopDetection: { ...agent.loopDetection, enabled } });
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
    modelSlots: config.modelSlots,
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
  const problems: Partial<Record<AgentTab, number>> = {
    agent:
      (agent.name.trim() ? 0 : 1) +
      (!isMachine && agent.modelSource === "model-slot" && !boundSlot ? 1 : 0) +
      (!isMachine && loopError ? 1 : 0),
    [agent.mode === "rac" ? "apis" : "tools"]: capabilityProblems,
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
              the configuration, not a name, and renaming one here carries every reference
              to it (rosters, the merge agent) along. */}
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
          </div>

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
                      {/* The offered slots are the ones this configuration declares, by
                          id — a slot the operator renamed keeps its binding, and one they
                          deleted leaves the agent on "(none)" rather than on a name
                          nothing answers to. */}
                      {!boundSlot && (
                        <option value={agent.modelSlotId}>(none)</option>
                      )}
                      {config.modelSlots.map((slot) => (
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
                    hint="How long this agent asks the provider to keep its stable cache entries — its opening context and the cached points a later turn reads. The one-hour lifetime is charged a higher write premium (on Anthropic, 2× the input rate against 5 minutes' 1.25×), and is only read back by an agent whose turns are long enough, or spread far enough apart, that five minutes would have expired before the next one."
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
                    <option value="standard">
                      5 minutes (provider default)
                    </option>
                    <option value="extended">
                      1 hour (extended, costs more)
                    </option>
                  </select>
                </label>
              </div>
              {agent.modelSource === "model-slot" && !boundSlot && (
                <p className={gg.fieldError}>
                  This agent defers to no model slot, so a run could never give
                  it a model. Pick one of the configuration&rsquo;s slots, or
                  pin it a model.
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
                          <label key={spec.key} className={gg.capParamField}>
                            <FieldLabel label={spec.label} hint={spec.hint} />
                            <input
                              className={runExec.input}
                              type="number"
                              min={0}
                              step={1}
                              value={agent.loopDetection.knobs[spec.key]}
                              disabled={readOnly}
                              onChange={(e) =>
                                setLoopKnob(spec.key, e.target.value)
                              }
                              // The bare figure. A placeholder is already read as
                              // "what you get if you leave this empty", and prefixing
                              // it doubled the width of every one of these fields to
                              // say so five times over; each knob's hint says it in
                              // words for anyone who wants it spelled out.
                              placeholder={spec.ggDefault.toLocaleString(
                                "en-US",
                              )}
                            />
                          </label>
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
            reviewers). The three are independent. Describe when to use a target
            — the description is what this agent sees.
          </p>
          <div className={gg.subagentList}>
            {config.agents.map((target) => {
              const entry = agent.subagents.find(
                (s) => s.agentId === target.id,
              );
              const on = Boolean(entry);
              return (
                <div key={target.id} className={gg.subagentRow}>
                  <span className={gg.featureName}>
                    {target.name || "unnamed"}
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
            <HelpTip text="Commands and scripts gg runs around what this agent does — a file write, a shell command, a compaction, and its own start and stop. A hook can stop the operation it precedes and put text in front of the model. The model is never told a hook exists, is offered no tool for one, and cannot decline one." />
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
