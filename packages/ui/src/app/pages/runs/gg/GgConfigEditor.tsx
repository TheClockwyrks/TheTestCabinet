import { useState, type ReactNode } from "react";
import {
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE,
} from "@test-cabinet/run-record/gg-system-prompt";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  CAPABILITIES,
  CAP_GROUPS,
  RUN_LIMIT_SPECS,
  type CapGroup,
  type RunLimitSpec,
} from "./ggCatalog";
import {
  agentParamErrors,
  blankAgentDraft,
  blankCapabilityDraft,
  referencedModelSlots,
  runLimitsError,
  runLimitsWarning,
  setToolBundle,
  togglesDraftValue,
  togglesOff,
  toolBundleOn,
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
// agents it may spawn) with a Back control. Capabilities are per agent now — there is
// no run-global capability list — so an ablation can vary what each agent in a run can
// do, and give different agents different models or even different execution modes.
//
// This is the one authoring surface for a gg configuration. It is deliberately *not* a
// launcher: a configuration carries no test case, and the models it does not pin
// outright are declared as *model slots* the new-run form asks for at launch.
export function GgConfigEditor({
  value,
  onChange,
  models,
  readOnly = false,
}: GgConfigEditorProps) {
  // Which agent's per-agent view is open, or `null` for the top-level form. Owned here
  // so the page that mounts the editor stays a thin wrapper.
  const [editingAgent, setEditingAgent] = useState<number | null>(null);
  // Which capability groups are collapsed in the per-agent view.
  const [collapsed, setCollapsed] = useState<Set<CapGroup>>(
    () => new Set(CAP_GROUPS.filter((g) => !g.startOpen).map((g) => g.group)),
  );
  // Whether the (collapsed-by-default) full system-prompt template is expanded.
  const [promptOpen, setPromptOpen] = useState(false);

  function toggleGroup(group: CapGroup) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // --- Agent mutators -------------------------------------------------------
  function updateAgent(index: number, patch: Partial<GgAgentDraft>) {
    onChange({
      ...value,
      agents: value.agents.map((a, i) =>
        i === index ? { ...a, ...patch } : a,
      ),
    });
  }
  function addAgent() {
    // A unique default name so the added agent is immediately valid.
    const taken = new Set(value.agents.map((a) => a.name));
    let n = value.agents.length + 1;
    let name = `agent-${n}`;
    while (taken.has(name)) name = `agent-${++n}`;
    onChange({ ...value, agents: [...value.agents, blankAgentDraft(name)] });
  }
  function removeAgent(index: number) {
    const removed = value.agents[index]?.name;
    onChange({
      ...value,
      agents: value.agents
        .filter((_, i) => i !== index)
        // Drop every allowlist entry that pointed at the removed agent, or it would
        // dangle.
        .map((a) => ({
          ...a,
          subagents: a.subagents.filter((s) => s.agent !== removed),
        })),
    });
  }

  // --- Model-slot (launch parameter) mutators -------------------------------
  function updateModelSlot(index: number, patch: Partial<GgModelSlotDraft>) {
    const previous = value.modelSlots[index];
    const next = value.modelSlots.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    // Renaming a declaration must carry every agent bound to it along, or the rename
    // would silently orphan them.
    const renamed =
      patch.name !== undefined && previous && patch.name !== previous.name;
    onChange({
      ...value,
      modelSlots: next,
      agents: renamed
        ? value.agents.map((a) =>
            a.modelSource === "model-slot" && a.modelSlot === previous.name
              ? { ...a, modelSlot: patch.name! }
              : a,
          )
        : value.agents,
    });
  }
  function addModelSlot() {
    onChange({
      ...value,
      modelSlots: [...value.modelSlots, { name: "", defaultModelId: "" }],
    });
  }
  function removeModelSlot(index: number) {
    onChange({
      ...value,
      modelSlots: value.modelSlots.filter((_, i) => i !== index),
    });
  }

  const limitsError = runLimitsError(value.limits);
  const limitsWarning = runLimitsWarning(value.limits);

  // --- Top-level view -------------------------------------------------------
  function setLimit(key: RunLimitSpec["key"], limit: string) {
    onChange({ ...value, limits: { ...value.limits, [key]: limit } });
  }

  if (editingAgent === null) {
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
          {value.modelSlots.map((modelSlot, i) => {
            const unused = !referenced.has(modelSlot.name.trim());
            return (
              <div key={i} className={gg.slotBlock}>
                <div className={gg.slotFields}>
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Slot name</span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={modelSlot.name}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateModelSlot(i, { name: e.target.value })
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
                        updateModelSlot(i, { defaultModelId: v })
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
                      onClick={() => removeModelSlot(i)}
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

        {/* Agents — the per-agent profiles. The first is always the Root, which
            drives the run's top-level session and is the default for issue dispatch,
            Code Review, and speculation judging. */}
        <p
          className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
        >
          Agents
        </p>
        <p className={`${runExec.muted} ${gg.backdropNote}`}>
          Each agent has its own capabilities, model, custom prompt, and the set
          of agents it may spawn. Open one to configure it.
        </p>
        <div className={gg.slotList}>
          {value.agents.map((agent, i) => {
            const onCount = CAPABILITIES.filter(
              (c) => agent.capabilities[c.id]?.enabled,
            ).length;
            const modelSummary =
              agent.modelSource === "model-slot"
                ? `slot: ${agent.modelSlot || "—"}`
                : agent.modelId || "no model";
            return (
              <div key={i} className={gg.slotBlock}>
                <div className={gg.slotTop}>
                  <span className={gg.slotName}>
                    <span className={gg.capName}>
                      {agent.name || "unnamed"}
                    </span>
                    <span className={gg.capId}>
                      {onCount} on · {modelSummary}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={runExec.secondary}
                    onClick={() => setEditingAgent(i)}
                    style={{ marginLeft: "auto" }}
                  >
                    {readOnly ? "View" : "Edit"}
                  </button>
                  {!readOnly && i !== 0 && (
                    <button
                      type="button"
                      className={gg.slotRemove}
                      onClick={() => removeAgent(i)}
                      aria-label={`Remove the ${agent.name || "unnamed"} agent`}
                    >
                      ✕
                    </button>
                  )}
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
      </>
    );
  }

  // --- Per-agent view -------------------------------------------------------
  const index = editingAgent;
  const agent = value.agents[index];
  // A guard against a stale index (e.g. the edited agent was removed): fall back to
  // the top-level view rather than crashing.
  if (!agent) {
    setEditingAgent(null);
    return null;
  }
  const isRoot = index === 0;
  const paramsErrors = agentParamErrors(agent);
  const declaredSlots = value.modelSlots.map((s) => s.name.trim());

  const patchAgent = (patch: Partial<GgAgentDraft>) =>
    updateAgent(index, patch);
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
  const toggleSubagent = (target: string, on: boolean) => {
    const others = agent.subagents.filter((s) => s.agent !== target);
    patchAgent({
      subagents: on ? [...others, { agent: target, description: "" }] : others,
    });
  };
  const setSubagentDescription = (target: string, description: string) =>
    patchAgent({
      subagents: agent.subagents.map((s) =>
        s.agent === target ? { ...s, description } : s,
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
      <button
        type="button"
        className={runExec.secondary}
        onClick={() => setEditingAgent(null)}
      >
        ← Back to configuration
      </button>

      <div className={gg.agentHeading}>
        <label className={`${runExec.field} ${gg.slotNameField}`}>
          <span className={runExec.fieldLabel}>Agent name</span>
          <input
            className={runExec.input}
            type="text"
            value={agent.name}
            // The Root's name is fixed — the runtime references it by name.
            disabled={readOnly || isRoot}
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
              value={agent.modelSlot}
              disabled={readOnly}
              onChange={(e) => patchAgent({ modelSlot: e.target.value })}
            >
              {!declaredSlots.includes(agent.modelSlot.trim()) && (
                <option value={agent.modelSlot}>
                  {agent.modelSlot || "(none)"}
                </option>
              )}
              {declaredSlots.map((name) => (
                <option key={name} value={name}>
                  {name}
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
      {agent.modelSource === "model-slot" &&
        !declaredSlots.includes(agent.modelSlot.trim()) && (
          <p className={gg.fieldError}>
            That model slot isn&rsquo;t declared on the configuration.
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
                  // Run-level "which agent runs this?" knobs (issueAgent/reviewer/
                  // judge) are read off the Root agent, so only offer them there.
                  const params = (cap.params ?? []).filter(
                    (p) => p.kind !== "agent" || isRoot,
                  );
                  const hasBody =
                    params.length ||
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
                                    hint={cap.implementationHint}
                                  />
                                  {cap.implementationOptions ? (
                                    <select
                                      className={runExec.select}
                                      value={draft.implementation ?? ""}
                                      disabled={readOnly}
                                      onChange={(e) =>
                                        updateCap(cap.id, {
                                          implementation: e.target.value,
                                        })
                                      }
                                    >
                                      {cap.implementationOptions.map((o) => (
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
                                            value round-trips until re-pointed. */}
                                        {draft.params?.[p.key] &&
                                          !value.agents.some(
                                            (a) =>
                                              a.name === draft.params?.[p.key],
                                          ) && (
                                            <option value={draft.params[p.key]}>
                                              {draft.params[p.key]} (missing)
                                            </option>
                                          )}
                                        {value.agents.map((a) => (
                                          <option key={a.name} value={a.name}>
                                            {a.name}
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
                          {cap.toolAblation?.length ? (
                            <div
                              className={gg.ablationGroup}
                              role="group"
                              aria-label={`${cap.name} features`}
                            >
                              <span className={runExec.fieldLabel}>
                                Features
                              </span>
                              <div className={gg.ablationList}>
                                {cap.toolAblation.map((bundle) => (
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

      {/* Subagents — which other agents this one may spawn, each with caller-scoped
          guidance. An agent may list itself, for recursion. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Subagents
      </p>
      <p className={`${runExec.muted} ${gg.backdropNote}`}>
        The agents this one may spawn (with <code>spawn_subagent</code>,{" "}
        <code>speculate</code>, or <code>run_workflow</code>). Enable a target
        and describe when to use it — the description is what this agent sees.
      </p>
      <div className={gg.subagentList}>
        {value.agents.map((target) => {
          const entry = agent.subagents.find((s) => s.agent === target.name);
          const on = Boolean(entry);
          return (
            <div key={target.name} className={gg.subagentRow}>
              <label className={gg.ablationLabel}>
                <Switch
                  checked={on}
                  disabled={readOnly}
                  onChange={(next) => toggleSubagent(target.name, next)}
                />
                <span className={gg.ablationName}>
                  {target.name}
                  {target.name === agent.name && (
                    <span className={gg.capId}> (self)</span>
                  )}
                </span>
              </label>
              {on && (
                <input
                  className={`${runExec.input} ${gg.subagentDescription}`}
                  type="text"
                  value={entry?.description ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    setSubagentDescription(target.name, e.target.value)
                  }
                  placeholder="when to use this agent"
                />
              )}
            </div>
          );
        })}
      </div>

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
