import { useEffect, useState } from "react";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATES_CODE,
} from "@test-cabinet/run-record/gg-system-prompt";
import type { GgSubagentScope } from "@test-cabinet/run-record/gg";
import { SegmentedControl } from "@test-cabinet/ui";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  AGENT_MODES,
  AGENT_MODE_HINT,
  BLOCKING_HOOK_EVENTS,
  CAP_GROUPS,
  FSM_CAP,
  GG_BUILTIN_HOOK_HINTS,
  GG_BUILTIN_HOOK_IDS,
  HOOK_DECISION_CONTRACT,
  HOOK_EVENTS,
  HOOK_KINDS,
  LOOP_DETECTION_HINT,
  LOOP_DETECTION_SPECS,
  RESPONSES_AS_CODE_CAP,
  RESPONSES_AS_CODE_CAP_ID,
  RUN_LIMIT_SPECS,
  SHELL_OUTPUT_OPTIONS,
  SUBAGENT_SCOPES,
  capabilitiesForMode,
  type CapGroup,
  type CapSpec,
  type GgAgentMode,
  type LoopDetectionSpec,
  type RunLimitSpec,
} from "./ggCatalog";
import {
  CapabilityBody,
  FieldLabel,
  HelpTip,
  Switch,
} from "./GgCapabilityFields";
import {
  agentParamErrors,
  agentStates,
  blankAgentDraft,
  blankHookDraft,
  blankCapabilityDraft,
  blankModelSlot,
  capabilityActive,
  dropAgentReferences,
  loopDetectionError,
  loopDetectionWarning,
  referencedModelSlots,
  runLimitsError,
  runLimitsWarning,
  seedAgentParams,
  setToolBundle,
  unusedAgentName,
  type GgAgentDraft,
  type GgCapabilityDraft,
  type GgConfigDraft,
  type GgHookDraft,
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
  if (kind === "count" || kind === "mib") return 1;
  return kind === "fraction" ? 0.05 : "any";
}

// The agent-type selector's segments, derived from the catalog so a type added there
// appears here without a second list to keep in step.
const AGENT_MODE_OPTIONS = AGENT_MODES.map((mode) => ({
  value: mode.value,
  label: mode.label,
}));

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
// agent switches to a per-agent view (its type, its capabilities, its model, its custom
// prompt, and the agents it may spawn).
//
// An agent's **type** ([GgAgentMode]) is the first thing chosen about it, because it
// decides what the rest of the form even offers: Tools and RaC are two ways of driving
// the same capabilities (with a couple that only one of them reads), and FSM is not a
// worker at all — a machine has no capabilities of its own, so it is configured by its
// states instead. Capabilities are per agent, so an ablation can vary what each agent in
// a run can do, and give different agents different models or even different types.
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

  // --- Hooks ----------------------------------------------------------------
  //
  // Run-level, like the ceilings above and for the same reason: a hook is the operator
  // reaching into the run from outside it, not a feature the model is offered. It never
  // appears among an agent's capabilities because there is no agent it belongs to — the
  // session's two events are nobody's, and the rest fire for every agent at once.
  function patchHook(id: string, patch: Partial<GgHookDraft>) {
    onChange({
      ...value,
      hooks: value.hooks.map((hook) =>
        hook.id === id ? { ...hook, ...patch } : hook,
      ),
    });
  }

  function addHook() {
    onChange({
      ...value,
      hooks: [...value.hooks, blankHookDraft()],
    });
  }

  function removeHook(id: string) {
    onChange({ ...value, hooks: value.hooks.filter((h) => h.id !== id) });
  }

  if (editingAgentId === null) {
    const referenced = referencedModelSlots(value);
    return (
      <>
        {/* Run limits — the operator's guardrails, applied to every agent and every
            agent type at once, so they sit above the agents rather than inside one. */}
        <section className={gg.limitsWidget}>
          <p className={runExec.sectionLabel}>
            Run limits
            <HelpTip text="The ceilings a run is bounded by, applied to every agent whatever its type. A run stopped by one records which one stopped it. Leave a field empty to leave that ceiling off." />
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

        {/* Hooks — the operator's seam into the run's lifecycle. Beside the ceilings
            rather than among the capabilities because a hook is not a capability: the
            model is never told one exists, is offered no tool for it, and cannot decline
            one. Several of its events are not an agent's at all. */}
        <section className={gg.limitsWidget}>
          <p className={runExec.sectionLabel}>
            Hooks
            <HelpTip text="Commands and scripts gg runs at ten points of a run — around a file write, around a shell command, around a compaction, as an agent starts or tries to stop, and at the session's two ends. A hook can stop the operation it precedes and put text in front of the model. The model is never told a hook exists." />
          </p>
          {value.hooks.length === 0 ? (
            <p className={runExec.muted}>
              No hooks. A run without them behaves exactly as it always has — this
              is the control arm every hooked run is read against.
            </p>
          ) : (
            <div className={gg.subagentList}>
              {value.hooks.map((hook) => (
                <HookRow
                  key={hook.id}
                  hook={hook}
                  readOnly={readOnly}
                  onPatch={(patch) => patchHook(hook.id, patch)}
                  onRemove={() => removeHook(hook.id)}
                />
              ))}
            </div>
          )}
          {!readOnly && (
            <button
              type="button"
              className={runExec.secondary}
              onClick={addHook}
            >
              Add hook
            </button>
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
            drives the run's top-level session and is the default for the merge agent.
            Any profile may be it, and any profile may be
            removed — including the root, which passes the flag on. */}
        <p
          className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
        >
          Agents
        </p>
        <p className={`${runExec.muted} ${gg.backdropNote}`}>
          Each agent has its own type and — where its type is a worker&rsquo;s —
          its capabilities, model, custom prompt, and the set of agents it may
          spawn. Open one to configure it. The <strong>root</strong> agent
          drives the run&rsquo;s top-level session; make another one the root at
          any time.
        </p>
        <div className={gg.slotList}>
          {value.agents.map((agent) => {
            const slotName = value.modelSlots.find(
              (s) => s.id === agent.modelSlotId,
            )?.name;
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
                      {agentSummary(agent, modeLabel)}
                      {modelSummary ? ` · ${modelSummary}` : ""}
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
  // The whole configuration is passed, not this profile alone: a machine's states name
  // *other* profiles, so whether they name anything real is a question about the set.
  const paramsErrors = agentParamErrors(agent, value.agents);
  const boundSlot = value.modelSlots.find((s) => s.id === agent.modelSlotId);
  const modeSpec = AGENT_MODES.find((m) => m.value === agent.mode);
  const isMachine = agent.mode === "fsm";
  // The capabilities this agent's type reads — empty for a machine, which is why the
  // whole Capabilities section is absent under one.
  const modeCaps = capabilitiesForMode(agent.mode);

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
  // Drop a param key entirely, which is a different state from setting it empty: a
  // `model` param defers to a slot exactly while its slot key is *present*, so "pin a
  // model instead" has to remove the key rather than blank it.
  const clearParam = (id: string, key: string) => {
    const base = agent.capabilities[id] ?? blankCapabilityDraft();
    const params = { ...(base.params ?? {}) };
    delete params[key];
    updateCap(id, { params });
  };
  const setToolAblation = (tools: ReadonlyArray<string>, on: boolean) =>
    patchAgent({
      disabledTools: setToolBundle(agent.disabledTools, tools, on),
    });
  // Loop detection's switch and its knobs, written separately: the knobs survive the
  // switch going off, so an operator who tunes the detector and then disarms it finds
  // their settings still there when they arm it again.
  const setLoopEnabled = (enabled: boolean) =>
    patchAgent({ loopDetection: { ...agent.loopDetection, enabled } });
  const setLoopKnob = (key: LoopDetectionSpec["key"], next: string) =>
    patchAgent({
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
  const setMode = (mode: GgAgentMode) => patchAgent({ mode });

  // The props every capability body takes, threaded once: which capability it is and how
  // to write to it is all that differs between the three places one is rendered.
  const capabilityFields = (cap: CapSpec) => ({
    cap,
    agent,
    agents: value.agents,
    modelSlots: value.modelSlots,
    models,
    isRoot,
    readOnly,
    error: paramsErrors[cap.id],
    onUpdateCap: (patch: Partial<GgCapabilityDraft>) =>
      updateCap(cap.id, patch),
    onSetParam: (key: string, param: string) => setParam(cap.id, key, param),
    onClearParam: (key: string) => clearParam(cap.id, key),
    onSetToolAblation: setToolAblation,
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

  // gg renders one of two built-in system prompts per agent, chosen by its type: the
  // responses-as-code arm names each capability's grouped methods and teaches the code
  // protocol; the tool-calling arm names the free-standing tools. The editor seeds (and
  // resets to) whichever default this agent will actually run against, so an operator
  // starts from the prompt gg would have used.
  //
  // The code arm is additionally per **program language** — the prompt quotes the SDK
  // throughout, and a function's spelling is exactly what differs between languages — so
  // the agent's own `language` param picks the template. Seeding another language's
  // prompt here would persist an override in the wrong syntax the moment an operator
  // edited a line of it. An unset (or unrecognised) language is gg's own default, which
  // is what the run would resolve it to.
  const defaultPrompt =
    agent.mode === "rac"
      ? (DEFAULT_GG_SYSTEM_PROMPT_TEMPLATES_CODE[
          agent.capabilities[RESPONSES_AS_CODE_CAP_ID]?.params?.language ?? ""
        ] ?? DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE)
      : DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE;

  // The full system prompt shown in the (collapsed-by-default) editor: this agent's
  // override, or the built-in default for its type. Editing it to exactly that default
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
          (rosters, the merge agent) along. */}
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
          launch) or pinned here — and, on the same row, how long this agent's stable
          prompt-cache entries live. The cache lifetime is per agent because it is a cost
          trade that comes out differently for each: the extended lifetime is charged a
          higher write premium, and only earns it back on an agent whose turns are slow or
          far enough apart to outlive the provider default.

          Absent under a machine, along with the roster and the prompt below it: an FSM
          agent takes no turns, so it has no model to run, no cache to keep and nobody to
          spawn. A control for a value gg would never read is worse than no control — it
          invites an operator to configure a run that does not exist. */}
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
                  {!boundSlot && (
                    <option value={agent.modelSlotId}>(none)</option>
                  )}
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
                  patchAgent({
                    promptCacheTtl: e.target
                      .value as GgAgentDraft["promptCacheTtl"],
                  })
                }
              >
                <option value="standard">5 minutes (provider default)</option>
                <option value="extended">1 hour (extended, costs more)</option>
              </select>
            </label>
          </div>
          {agent.modelSource === "model-slot" && !boundSlot && (
            <p className={gg.fieldError}>
              This agent defers to no model slot, so a run could never give it a
              model. Pick one of the configuration&rsquo;s slots, or pin it a
              model.
            </p>
          )}
          {agent.promptCacheTtl === "extended" && (
            <p className={gg.cacheTtlNote}>
              Worth it for an agent that delegates, or whose turns run builds
              and test suites; wasted on one that answers quickly and is never
              resumed.
            </p>
          )}

          {/* Loop detection — the other half of how gg talks to this agent's model, and
              so directly under the binding it belongs to. Not a capability: it changes
              nothing about what the agent can do, only whether gg watches the reply
              arrive and abandons one that has degenerated into repetition. It is
              nonetheless authored exactly like one — a switch, a purpose, and a body of
              knobs revealed once it is on — because that is the shape an operator already
              knows for "a thing gg does that you turn on".

              Per agent, because looping is a property of the model and one run's profiles
              may be bound to several; absent under a machine along with the binding above
              it, which takes no turns and so has no reply to watch. */}
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
                Abandon and retry a reply that has degenerated into repetition,
                instead of paying for it to the model&rsquo;s output cap. Arming
                it moves this agent onto gg&rsquo;s streaming transport.
              </p>
              {/* The knobs are shown only while the detector is armed — a disarmed
                  agent's are still recorded and still come back, but a grid of numbers
                  nothing will read invites tuning a detector that is not running. */}
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
                          placeholder={`gg's default: ${spec.ggDefault.toLocaleString("en-US")}`}
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
        </>
      )}

      {/* Agent type — how this agent is implemented, and so what the rest of the form
          offers. Panelled and above the capabilities, because it is the choice the
          capabilities below are a consequence of rather than one of them. */}
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

      {/* The RaC agent's own settings: the sandbox's ceilings, the repairs gg makes to a
          reply before running it, and what the transcript records. These are the type's
          configuration, not a capability of it, which is why they sit here rather than in
          a row of the list below. */}
      {agent.mode === "rac" && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            Responses as code
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            {RESPONSES_AS_CODE_CAP.purpose}
          </p>
          <div
            className={gg.modePanel}
            role="group"
            aria-label="Responses as code"
          >
            <CapabilityBody {...capabilityFields(RESPONSES_AS_CODE_CAP)} />
          </div>
        </>
      )}

      {/* The machine itself — the whole configuration of an FSM agent. */}
      {isMachine && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            Process
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            {FSM_CAP.purpose} A machine has no turns of its own, which is why
            this page asks it for no model, no prompt and no roster: each state
            runs the profile it names, with that profile&rsquo;s configuration.
          </p>
          <div className={gg.modePanel} role="group" aria-label="Process">
            <CapabilityBody {...capabilityFields(FSM_CAP)} />
          </div>
        </>
      )}

      {/* The capability catalog for this agent's type, grouped by concern, collapsible.
          A machine has none — its states run other profiles — so the whole section is
          absent rather than shown empty. */}
      {!isMachine && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            Capabilities
          </p>
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
                                updateCap(cap.id, { enabled: next })
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
          may list itself, for recursion. Panelled, like the run limits: it is a table of
          sliders, and a table reads against a surface rather than straight on the
          backdrop (which is also why its heading takes no readability halo).

          A machine has none: it never takes a turn, so it never calls a delegation tool
          and never staffs an issue. Its *states* put profiles to work, and each of those
          spawns from its own roster. */}
      {!isMachine && (
        <>
          <section className={gg.rosterWidget}>
            <p className={runExec.sectionLabel}>Roster</p>
            <p className={runExec.muted}>
              The agents this one may put to work, and what for:{" "}
              <strong>Subagent</strong> (spawnable with{" "}
              <code>spawn_subagent</code>), <strong>Implementer</strong>{" "}
              (assignable as an issue&rsquo;s agent), and{" "}
              <strong>Reviewer</strong> (namable among an issue&rsquo;s
              reviewers). The three are independent. Describe when to use a
              target — the description is what this agent sees.
            </p>
            <div className={gg.subagentList}>
              {value.agents.map((target) => {
                const entry = agent.subagents.find(
                  (s) => s.agentId === target.id,
                );
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
                            checked={Boolean(
                              entry?.scopes.includes(scope.value),
                            )}
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
          system prompt. There is no prompt to insert them into under a machine, which
          renders none. */}
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
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
                  The full template gg renders for this agent. Custom
                  instructions are inserted at the{" "}
                  <code>{"{{customInstructions}}"}</code> block near the top.
                  Edit here only to rewrite the whole prompt; leaving it equal
                  to the default stores no override.
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
  );
}

/**
 * One hook's row: the event it fires at, which of the three kinds it is, and the fields
 * that kind needs.
 *
 * Every kind's fields are held in the draft at once and only the current kind's are
 * rendered, so switching kind and switching back does not lose what was typed. The
 * blocking note under the event picker is read off a table rather than off the `pre-`
 * prefix, because `pre-compact` is a `pre-` event that deliberately cannot block — and a
 * gate an operator believes they have is worse than no gate at all.
 */
function HookRow({
  hook,
  readOnly,
  onPatch,
  onRemove,
}: {
  hook: GgHookDraft;
  readOnly: boolean;
  onPatch: (patch: Partial<GgHookDraft>) => void;
  onRemove: () => void;
}) {
  const event = HOOK_EVENTS.find((e) => e.value === hook.event);
  const kind = HOOK_KINDS.find((k) => k.value === hook.kind);
  const blocks = BLOCKING_HOOK_EVENTS.includes(hook.event);
  return (
    <div className={gg.subagentRow}>
      <div className={gg.agentHeading}>
        <label className={`${runExec.field} ${gg.slotNameField}`}>
          <FieldLabel
            label="Event"
            hint={event?.hint ?? "Which point of the run this hook fires at."}
          />
          <select
            className={runExec.input}
            value={hook.event}
            disabled={readOnly}
            onChange={(e) =>
              onPatch({ event: e.target.value as GgHookDraft["event"] })
            }
          >
            {HOOK_EVENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${runExec.field} ${gg.slotNameField}`}>
          <FieldLabel
            label="Kind"
            hint={kind?.hint ?? "What this hook runs, and how gg reads what came back."}
          />
          <select
            className={runExec.input}
            value={hook.kind}
            disabled={readOnly}
            onChange={(e) =>
              onPatch({ kind: e.target.value as GgHookDraft["kind"] })
            }
          >
            {HOOK_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${runExec.field} ${gg.slotNameField}`}>
          <FieldLabel
            label="Name"
            hint="An operator's label, shown wherever gg reports this hook running or blocking. Optional — gg falls back to describing what it runs."
          />
          <input
            className={runExec.input}
            value={hook.name}
            disabled={readOnly}
            placeholder="e.g. build must pass"
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        {!readOnly && (
          <button type="button" className={runExec.secondary} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <p className={runExec.muted}>
        {blocks
          ? "This event can be blocked: a hook that refuses stops the operation, and the reason it gives is what the model reads."
          : "This event cannot be blocked — whatever the hook says, the operation goes ahead."}
      </p>

      {hook.kind === "command" && (
        <div className={gg.limitGrid}>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Command"
              hint="The command line, run through `sh -c`. It receives no input from gg."
            />
            <input
              className={runExec.input}
              value={hook.command}
              disabled={readOnly}
              placeholder="e.g. npm test"
              onChange={(e) => onPatch({ command: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Working directory"
              hint="Relative to gg's working directory, or absolute. Blank runs it in the agent's workspace root — which for an agent working in an isolated worktree is that worktree."
            />
            <input
              className={runExec.input}
              value={hook.cwd}
              disabled={readOnly}
              placeholder="the workspace root"
              onChange={(e) => onPatch({ cwd: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Timeout (seconds)"
              hint="How long it may run before it is killed. Blank uses gg's default, which is generous because a hook command is typically a build or a test suite."
            />
            <input
              className={runExec.input}
              type="number"
              min={0}
              value={hook.timeoutSecs}
              disabled={readOnly}
              placeholder="300"
              onChange={(e) => onPatch({ timeoutSecs: e.target.value })}
            />
          </label>
          <label className={gg.capParamField}>
            <FieldLabel
              label="Output mode"
              hint="How much of the output comes back inline and what happens to the rest. Blank follows the agent's own shell configuration, which is almost always what you mean."
            />
            <select
              className={runExec.input}
              value={hook.output}
              disabled={readOnly}
              onChange={(e) => onPatch({ output: e.target.value })}
            >
              {SHELL_OUTPUT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "" ? "Follow the agent" : option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {hook.kind === "built-in" && (
        <label className={gg.capParamField}>
          <FieldLabel
            label="Script"
            hint={
              GG_BUILTIN_HOOK_HINTS[hook.script] ??
              "One of gg's own hook scripts."
            }
          />
          <select
            className={runExec.input}
            value={hook.script}
            disabled={readOnly}
            onChange={(e) => onPatch({ script: e.target.value })}
          >
            {GG_BUILTIN_HOOK_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      )}

      {hook.kind === "custom" && (
        <label className={gg.capParamField}>
          <FieldLabel
            label="Script"
            hint="Run with the event as its sole argument, a JSON string. A `#!` line chooses the interpreter; without one it is run by `sh`. It must exit 0 and print one decision object on stdout — a non-zero exit or unreadable output is the hook itself failing, which stops the run."
          />
          <textarea
            className={runExec.input}
            rows={8}
            value={hook.source}
            disabled={readOnly}
            placeholder={"#!/bin/sh\n# $1 is the event, as JSON.\necho '{\"action\":\"continue\"}'"}
            onChange={(e) => onPatch({ source: e.target.value })}
          />
          <p className={runExec.muted}>
            Print exactly one of:
            <code className={gg.hookContract}>{HOOK_DECISION_CONTRACT}</code>
          </p>
        </label>
      )}
    </div>
  );
}
