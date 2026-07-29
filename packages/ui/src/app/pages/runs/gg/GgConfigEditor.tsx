import { useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
} from "@test-cabinet/run-record/gg-system-prompt";
import type { GgSubagentScope } from "@test-cabinet/run-record/gg";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  CAPABILITIES,
  CAP_GROUPS,
  RUN_LIMIT_SPECS,
  SUBAGENT_SCOPES,
  lockedImplementation,
  paramApplies,
  type CapGroup,
  type RunLimitSpec,
} from "./ggCatalog";
import {
  agentParamErrors,
  blankAgentDraft,
  blankCapabilityDraft,
  blankCommandDraft,
  blankModelSlot,
  commandsDraftValue,
  commandsFromDraft,
  dropAgentReferences,
  referencedModelSlots,
  runLimitsError,
  runLimitsWarning,
  seedAgentParams,
  setToolBundle,
  togglesDraftValue,
  togglesOff,
  toolBundleOn,
  unusedAgentName,
  type CommandDraft,
  type GgAgentDraft,
  type GgCapabilityDraft,
  type GgConfigDraft,
  type GgModelSlotDraft,
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
  if (kind === "count") return 1;
  return kind === "fraction" ? 0.05 : "any";
}

// A "?" affordance whose help text appears in a custom on-hover/focus tooltip.
function HelpTip({ text }: { text: string }) {
  return (
    <span
      className={gg.help}
      data-tooltip={text}
      tabIndex={0}
      aria-label={text}
    >
      ?
    </span>
  );
}

// A field label with an optional help tooltip beside it.
function FieldLabel({ label, hint }: { label: ReactNode; hint?: string }) {
  return (
    <span className={runExec.fieldLabel}>
      {label}
      {hint && <HelpTip text={hint} />}
    </span>
  );
}

// The capability enable control: a slider switch that stays a real checkbox to AT and
// to the test suite.
function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <span className={gg.switch}>
      <input
        className={gg.switchInput}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={gg.switchTrack} aria-hidden="true" />
    </span>
  );
}

interface GgConfigEditorProps {
  /** The configuration being edited. */
  value: GgConfigDraft;
  /** Called with the whole next draft on every edit. */
  onChange: (next: GgConfigDraft) => void;
  /**
   * The [id](GgAgentDraft.id) of the agent whose per-agent view is open, or `null` for
   * the top-level configuration form. Owned by the page rather than here, because which
   * view is open decides what the page shows around the editor: its identity fields and
   * Save configuration belong to the configuration, and Cancel / Save agent to an agent.
   */
  editingAgentId: string | null;
  /** Open an agent's view (or return to the configuration with `null`). */
  onEditingAgentChange: (agentId: string | null) => void;
  /** The model catalog backing the per-agent pickers (free text is still allowed). */
  models: Model[];
  /**
   * Render every control disabled — how a built-in configuration is shown, since
   * those are shared and read-only (duplicate one to make it yours).
   */
  readOnly?: boolean;
}

// The gg capability-set editor. Its top level is the run's execution ceilings, the
// declared launch-time model slots, and the list of **agent profiles**; opening an
// agent switches to a per-agent view (its capabilities, model, custom prompt, and the
// agents it may spawn). Capabilities are per agent now — there is no run-global
// capability list — so an ablation can vary what each agent in a run can do, and give
// different agents different models or even different execution modes.
//
// Which profile is the **root** — the one that drives the run's top-level session — is a
// flag on the draft, so it can be renamed to anything and moved to another profile;
// nothing here decides it by looking for a particular name.
//
// This is the one authoring surface for a gg configuration. It is deliberately *not* a
// launcher: a configuration carries no test case, and the models it does not pin
// outright are declared as *model slots* the new-run form asks for at launch.
export function GgConfigEditor({
  value,
  onChange,
  editingAgentId,
  onEditingAgentChange,
  models,
  readOnly = false,
}: GgConfigEditorProps) {
  // Which capability groups are collapsed in the per-agent view.
  const [collapsed, setCollapsed] = useState<Set<CapGroup>>(
    () => new Set(CAP_GROUPS.filter((g) => !g.startOpen).map((g) => g.group)),
  );
  // Whether the (collapsed-by-default) full system-prompt template is expanded.
  const [promptOpen, setPromptOpen] = useState(false);

  // A guard against a stale id (the open agent was removed out from under the view):
  // fall back to the top-level form rather than rendering nothing at all.
  const openAgentExists = value.agents.some((a) => a.id === editingAgentId);
  useEffect(() => {
    if (editingAgentId !== null && !openAgentExists) onEditingAgentChange(null);
  }, [editingAgentId, openAgentExists, onEditingAgentChange]);

  function toggleGroup(group: CapGroup) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // --- Agent mutators -------------------------------------------------------
  function updateAgent(agentId: string, patch: Partial<GgAgentDraft>) {
    onChange({
      ...value,
      agents: value.agents.map((a) =>
        a.id === agentId ? { ...a, ...patch } : a,
      ),
    });
  }
  function addAgent() {
    // A unique default name so the added agent is immediately valid, bound to the first
    // declared slot (there is nothing else for it to defer to), and with its run-level
    // agent params pointed at the root.
    const added = blankAgentDraft(
      unusedAgentName(value.agents),
      [],
      {},
      value.modelSlots[0]?.id ?? "",
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

  // --- Model-slot (launch parameter) mutators -------------------------------
  //
  // An agent binds a slot by its internal id, so renaming a declaration carries every
  // agent bound to it along with no fixing up here.
  function updateModelSlot(slotId: string, patch: Partial<GgModelSlotDraft>) {
    onChange({
      ...value,
      modelSlots: value.modelSlots.map((s) =>
        s.id === slotId ? { ...s, ...patch } : s,
      ),
    });
  }
  function addModelSlot() {
    onChange({ ...value, modelSlots: [...value.modelSlots, blankModelSlot()] });
  }
  function removeModelSlot(slotId: string) {
    // An agent that deferred to the removed slot is left deferring to nothing rather
    // than silently re-pointed at another one: which model it should run on is the
    // operator's call, and the save gate names the agent until they make it.
    onChange({
      ...value,
      modelSlots: value.modelSlots.filter((s) => s.id !== slotId),
      agents: value.agents.map((a) =>
        a.modelSlotId === slotId ? { ...a, modelSlotId: "" } : a,
      ),
    });
  }

  const limitsError = runLimitsError(value.limits);
  const limitsWarning = runLimitsWarning(value.limits);

  // --- Top-level view -------------------------------------------------------
  function setLimit(key: RunLimitSpec["key"], limit: string) {
    onChange({ ...value, limits: { ...value.limits, [key]: limit } });
  }

  if (editingAgentId === null) {
    const referenced = referencedModelSlots(value);
    return (
      <>
        {/* Run limits — the operator's guardrails, applied to every agent and both
            execution modes at once, so they sit above the agents rather than inside
            one. */}
        <section className={gg.limitsWidget}>
          <p className={runExec.sectionLabel}>
            Run limits
            <HelpTip text="The ceilings that stop a run and record which one stopped it. Leave a field empty to leave that ceiling off. A cost ceiling stops the run before its next turn, so the final cost can exceed it by up to one turn." />
          </p>
          <div className={gg.limitGrid}>
            {RUN_LIMIT_SPECS.map((spec) => (
              <label key={spec.key} className={gg.capParamField}>
                <FieldLabel label={spec.label} hint={spec.hint} />
                <input
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
              </label>
            ))}
          </div>
          {limitsError ? (
            <p className={gg.fieldError}>{limitsError}</p>
          ) : (
            limitsWarning && <p className={gg.limitWarning}>{limitsWarning}</p>
          )}
        </section>

        {/* Model slots — the launch-time model parameters. Declaring them is what
            keeps one configuration reusable across models: the New run page asks for
            these, pre-filled with any default, and agents bind to them by name. */}
        <p
          className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
        >
          Model slots
        </p>
        <p className={`${runExec.muted} ${gg.backdropNote}`}>
          The models this configuration asks for at launch. Give each a name the
          launch form can label, and an optional default. Agents below bind to
          these by name.
        </p>
        <div className={gg.slotList}>
          {value.modelSlots.map((modelSlot) => {
            const unused = !referenced.has(modelSlot.id);
            return (
              <div key={modelSlot.id} className={gg.slotBlock}>
                <div className={gg.slotFields}>
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Slot name</span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={modelSlot.name}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateModelSlot(modelSlot.id, { name: e.target.value })
                      }
                      placeholder="e.g. primary"
                    />
                  </label>
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>
                      Default model (optional)
                    </span>
                    <ModelCombobox
                      value={modelSlot.defaultModelId}
                      onChange={(v) =>
                        updateModelSlot(modelSlot.id, { defaultModelId: v })
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
                      onClick={() => removeModelSlot(modelSlot.id)}
                      aria-label={`Remove the ${modelSlot.name || "unnamed"} model slot`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {unused && (
                  <p className={gg.fieldError}>
                    No agent binds this slot, so launching will never ask for
                    it.
                  </p>
                )}
              </div>
            );
          })}
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

        {/* Agents — the per-agent profiles. One of them is flagged as the root: it
            drives the run's top-level session and is the default for the merge agent
            and speculation judging. Any profile may be it, and any profile may be
            removed — including the root, which passes the flag on. */}
        <p
          className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
        >
          Agents
        </p>
        <p className={`${runExec.muted} ${gg.backdropNote}`}>
          Each agent has its own capabilities, model, custom prompt, and the set
          of agents it may spawn. Open one to configure it. The{" "}
          <strong>root</strong> agent drives the run&rsquo;s top-level session;
          make another one the root at any time.
        </p>
        <div className={gg.slotList}>
          {value.agents.map((agent) => {
            const onCount = CAPABILITIES.filter(
              (c) => agent.capabilities[c.id]?.enabled,
            ).length;
            const slotName = value.modelSlots.find(
              (s) => s.id === agent.modelSlotId,
            )?.name;
            const modelSummary =
              agent.modelSource === "model-slot"
                ? `slot: ${slotName?.trim() || "none"}`
                : agent.modelId || "no model";
            const isRootAgent = agent.id === value.rootAgentId;
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
                    </span>
                    <span className={gg.capId}>
                      {onCount} capabilities enabled · {modelSummary}
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
              </div>
            );
          })}
          {!readOnly && (
            <button
              type="button"
              className={runExec.secondary}
              onClick={addAgent}
            >
              + Add agent
            </button>
          )}
        </div>
        {value.agents.length === 0 && (
          <p className={gg.fieldError}>
            This configuration has no agents. Add at least one before saving it.
          </p>
        )}
      </>
    );
  }

  // --- Per-agent view -------------------------------------------------------
  const agent = value.agents.find((a) => a.id === editingAgentId);
  // The effect above is already returning to the top-level form; render nothing for the
  // one frame in between rather than crashing on the missing profile.
  if (!agent) return null;
  const isRoot = agent.id === value.rootAgentId;
  const paramsErrors = agentParamErrors(agent);
  const boundSlot = value.modelSlots.find((s) => s.id === agent.modelSlotId);

  const patchAgent = (patch: Partial<GgAgentDraft>) =>
    updateAgent(agent.id, patch);
  const updateCap = (id: string, patch: Partial<GgCapabilityDraft>) =>
    patchAgent({
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
  const setToolAblation = (tools: ReadonlyArray<string>, on: boolean) =>
    patchAgent({
      disabledTools: setToolBundle(agent.disabledTools, tools, on),
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
    patchAgent({
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
    patchAgent({
      subagents: agent.subagents.map((s) =>
        s.agentId === targetId ? { ...s, description } : s,
      ),
    });

  // gg renders one of two built-in system prompts per agent, chosen by its execution
  // mode: the responses-as-code arm names each capability's grouped methods and teaches
  // the code protocol; the tool-calling arm names the free-standing tools. The editor
  // seeds (and resets to) whichever default this agent will actually run against, so an
  // operator starts from the prompt gg would have used.
  const defaultPrompt = agent.capabilities["responses-as-code"]?.enabled
    ? DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE
    : DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE;

  // The full system prompt shown in the (collapsed-by-default) editor: this agent's
  // override, or the built-in default for its mode. Editing it to exactly that default
  // stores no override.
  const promptValue = agent.systemPromptTemplate || defaultPrompt;
  const promptOverridden = agent.systemPromptTemplate.trim().length > 0;
  function setPrompt(next: string) {
    patchAgent({
      systemPromptTemplate: next === defaultPrompt ? "" : next,
    });
  }

  return (
    <>
      {/* Every agent's name is editable, the root's included: the root is a flag on the
          configuration, not a name, and renaming one here carries every reference to it
          (rosters, the merge agent, the speculation judge) along. */}
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
            onChange={(e) => patchAgent({ name: e.target.value })}
            placeholder="e.g. reviewer"
          />
        </label>
      </div>

      {/* Model binding — one model per agent, taken from a declared model slot (at
          launch) or pinned here. */}
      <div className={gg.slotFields}>
        <label className={`${runExec.field} ${gg.slotSourceField}`}>
          <span className={runExec.fieldLabel}>Model from</span>
          <select
            className={runExec.select}
            value={agent.modelSource}
            disabled={readOnly}
            onChange={(e) =>
              patchAgent({
                modelSource: e.target.value as GgAgentDraft["modelSource"],
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
              onChange={(e) => patchAgent({ modelSlotId: e.target.value })}
            >
              {/* The offered slots are the ones this configuration declares, by id — a
                  slot the operator renamed keeps its binding, and one they deleted
                  leaves the agent on "(none)" rather than on a name nothing answers
                  to. */}
              {!boundSlot && <option value={agent.modelSlotId}>(none)</option>}
              {value.modelSlots.map((slot) => (
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
              onChange={(v) => patchAgent({ modelId: v })}
              models={models}
              harnessFamily={GG_MODEL_FAMILY}
              inputClassName={runExec.input}
              disabled={readOnly}
              placeholder="model id (e.g. anthropic/claude-opus-4.8)"
            />
          </label>
        )}
      </div>
      {agent.modelSource === "model-slot" && !boundSlot && (
        <p className={gg.fieldError}>
          This agent defers to no model slot, so a run could never give it a
          model. Pick one of the configuration&rsquo;s slots, or pin it a model.
        </p>
      )}

      {/* The full capability catalog, grouped by concern, collapsible — this agent's
          capabilities. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Capabilities
      </p>
      {CAP_GROUPS.map(({ group }) => {
        const groupCaps = CAPABILITIES.filter((c) => c.group === group);
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
              <span className={gg.groupToggle}>{isCollapsed ? "▸" : "▾"}</span>
              <span className={gg.groupName}>{group}</span>
              <span className={gg.groupCount}>
                {onCount}/{groupCaps.length} on
              </span>
            </button>
            {!isCollapsed && (
              <div className={gg.capList}>
                {groupCaps.map((cap) => {
                  const draft =
                    agent.capabilities[cap.id] ?? blankCapabilityDraft();
                  const enabled = Boolean(draft.enabled);
                  const error = paramsErrors[cap.id];
                  // Another capability on this agent may FIX this one's implementation
                  // (a responses-as-code agent can only finish through `finish`), in
                  // which case the picker shows that value and cannot be changed — and
                  // the params below are filtered against it, not against the stale
                  // selection it overrides.
                  const locked = lockedImplementation(cap, agent.capabilities);
                  const implementation = locked ?? draft.implementation;
                  // Run-level "which agent runs this?" knobs (the merge and judge
                  // agents) are read off the root agent, so only offer them there — and
                  // a param the selected implementation does not read (the compaction
                  // model outside a handoff strategy) is not offered at all, rather
                  // than sitting there inert.
                  const offered = (cap.params ?? []).filter(
                    (p) =>
                      (p.kind !== "agent" || isRoot) &&
                      paramApplies(p, implementation),
                  );
                  // A boolean param is a feature switch, not a value: it renders with
                  // the tool-ablation sliders rather than in the param grid.
                  const params = offered.filter((p) => p.kind !== "boolean");
                  const flags = offered.filter((p) => p.kind === "boolean");
                  const hasBody =
                    params.length ||
                    flags.length ||
                    cap.implementationLabel ||
                    cap.toolAblation?.length ||
                    error;
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
                            updateCap(cap.id, { enabled: next })
                          }
                        />
                        <span className={gg.capName}>{cap.name}</span>
                        <span className={gg.capId}>{cap.id}</span>
                      </label>
                      <p className={gg.capPurpose}>{cap.purpose}</p>
                      {enabled && hasBody && (
                        <div className={gg.capBody}>
                          {(params.length || cap.implementationLabel) && (
                            <div className={gg.capParamGrid}>
                              {cap.implementationLabel && (
                                <label className={gg.capParamField}>
                                  <FieldLabel
                                    label={cap.implementationLabel}
                                    hint={
                                      locked !== null
                                        ? cap.lockImplementation?.hint
                                        : cap.implementationHint
                                    }
                                  />
                                  {cap.implementationOptions ? (
                                    // A fixed implementation stays a <select> — so it
                                    // reads and tests as the same control — but shows
                                    // only the value gg will use, and is disabled.
                                    <select
                                      className={runExec.select}
                                      value={implementation ?? ""}
                                      disabled={readOnly || locked !== null}
                                      onChange={(e) =>
                                        updateCap(cap.id, {
                                          implementation: e.target.value,
                                        })
                                      }
                                    >
                                      {cap.implementationOptions
                                        .filter(
                                          (o) =>
                                            locked === null ||
                                            o.value === locked,
                                        )
                                        .map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.label}
                                          </option>
                                        ))}
                                    </select>
                                  ) : (
                                    <input
                                      className={runExec.input}
                                      type="text"
                                      value={draft.implementation ?? ""}
                                      disabled={readOnly}
                                      onChange={(e) =>
                                        updateCap(cap.id, {
                                          implementation: e.target.value,
                                        })
                                      }
                                      placeholder={
                                        cap.implementationPlaceholder ??
                                        "default"
                                      }
                                      spellCheck={false}
                                    />
                                  )}
                                </label>
                              )}
                              {params.map((p) => {
                                if (p.kind === "toggles") {
                                  const off = togglesOff(
                                    p,
                                    draft.params?.[p.key],
                                  );
                                  return (
                                    <div
                                      key={p.key}
                                      className={`${gg.capParamField} ${gg.toggleField}`}
                                      role="group"
                                      aria-label={p.label}
                                    >
                                      <FieldLabel
                                        label={p.label}
                                        hint={p.hint}
                                      />
                                      <div className={gg.toggleList}>
                                        {(p.options ?? []).map((o) => (
                                          <label
                                            key={o.value}
                                            className={gg.toggleItem}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={!off.includes(o.value)}
                                              disabled={readOnly}
                                              onChange={(e) =>
                                                setParam(
                                                  cap.id,
                                                  p.key,
                                                  togglesDraftValue(
                                                    p,
                                                    e.target.checked
                                                      ? off.filter(
                                                          (id) =>
                                                            id !== o.value,
                                                        )
                                                      : [...off, o.value],
                                                  ),
                                                )
                                              }
                                            />
                                            <span>{o.label}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                }
                                if (p.kind === "commands") {
                                  const rows = commandsFromDraft(
                                    draft.params?.[p.key],
                                  );
                                  const setRows = (
                                    next: ReadonlyArray<CommandDraft>,
                                  ) =>
                                    setParam(
                                      cap.id,
                                      p.key,
                                      commandsDraftValue(next),
                                    );
                                  return (
                                    <div
                                      key={p.key}
                                      className={`${gg.capParamField} ${gg.commandField}`}
                                      role="group"
                                      aria-label={p.label}
                                    >
                                      <FieldLabel
                                        label={p.label}
                                        hint={p.hint}
                                      />
                                      <div className={gg.commandList}>
                                        {rows.map((row, i) => (
                                          // Keyed by position: a row has no identity of
                                          // its own, and reordering is not offered — the
                                          // commands run in the order they are listed.
                                          <div
                                            key={i}
                                            className={gg.commandRow}
                                          >
                                            <input
                                              className={`${runExec.input} ${gg.commandLine}`}
                                              type="text"
                                              value={row.command}
                                              disabled={readOnly}
                                              aria-label={`Command ${i + 1}`}
                                              onChange={(e) =>
                                                setRows(
                                                  rows.map((r, j) =>
                                                    j === i
                                                      ? {
                                                          ...r,
                                                          command:
                                                            e.target.value,
                                                        }
                                                      : r,
                                                  ),
                                                )
                                              }
                                              placeholder="e.g. npm run build"
                                              spellCheck={false}
                                            />
                                            <input
                                              className={`${runExec.input} ${gg.commandCwd}`}
                                              type="text"
                                              value={row.cwd}
                                              disabled={readOnly}
                                              aria-label={`Command ${i + 1} working directory`}
                                              onChange={(e) =>
                                                setRows(
                                                  rows.map((r, j) =>
                                                    j === i
                                                      ? {
                                                          ...r,
                                                          cwd: e.target.value,
                                                        }
                                                      : r,
                                                  ),
                                                )
                                              }
                                              placeholder="workspace root"
                                              spellCheck={false}
                                            />
                                            <input
                                              className={`${runExec.input} ${gg.commandTimeout}`}
                                              type="number"
                                              min={0}
                                              value={row.timeoutSecs}
                                              disabled={readOnly}
                                              aria-label={`Command ${i + 1} timeout (seconds)`}
                                              onChange={(e) =>
                                                setRows(
                                                  rows.map((r, j) =>
                                                    j === i
                                                      ? {
                                                          ...r,
                                                          timeoutSecs:
                                                            e.target.value,
                                                        }
                                                      : r,
                                                  ),
                                                )
                                              }
                                              placeholder="timeout s"
                                            />
                                            {!readOnly && (
                                              <button
                                                type="button"
                                                className={gg.slotRemove}
                                                aria-label={`Remove command ${i + 1}`}
                                                onClick={() =>
                                                  setRows(
                                                    rows.filter(
                                                      (_, j) => j !== i,
                                                    ),
                                                  )
                                                }
                                              >
                                                ✕
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                        {!readOnly && (
                                          <button
                                            type="button"
                                            className={runExec.secondary}
                                            onClick={() =>
                                              setRows([
                                                ...rows,
                                                blankCommandDraft(),
                                              ])
                                            }
                                          >
                                            + Add command
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <label
                                    key={p.key}
                                    className={gg.capParamField}
                                  >
                                    <FieldLabel label={p.label} hint={p.hint} />
                                    {p.kind === "select" ? (
                                      <select
                                        className={runExec.select}
                                        value={draft.params?.[p.key] ?? ""}
                                        disabled={readOnly}
                                        onChange={(e) =>
                                          setParam(
                                            cap.id,
                                            p.key,
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {(p.options ?? []).map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.label}
                                          </option>
                                        ))}
                                      </select>
                                    ) : p.kind === "agent" ? (
                                      <select
                                        className={runExec.select}
                                        value={draft.params?.[p.key] ?? ""}
                                        disabled={readOnly}
                                        onChange={(e) =>
                                          setParam(
                                            cap.id,
                                            p.key,
                                            e.target.value,
                                          )
                                        }
                                      >
                                        {/* An agent named by a stored param that no
                                            longer exists stays selectable so the
                                            value round-trips until re-pointed. Live
                                            profiles are offered by id, so renaming one
                                            never breaks the param. */}
                                        {draft.params?.[p.key] &&
                                          !value.agents.some(
                                            (a) =>
                                              a.id === draft.params?.[p.key],
                                          ) && (
                                            <option value={draft.params[p.key]}>
                                              {draft.params[p.key]} (missing)
                                            </option>
                                          )}
                                        {value.agents.map((a) => (
                                          <option key={a.id} value={a.id}>
                                            {a.name || "unnamed"}
                                          </option>
                                        ))}
                                      </select>
                                    ) : p.kind === "text" ? (
                                      <input
                                        className={runExec.input}
                                        type="text"
                                        value={draft.params?.[p.key] ?? ""}
                                        disabled={readOnly}
                                        onChange={(e) =>
                                          setParam(
                                            cap.id,
                                            p.key,
                                            e.target.value,
                                          )
                                        }
                                        placeholder={p.placeholder}
                                        spellCheck={false}
                                      />
                                    ) : (
                                      <input
                                        className={runExec.input}
                                        type="number"
                                        min={0}
                                        max={
                                          p.kind === "fraction" ? 1 : undefined
                                        }
                                        step={p.kind === "fraction" ? 0.05 : 1}
                                        value={draft.params?.[p.key] ?? ""}
                                        disabled={readOnly}
                                        onChange={(e) =>
                                          setParam(
                                            cap.id,
                                            p.key,
                                            e.target.value,
                                          )
                                        }
                                        placeholder={p.placeholder}
                                      />
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {cap.toolAblation?.length || flags.length ? (
                            <div
                              className={gg.ablationGroup}
                              role="group"
                              aria-label={`${cap.name} features`}
                            >
                              <span className={runExec.fieldLabel}>
                                Features
                              </span>
                              <div className={gg.ablationList}>
                                {(cap.toolAblation ?? []).map((bundle) => (
                                  <div
                                    key={bundle.label}
                                    className={gg.ablationItem}
                                  >
                                    <label className={gg.ablationLabel}>
                                      <Switch
                                        checked={toolBundleOn(
                                          agent.disabledTools,
                                          bundle.tools,
                                        )}
                                        disabled={readOnly}
                                        onChange={(on) =>
                                          setToolAblation(bundle.tools, on)
                                        }
                                      />
                                      <span className={gg.ablationName}>
                                        {bundle.label}
                                      </span>
                                    </label>
                                    {bundle.hint && (
                                      <HelpTip text={bundle.hint} />
                                    )}
                                  </div>
                                ))}
                                {/* A feature that changes what an offered tool
                                    demands, rather than which tools exist: same box,
                                    same slider, a capability param behind it. */}
                                {flags.map((flag) => (
                                  <div
                                    key={flag.key}
                                    className={gg.ablationItem}
                                  >
                                    <label className={gg.ablationLabel}>
                                      <Switch
                                        checked={
                                          draft.params?.[flag.key] === "true"
                                        }
                                        disabled={readOnly}
                                        onChange={(on) =>
                                          setParam(
                                            cap.id,
                                            flag.key,
                                            on ? "true" : "",
                                          )
                                        }
                                      />
                                      <span className={gg.ablationName}>
                                        {flag.label}
                                      </span>
                                    </label>
                                    {flag.hint && <HelpTip text={flag.hint} />}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {error && (
                            <span className={gg.fieldError}>{error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Roster — which other agents this one may put to work, and for what. An agent
          may list itself, for recursion. Panelled, like the run limits: it is a table of
          sliders, and a table reads against a surface rather than straight on the
          backdrop (which is also why its heading takes no readability halo). */}
      <section className={gg.rosterWidget}>
        <p className={runExec.sectionLabel}>Roster</p>
        <p className={runExec.muted}>
          The agents this one may put to work, and what for:{" "}
          <strong>Subagent</strong> (spawnable with <code>spawn_subagent</code>,{" "}
          <code>speculate</code>, or <code>run_workflow</code>),{" "}
          <strong>Implementer</strong> (assignable as an issue&rsquo;s agent),
          and <strong>Reviewer</strong> (namable among an issue&rsquo;s
          reviewers). The three are independent. Describe when to use a target —
          the description is what this agent sees.
        </p>
        <div className={gg.subagentList}>
          {value.agents.map((target) => {
            const entry = agent.subagents.find((s) => s.agentId === target.id);
            const on = Boolean(entry);
            return (
              <div key={target.id} className={gg.subagentRow}>
                <span className={gg.ablationName}>
                  {target.name || "unnamed"}
                  {target.id === agent.id && (
                    <span className={gg.capId}> (self)</span>
                  )}
                </span>
                <span className={gg.subagentScopes}>
                  {SUBAGENT_SCOPES.map((scope) => (
                    <label
                      key={scope.value}
                      className={gg.ablationLabel}
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

      {/* Custom instructions — the field an operator edits normally; inserted into the
          system prompt. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Custom instructions
      </p>
      <textarea
        className={gg.textarea}
        value={agent.customInstructions}
        disabled={readOnly}
        onChange={(e) => patchAgent({ customInstructions: e.target.value })}
        placeholder="Extra instructions for this agent, inserted into its system prompt."
        rows={4}
      />

      {/* System prompt — the full Handlebars template, collapsed by default. Editing
          it is the escape hatch; most operators only touch Custom instructions. */}
      <div className={gg.group}>
        <button
          type="button"
          className={gg.groupHeader}
          onClick={() => setPromptOpen((v) => !v)}
          aria-expanded={promptOpen}
        >
          <span className={gg.groupToggle}>{promptOpen ? "▾" : "▸"}</span>
          <span className={gg.groupName}>System Prompt</span>
          <span className={gg.groupCount}>
            {promptOverridden ? "overridden" : "default"}
          </span>
        </button>
        {promptOpen && (
          <div className={gg.capList}>
            <p className={`${runExec.muted}`}>
              The full template gg renders for this agent. Custom instructions
              are inserted at the <code>{"{{customInstructions}}"}</code> block
              near the top. Edit here only to rewrite the whole prompt; leaving
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
  );
}
