// The controls one capability's configuration is made of, and the small shared bits of
// chrome the rest of the configuration editor is built from.
//
// These live apart from `GgConfigEditor` because a capability's body is rendered in three
// different frames now: inside a capability row in the Capabilities list, and — for the
// two [mode-marker](isModeCapability) capabilities, which are an [agent
// type](GgAgentMode) rather than a feature — in the settings panel the selected type
// opens. The fields must be the same fields in all three, so there is one of them.

import { useId, type ReactNode } from "react";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { ResetControl } from "../../../components/ResetControl";
import { familyOf } from "../../../data/families";
import {
  authoredImplementation,
  paramApplies,
  type CapSpec,
  type ParamSpec,
} from "./ggCatalog";
import {
  capabilityDraftFor,
  capabilityGrantWarning,
  fsmStatesWarnings,
  isFsmShell,
  statesDraftValue,
  statesFromDraft,
  togglesDraftValue,
  togglesOff,
  featureBundleOn,
  paramDefault,
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

/**
 * A field label with an optional help tooltip beside it, and — while the control it names
 * has been moved off the value it opens at — a {@link ResetControl} to put it back.
 *
 * Every control in these grids is seeded with the figure it would run under, so the value
 * is always in the field and never hidden behind an empty box the operator is expected to
 * know the meaning of. The reset is the other half of that: it is the only thing on the
 * form that says which of the figures on screen are still the authored ones.
 */
export function FieldLabel({
  label,
  hint,
  htmlFor,
  resetLabel,
  modified = false,
  onReset,
}: {
  label: string;
  hint?: string;
  /**
   * The id of the control this names. Given one, the label text is a real `<label for>`
   * and the badges beside it sit outside it; without one the caller is wrapping its own
   * control in a `<label>`, or is naming a group rather than a control.
   */
  htmlFor?: string;
  /**
   * What the reset control names, where the label alone would not say which control it
   * belongs to — a hook's timeout is "Timeout (seconds)" on every hook in the list.
   * Defaults to `label`.
   */
  resetLabel?: string;
  /** Whether the control this labels currently differs from the value it opens at. */
  modified?: boolean;
  onReset?: () => void;
}) {
  return (
    <span className={`${runExec.fieldLabel} ${gg.fieldLabelRow}`}>
      {htmlFor === undefined ? label : <label htmlFor={htmlFor}>{label}</label>}
      {hint && <HelpTip text={hint} />}
      {modified && onReset && (
        <ResetControl label={resetLabel ?? label} onReset={onReset} />
      )}
    </span>
  );
}

/**
 * One field in a capability's param grid: its {@link FieldLabel} over the control, which
 * the field hands an id to.
 *
 * The id is what makes the reset control possible at all. These fields used to be a
 * `<label>` wrapped around their control, which is the shorter spelling and the wrong one
 * here: a `<button>` is a *labelable* element, so a reset sat inside such a label becomes
 * the control the label names, and the input it was meant to name loses its accessible
 * name to it. Naming the control explicitly leaves the label row free to carry whatever
 * badges belong beside a name.
 */
export function CapField({
  label,
  hint,
  className,
  resetLabel,
  modified,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  /** An extra class on the field wrapper, for a control that needs the whole grid row. */
  className?: string;
  resetLabel?: string;
  modified?: boolean;
  onReset?: () => void;
  /** The control, given the id its label points at. */
  children: (controlId: string) => ReactNode;
}) {
  const controlId = useId();
  return (
    <div
      className={
        className ? `${gg.capParamField} ${className}` : gg.capParamField
      }
    >
      <FieldLabel
        label={label}
        hint={hint}
        htmlFor={controlId}
        resetLabel={resetLabel}
        modified={modified}
        onReset={onReset}
      />
      {children(controlId)}
    </div>
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
          one of the slots this agent declares, or name a model outright.
        </p>
      )}
    </div>
  );
}

export interface CapabilityBodyProps {
  /** The capability being configured. */
  cap: CapSpec;
  /** The agent whose configuration this is — its param drafts and its call allowlists. */
  agent: GgAgentDraft;
  /**
   * Every profile in the configuration: an `agent` param picks one, and a machine's
   * states name them, so this control cannot be written against one profile alone.
   */
  agents: ReadonlyArray<GgAgentDraft>;
  /**
   * The slots **this agent** declares — the ones a `model` param may defer to. A model
   * slot belongs to the profile whose bindings name it; the configuration's own slots
   * fill these at launch and are never bound to directly.
   */
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
  /**
   * Grant or take back one [feature bundle](CapSpec.features). It takes the whole bundle
   * rather than a list of names because both vocabularies move together — the caller
   * writes each into its own allowlist.
   */
  onSetFeature: (
    bundle: { tools: ReadonlyArray<string>; operations: ReadonlyArray<string> },
    on: boolean,
  ) => void;
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
  onSetFeature,
}: CapabilityBodyProps) {
  const draft = agent.capabilities[cap.id] ?? capabilityDraftFor(cap.id);
  const implementation = draft.implementation;
  // Run-level "which agent runs this?" knobs (the merge and judge agents) are read off
  // the root agent, so only offer them there — and a param the selected implementation
  // does not read (the compaction model outside a handoff strategy) is not offered at
  // all, rather than sitting there inert.
  const offered = (cap.params ?? []).filter(
    (p) => (p.kind !== "agent" || isRoot) && paramApplies(p, implementation),
  );
  // A boolean param is a feature switch, not a value: it renders with the feature
  // sliders rather than in the param grid.
  const params = offered.filter((p) => p.kind !== "boolean");
  const flags = offered.filter((p) => p.kind === "boolean");
  // A `states` control renders the capability's error itself, beside the rows that have
  // to change; showing it again under the whole form would say the same thing twice,
  // once far from the fix.
  const errorInline = params.some((p) => p.kind === "states");
  // A capability switched on that grants nothing. It counts towards having a body, rather
  // than only being rendered into one that exists for other reasons: the capabilities with
  // the least to configure are the ones whose whole body *is* this warning, and a card
  // that renders nothing is exactly where the silent state would stay silent.
  const grantWarning = capabilityGrantWarning(agent, cap);
  const hasBody =
    params.length ||
    flags.length ||
    cap.implementationLabel ||
    cap.features?.length ||
    error ||
    grantWarning;
  if (!hasBody) return null;

  return (
    <div className={gg.capBody}>
      {(params.length || cap.implementationLabel) && (
        <div className={gg.capParamGrid}>
          {cap.implementationLabel && (
            <CapField
              label={cap.implementationLabel}
              hint={cap.implementationHint}
              modified={
                !readOnly &&
                (implementation ?? "") !== authoredImplementation(cap)
              }
              onReset={() =>
                onUpdateCap({ implementation: authoredImplementation(cap) })
              }
            >
              {(id) =>
                cap.implementationOptions ? (
                  <select
                    id={id}
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
                    id={id}
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
                )
              }
            </CapField>
          )}
          {params.map((p) => {
            if (p.kind === "toggles") {
              const off = togglesOff(p, draft.params?.[p.key]);
              const seeded = paramDefault(p);
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
                    modified={
                      !readOnly &&
                      seeded !== undefined &&
                      (draft.params?.[p.key] ?? "") !== seeded
                    }
                    onReset={
                      seeded === undefined
                        ? undefined
                        : () => onSetParam(p.key, seeded)
                    }
                  />
                  <div className={gg.toggleList}>
                    {(p.options ?? []).map((o) => (
                      // Every member's reason is on hover, including why the odd one out
                      // starts switched off. The label says what the member *is*; which
                      // way it currently sits is the checkbox's job, and annotating a
                      // label with its own initial state only restates the control beside
                      // it — wrongly, the moment the operator moves it.
                      <label
                        key={o.value}
                        className={gg.toggleItem}
                        title={o.hint}
                      >
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
            if (p.kind === "states") {
              return (
                <div key={p.key} className={gg.fsmWrapper}>
                  <FieldLabel label={p.label} hint={p.hint} />
                  <GgFsmStatesField
                    states={statesFromDraft(draft.params?.[p.key])}
                    // The option's value is the profile's internal id, which is what a
                    // state stores; the slug is what it reads as, because that is the name
                    // the operator wrote and the model will be shown.
                    agents={agents.map((a) => ({
                      id: a.id,
                      slug: a.slug,
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
            // The figure this control opens at, and therefore what a reset puts it back
            // to. A param with none — responses-as-code's `language`, whose arm nobody
            // may choose for the operator — offers no reset rather than a reset to a
            // blank, which would read as an answer.
            const seeded = paramDefault(p);
            return (
              <CapField
                key={p.key}
                label={p.label}
                hint={p.hint}
                modified={
                  !readOnly &&
                  seeded !== undefined &&
                  (draft.params?.[p.key] ?? "") !== seeded
                }
                onReset={
                  seeded === undefined
                    ? undefined
                    : () => onSetParam(p.key, seeded)
                }
              >
                {(id) =>
                  p.kind === "select" ? (
                    <select
                      id={id}
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
                      id={id}
                      className={runExec.select}
                      value={draft.params?.[p.key] ?? ""}
                      disabled={readOnly}
                      onChange={(e) => onSetParam(p.key, e.target.value)}
                    >
                      {/* An agent named by a stored param that no longer exists stays
                        selectable so the value round-trips until re-pointed. Live
                        profiles are offered by id, so renaming one never breaks the
                        param — and the id is shown beside the name because two profiles
                        may carry one name, which would leave the operator choosing
                        between two identical labels. */}
                      {draft.params?.[p.key] &&
                        !agents.some((a) => a.id === draft.params?.[p.key]) && (
                          <option value={draft.params[p.key]}>
                            {draft.params[p.key]} (missing)
                          </option>
                        )}
                      {agents.map((a) => (
                        // Stored as the internal id, read as the slug: an `agent` param is a
                        // reference, and the operator picks it by the name they wrote.
                        <option key={a.id} value={a.id}>
                          {a.name || "unnamed"} ({a.slug})
                        </option>
                      ))}
                    </select>
                  ) : p.kind === "text" ? (
                    <input
                      id={id}
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
                      id={id}
                      className={runExec.input}
                      type="number"
                      min={0}
                      max={
                        p.kind === "fraction"
                          ? 1
                          : p.kind === "percent"
                            ? 100
                            : undefined
                      }
                      step={p.kind === "fraction" ? 0.05 : 1}
                      value={draft.params?.[p.key] ?? ""}
                      disabled={readOnly}
                      onChange={(e) => onSetParam(p.key, e.target.value)}
                      placeholder={p.placeholder}
                    />
                  )
                }
              </CapField>
            );
          })}
        </div>
      )}
      {cap.features?.length || flags.length ? (
        <div
          className={gg.featureGroup}
          role="group"
          aria-label={`${cap.name} features`}
        >
          <span className={runExec.fieldLabel}>Features</span>
          <div className={gg.featureList}>
            {(cap.features ?? []).map((bundle) => (
              <div key={bundle.label} className={gg.featureItem}>
                <label className={gg.featureLabel}>
                  <Switch
                    checked={featureBundleOn(agent, bundle)}
                    disabled={readOnly}
                    onChange={(on) => onSetFeature(bundle, on)}
                  />
                  <span className={gg.featureName}>{bundle.label}</span>
                </label>
                {bundle.hint && <HelpTip text={bundle.hint} />}
              </div>
            ))}
            {/* A feature that changes what an offered call demands, rather than which
                calls the agent has: same box, same slider, a capability param behind it. */}
            {flags.map((flag) => (
              <div key={flag.key} className={gg.featureItem}>
                <label className={gg.featureLabel}>
                  <Switch
                    checked={draft.params?.[flag.key] === "true"}
                    disabled={readOnly}
                    // Both states are written down for a required flag, so the slider's
                    // position is the value rather than a deviation from an absent one.
                    onChange={(on) =>
                      onSetParam(flag.key, on ? "true" : "false")
                    }
                  />
                  <span className={gg.featureName}>{flag.label}</span>
                </label>
                {flag.hint && <HelpTip text={flag.hint} />}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* Directly under the sliders, which are what emptied the grant and what puts it
          back. Not folded into the error slot below: the two are about different things —
          a param that cannot be saved, against a capability that saves fine and does
          nothing — so a capability can honestly have both at once. */}
      {grantWarning && <span className={gg.limitWarning}>{grantWarning}</span>}
      {error && !errorInline && <span className={gg.fieldError}>{error}</span>}
    </div>
  );
}
