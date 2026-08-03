// The controls one capability's configuration is made of, and the small shared bits of
// chrome the rest of the configuration editor is built from.
//
// These live apart from `GgConfigEditor` because a capability's body is rendered in three
// different frames now: inside a capability row in the Capabilities list, and — for the
// two [mode-marker](isModeCapability) capabilities, which are an [agent
// type](GgAgentMode) rather than a feature — in the settings panel the selected type
// opens. The fields must be the same fields in all three, so there is one of them.

import type { ReactNode } from "react";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import { paramApplies, type CapSpec, type ParamSpec } from "./ggCatalog";
import {
  blankCapabilityDraft,
  blankCommandDraft,
  commandsDraftValue,
  commandsFromDraft,
  fsmStatesWarnings,
  isFsmShell,
  statesDraftValue,
  statesFromDraft,
  togglesDraftValue,
  togglesOff,
  toolBundleOn,
  type CommandDraft,
  type GgAgentDraft,
  type GgCapabilityDraft,
  type GgModelSlotDraft,
} from "./ggConfigDraft";
import { GgFsmStatesField } from "./GgFsmStatesField";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

// gg reaches every model through OpenRouter, so a binding must name the model's
// *OpenRouter* slug (`openai/gpt-5.6-sol`). Scoping the picker to this family makes it
// commit the right alias for a model catalogued under several.
const GG_MODEL_FAMILY = familyOf("gg");

// A "?" affordance whose help text appears in a custom on-hover/focus tooltip.
export function HelpTip({ text }: { text: string }) {
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
export function FieldLabel({
  label,
  hint,
}: {
  label: ReactNode;
  hint?: string;
}) {
  return (
    <span className={runExec.fieldLabel}>
      {label}
      {hint && <HelpTip text={hint} />}
    </span>
  );
}

// The capability enable control: a slider switch that stays a real checkbox to AT and
// to the test suite.
export function Switch({
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

/**
 * A [`model` param](ParamSpec)'s control: the same two-field binding an agent's own model
 * uses, so "which model condenses the thread" is picked the way every other model in the
 * configuration is — from a slot the launch form fills in, or pinned here.
 *
 * The param defers to a slot exactly while its [slot key](ParamSpec.slotKey) is *present*
 * in the draft, empty or not: an operator who has chosen to defer but not yet picked a
 * slot is a real state the form has to hold (and flag), not one it should silently
 * collapse back into a pinned model.
 */
function ModelParamField({
  param,
  slotKey,
  params,
  modelSlots,
  models,
  readOnly,
  onSet,
  onClear,
}: {
  param: ParamSpec;
  slotKey: string;
  params: Record<string, string>;
  modelSlots: ReadonlyArray<GgModelSlotDraft>;
  models: Model[];
  readOnly?: boolean;
  onSet: (key: string, value: string) => void;
  onClear: (key: string) => void;
}) {
  const deferred = slotKey in params;
  const slotId = params[slotKey] ?? "";
  const boundSlot = modelSlots.find((s) => s.id === slotId);
  return (
    <div className={`${gg.capParamField} ${gg.modelParamField}`}>
      <FieldLabel label={param.label} hint={param.hint} />
      <div className={gg.slotFields}>
        <label className={`${runExec.field} ${gg.slotSourceField}`}>
          <span className={runExec.fieldLabel}>Model from</span>
          <select
            className={runExec.select}
            value={deferred ? "model-slot" : "model"}
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value === "model-slot") {
                onSet(slotKey, modelSlots[0]?.id ?? "");
              } else {
                onClear(slotKey);
              }
            }}
          >
            <option value="model-slot">a model slot (at launch)</option>
            <option value="model">a specific model (fixed here)</option>
          </select>
        </label>
        {deferred ? (
          <label className={`${runExec.field} ${gg.slotModelField}`}>
            <span className={runExec.fieldLabel}>Model slot</span>
            <select
              className={runExec.select}
              value={slotId}
              disabled={readOnly}
              onChange={(e) => onSet(slotKey, e.target.value)}
            >
              {!boundSlot && <option value={slotId}>(none)</option>}
              {modelSlots.map((slot) => (
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
              value={params[param.key] ?? ""}
              onChange={(v) => onSet(param.key, v)}
              models={models}
              harnessFamily={GG_MODEL_FAMILY}
              inputClassName={runExec.input}
              disabled={readOnly}
              placeholder={param.placeholder}
            />
          </label>
        )}
      </div>
      {deferred && !boundSlot && (
        <p className={gg.fieldError}>
          This defers to no model slot, so a run would never fill it in. Pick
          one of the configuration&rsquo;s slots, or name a model outright.
        </p>
      )}
    </div>
  );
}

export interface CapabilityBodyProps {
  /** The capability being configured. */
  cap: CapSpec;
  /** The agent whose configuration this is — its param drafts and its tool ablation. */
  agent: GgAgentDraft;
  /**
   * Every profile in the configuration: an `agent` param picks one, and a machine's
   * states name them, so this control cannot be written against one profile alone.
   */
  agents: ReadonlyArray<GgAgentDraft>;
  modelSlots: ReadonlyArray<GgModelSlotDraft>;
  models: Model[];
  /**
   * Whether `agent` is the configuration's root. The run-level "which agent runs this?"
   * knobs are read off the root, so they are offered only there.
   */
  isRoot: boolean;
  readOnly: boolean;
  /** This capability's param error, or null/undefined when it has none. */
  error?: string | null;
  onUpdateCap: (patch: Partial<GgCapabilityDraft>) => void;
  onSetParam: (key: string, value: string) => void;
  /**
   * Drop a param key entirely, which is a different state from setting it empty: a
   * `model` param defers to a slot exactly while its slot key is *present*, so "pin a
   * model instead" has to remove the key rather than blank it.
   */
  onClearParam: (key: string) => void;
  onSetToolAblation: (tools: ReadonlyArray<string>, on: boolean) => void;
}

/**
 * One capability's whole configuration: its implementation picker, its dedicated param
 * controls, its per-feature sliders, and its error slot. `null` when the capability has
 * nothing to configure, so a caller can render it unconditionally.
 */
export function CapabilityBody({
  cap,
  agent,
  agents,
  modelSlots,
  models,
  isRoot,
  readOnly,
  error,
  onUpdateCap,
  onSetParam,
  onClearParam,
  onSetToolAblation,
}: CapabilityBodyProps) {
  const draft = agent.capabilities[cap.id] ?? blankCapabilityDraft();
  const implementation = draft.implementation;
  // Run-level "which agent runs this?" knobs (the merge and judge agents) are read off
  // the root agent, so only offer them there — and a param the selected implementation
  // does not read (the compaction model outside a handoff strategy) is not offered at
  // all, rather than sitting there inert.
  const offered = (cap.params ?? []).filter(
    (p) => (p.kind !== "agent" || isRoot) && paramApplies(p, implementation),
  );
  // A boolean param is a feature switch, not a value: it renders with the tool-ablation
  // sliders rather than in the param grid.
  const params = offered.filter((p) => p.kind !== "boolean");
  const flags = offered.filter((p) => p.kind === "boolean");
  // A `states` control renders the capability's error itself, beside the rows that have
  // to change; showing it again under the whole form would say the same thing twice,
  // once far from the fix.
  const errorInline = params.some((p) => p.kind === "states");
  const hasBody =
    params.length ||
    flags.length ||
    cap.implementationLabel ||
    cap.toolAblation?.length ||
    error;
  if (!hasBody) return null;

  return (
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
                  value={implementation ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    onUpdateCap({ implementation: e.target.value })
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
                    onUpdateCap({ implementation: e.target.value })
                  }
                  placeholder={cap.implementationPlaceholder ?? "default"}
                  spellCheck={false}
                />
              )}
            </label>
          )}
          {params.map((p) => {
            if (p.kind === "toggles") {
              const off = togglesOff(p, draft.params?.[p.key]);
              return (
                <div
                  key={p.key}
                  className={`${gg.capParamField} ${gg.toggleField}`}
                  role="group"
                  aria-label={p.label}
                >
                  <FieldLabel label={p.label} hint={p.hint} />
                  <div className={gg.toggleList}>
                    {(p.options ?? []).map((o) => (
                      <label key={o.value} className={gg.toggleItem}>
                        <input
                          type="checkbox"
                          checked={!off.includes(o.value)}
                          disabled={readOnly}
                          onChange={(e) =>
                            onSetParam(
                              p.key,
                              togglesDraftValue(
                                p,
                                e.target.checked
                                  ? off.filter((id) => id !== o.value)
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
              const rows = commandsFromDraft(draft.params?.[p.key]);
              const setRows = (next: ReadonlyArray<CommandDraft>) =>
                onSetParam(p.key, commandsDraftValue(next));
              return (
                <div
                  key={p.key}
                  className={`${gg.capParamField} ${gg.commandField}`}
                  role="group"
                  aria-label={p.label}
                >
                  <FieldLabel label={p.label} hint={p.hint} />
                  <div className={gg.commandList}>
                    {rows.map((row, i) => (
                      // Keyed by position: a row has no identity of its own, and
                      // reordering is not offered — the commands run in the order they
                      // are listed.
                      <div key={i} className={gg.commandRow}>
                        <input
                          className={`${runExec.input} ${gg.commandLine}`}
                          type="text"
                          value={row.command}
                          disabled={readOnly}
                          aria-label={`Command ${i + 1}`}
                          onChange={(e) =>
                            setRows(
                              rows.map((r, j) =>
                                j === i ? { ...r, command: e.target.value } : r,
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
                                j === i ? { ...r, cwd: e.target.value } : r,
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
                                  ? { ...r, timeoutSecs: e.target.value }
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
                              setRows(rows.filter((_, j) => j !== i))
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
                        onClick={() => setRows([...rows, blankCommandDraft()])}
                      >
                        + Add command
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            if (p.kind === "states") {
              return (
                <div key={p.key} className={gg.fsmWrapper}>
                  <FieldLabel label={p.label} hint={p.hint} />
                  <GgFsmStatesField
                    states={statesFromDraft(draft.params?.[p.key])}
                    agents={agents.map((a) => ({
                      id: a.id,
                      name: a.name,
                      machine: isFsmShell(a),
                    }))}
                    readOnly={readOnly}
                    // The machine's structural fault reads here, beside the rows that
                    // have to change, rather than in the capability's shared error slot
                    // below the whole form.
                    error={error}
                    warnings={fsmStatesWarnings(agent, agents)}
                    onChange={(next) =>
                      onSetParam(p.key, statesDraftValue(next))
                    }
                  />
                </div>
              );
            }
            if (p.kind === "model" && p.slotKey) {
              return (
                <ModelParamField
                  key={p.key}
                  param={p}
                  slotKey={p.slotKey}
                  params={draft.params ?? {}}
                  modelSlots={modelSlots}
                  models={models}
                  readOnly={readOnly}
                  onSet={onSetParam}
                  onClear={onClearParam}
                />
              );
            }
            return (
              <label key={p.key} className={gg.capParamField}>
                <FieldLabel label={p.label} hint={p.hint} />
                {p.kind === "select" ? (
                  <select
                    className={runExec.select}
                    value={draft.params?.[p.key] ?? ""}
                    disabled={readOnly}
                    onChange={(e) => onSetParam(p.key, e.target.value)}
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
                    onChange={(e) => onSetParam(p.key, e.target.value)}
                  >
                    {/* An agent named by a stored param that no longer exists stays
                        selectable so the value round-trips until re-pointed. Live
                        profiles are offered by id, so renaming one never breaks the
                        param. */}
                    {draft.params?.[p.key] &&
                      !agents.some((a) => a.id === draft.params?.[p.key]) && (
                        <option value={draft.params[p.key]}>
                          {draft.params[p.key]} (missing)
                        </option>
                      )}
                    {agents.map((a) => (
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
                    onChange={(e) => onSetParam(p.key, e.target.value)}
                    placeholder={p.placeholder}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    className={runExec.input}
                    type="number"
                    min={0}
                    max={p.kind === "fraction" ? 1 : undefined}
                    step={p.kind === "fraction" ? 0.05 : 1}
                    value={draft.params?.[p.key] ?? ""}
                    disabled={readOnly}
                    onChange={(e) => onSetParam(p.key, e.target.value)}
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
          <span className={runExec.fieldLabel}>Features</span>
          <div className={gg.ablationList}>
            {(cap.toolAblation ?? []).map((bundle) => (
              <div key={bundle.label} className={gg.ablationItem}>
                <label className={gg.ablationLabel}>
                  <Switch
                    checked={toolBundleOn(agent.disabledTools, bundle.tools)}
                    disabled={readOnly}
                    onChange={(on) => onSetToolAblation(bundle.tools, on)}
                  />
                  <span className={gg.ablationName}>{bundle.label}</span>
                </label>
                {bundle.hint && <HelpTip text={bundle.hint} />}
              </div>
            ))}
            {/* A feature that changes what an offered tool demands, rather than which
                tools exist: same box, same slider, a capability param behind it. */}
            {flags.map((flag) => (
              <div key={flag.key} className={gg.ablationItem}>
                <label className={gg.ablationLabel}>
                  <Switch
                    checked={draft.params?.[flag.key] === "true"}
                    disabled={readOnly}
                    onChange={(on) => onSetParam(flag.key, on ? "true" : "")}
                  />
                  <span className={gg.ablationName}>{flag.label}</span>
                </label>
                {flag.hint && <HelpTip text={flag.hint} />}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {error && !errorInline && <span className={gg.fieldError}>{error}</span>}
    </div>
  );
}
