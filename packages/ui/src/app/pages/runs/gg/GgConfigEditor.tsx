import { useEffect, useState } from "react";
import type { Model } from "../../../../client/types";
import {
  AGENT_MODES,
  RUN_LIMIT_SPECS,
  capabilitiesForMode,
  type RunLimitSpec,
} from "./ggCatalog";
import { FieldLabel, HelpTip } from "./GgCapabilityFields";
import { GgAgentEditor } from "./GgAgentEditor";
import { GgEditorTabs, type GgEditorTab } from "./GgEditorTabs";
import { GgHookList } from "./GgHookRows";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  agentStates,
  blankAgentDraft,
  blankModelSlot,
  capabilityActive,
  dropAgentReferences,
  referencedModelSlots,
  runLimitsError,
  runLimitsWarning,
  seedAgentParams,
  unusedAgentName,
  type GgAgentDraft,
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
   * The [id](GgAgentDraft.id) of the agent whose per-agent view is open, or `null` for
   * the configuration itself. Owned by the page rather than here, because which view is
   * open decides what the page shows around the editor: Save configuration belongs to
   * the configuration, and Cancel / Save agent to an agent.
   */
  editingAgentId: string | null;
  /** Open an agent's view (or return to the configuration with `null`). */
  onEditingAgentChange: (agentId: string | null) => void;
  /** The model catalog backing the pickers (free text is still allowed). */
  models: Model[];
  /** Render every control disabled. */
  readOnly?: boolean;
}

// The gg capability-set editor.
//
// The configuration itself is three sections — what it *is* (its name, its purpose and
// the ceilings every agent runs under), the model slots it asks for at launch, and its
// list of **agent profiles** — and opening a profile switches the whole editor to that
// agent's own tabbed view.
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
  name,
  onNameChange,
  description,
  onDescriptionChange,
  editingAgentId,
  onEditingAgentChange,
  models,
  readOnly = false,
}: GgConfigEditorProps) {
  const [tab, setTab] = useState<ConfigTab>("configuration");

  // A guard against a stale id (the open agent was removed out from under the view):
  // fall back to the configuration rather than rendering nothing at all.
  const openAgentExists = value.agents.some((a) => a.id === editingAgentId);
  useEffect(() => {
    if (editingAgentId !== null && !openAgentExists) onEditingAgentChange(null);
  }, [editingAgentId, openAgentExists, onEditingAgentChange]);

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
      <GgAgentEditor
        config={value}
        agent={openAgent}
        onPatch={(patch) => updateAgent(openAgent.id, patch)}
        models={models}
        readOnly={readOnly}
      />
    );
  }

  const limitsError = runLimitsError(value.limits);
  const limitsWarning = runLimitsWarning(value.limits);
  const referenced = referencedModelSlots(value);
  const unusedSlots = value.modelSlots.filter(
    (slot) => !referenced.has(slot.id),
  ).length;

  // What is wrong on each tab, so a fault stays findable from whichever tab is open.
  const tabs: GgEditorTab<ConfigTab>[] = CONFIG_TABS.map(({ key, label }) => ({
    key,
    label,
    problems:
      key === "configuration"
        ? (name.trim() ? 0 : 1) + (limitsError ? 1 : 0)
        : key === "slots"
          ? unusedSlots
          : value.agents.length === 0
            ? 1
            : 0,
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

          {/* Session hooks — the run's own two ends. Only these two live here: every
              other event fires because a particular agent wrote, ran, compacted, started
              or stopped, and is declared on that agent. These two have no agent they
              could belong to — the run has not started when the first fires and has
              finished when the second does. */}
          <section className={gg.limitsWidget}>
            <p className={runExec.sectionLabel}>
              Session hooks
              <HelpTip text="Commands and scripts gg runs at the run's two ends: before the root agent's first turn, and after its last. Session start may put text in front of the root; session end can neither block nor insert — it is where a run reports on itself. The model is never told a hook exists." />
            </p>
            <p className={runExec.muted}>
              These fire <strong>once per run</strong>. The hooks that fire
              around a file write, a shell command, a compaction, or an
              agent&rsquo;s own start and stop belong to the agent that provoked
              them — configure those on the agent, under its Hooks tab.
            </p>
            <GgHookList
              hooks={value.hooks}
              scope="session"
              readOnly={readOnly}
              onChange={(hooks: GgHookDraft[]) => onChange({ ...value, hooks })}
              emptyNote="No session hooks. A run without them behaves exactly as it always has — this is the control arm every scripted run is read against."
            />
          </section>
        </>
      )}

      {tab === "slots" && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            Model slots
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            The models this configuration asks for at launch. Give each a name
            the launch form can label, and an optional default. Agents bind to
            these by name, which is what keeps one configuration reusable across
            models.
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
                          updateModelSlot(modelSlot.id, {
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
            {value.modelSlots.length === 0 && (
              <p className={`${runExec.muted} ${gg.backdropNote}`}>
                No model slots. Every agent must then pin its own model here,
                rather than being handed one at launch.
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
        </>
      )}

      {tab === "agents" && (
        <>
          <p
            className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
          >
            Agents
          </p>
          <p className={`${runExec.muted} ${gg.backdropNote}`}>
            Each agent has its own type and — where its type is a worker&rsquo;s
            — its capabilities, model, custom prompt, hooks, and the set of
            agents it may spawn. Open one to configure it. The{" "}
            <strong>root</strong> agent drives the run&rsquo;s top-level
            session; make another one the root at any time.
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
                        {agent.hooks.length
                          ? ` · ${agent.hooks.length} ${agent.hooks.length === 1 ? "hook" : "hooks"}`
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
              This configuration has no agents. Add at least one before saving
              it.
            </p>
          )}
        </>
      )}
    </>
  );
}
