import type { ReactNode } from "react";
import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  CAPABILITIES,
  CAP_GROUPS,
  COMMON_ROLE_SLOTS,
  PRIMARY_SLOT,
  RUN_LIMIT_SPECS,
  type CapGroup,
  type RunLimitSpec,
} from "./ggCatalog";
import {
  blankCapabilityDraft,
  blankSlot,
  draftParamErrors,
  referencedModelSlots,
  runLimitsError,
  runLimitsWarning,
  setToolBundle,
  togglesDraftValue,
  togglesOff,
  toolBundleOn,
  type GgCapabilityDraft,
  type GgConfigDraft,
  type GgModelSlotDraft,
  type GgSlotDraft,
} from "./ggConfigDraft";
import runExec from "../RunExec.module.scss";
import gg from "./GgConfigEditor.module.scss";

// gg reaches every slot's model through OpenRouter, so a slot must be bound to the
// model's *OpenRouter* slug (`openai/gpt-5.6-sol`), never a provider-native one
// (`gpt-5.6-sol`, which only the Codex CLI answers to). Scoping the picker to this
// family makes it commit the right alias for a model catalogued under several.
const GG_MODEL_FAMILY = familyOf("gg");

// The `step` a ceiling's number input moves in: whole turns/seconds/errors for a
// count, a twentieth for a rate, and anything at all for money — a cost ceiling of
// 12.50 must be typeable, and a stepped money input rejects it in browsers that
// validate against the step.
function limitStep(kind: RunLimitSpec["kind"]): number | "any" {
  if (kind === "count") return 1;
  return kind === "fraction" ? 0.05 : "any";
}

// A "?" affordance whose help text appears in a custom on-hover/focus tooltip rather
// than a permanent subtitle — the details that used to sit under every field, kept
// out of the way until asked for. Focusable and labelled so it reads to AT too.
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

// A field label with an optional help tooltip beside it, used by every control that
// carries an explanation. Keeps the tooltip and the label caption on one line.
function FieldLabel({ label, hint }: { label: ReactNode; hint?: string }) {
  return (
    <span className={runExec.fieldLabel}>
      {label}
      {hint && <HelpTip text={hint} />}
    </span>
  );
}

// The capability enable control: a slider switch rather than a checkbox, so turning
// a capability on reads as flipping it live and reveals its config beneath. Kept as
// a real `<input type="checkbox">` (only its chrome is the slider) so it stays a
// checkbox to assistive tech and to the test suite.
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
  /** The model catalog backing the per-slot pickers (free text is still allowed). */
  models: Model[];
  /** Which capability groups start collapsed, and the toggle for that state. */
  collapsed: ReadonlySet<CapGroup>;
  onToggleGroup: (group: CapGroup) => void;
  /**
   * Render every control disabled — how a built-in configuration is shown, since
   * those are shared and read-only (duplicate one to make it yours).
   */
  readOnly?: boolean;
}

// The gg capability-set editor: the run's execution ceilings, the full capability
// catalog grouped by concern, the declared model slots and the role bindings that
// consume them. Per-tool ablation lives inside each capability now (its expanded
// config), not in a section of its own — a capability's sub-features are what a
// study varies, so they belong with the capability that owns them.
//
// This is the one authoring surface for a gg configuration — the account section's
// gg tab mounts it to register a named configuration, and it renders read-only when
// showing a built-in. It is deliberately *not* a launcher: a configuration carries
// no test case, and the models it does not pin outright are declared as *model
// slots* the new-run form asks for when it launches the configuration (see
// `launchModelSlots` / `bindModelSlots`).
export function GgConfigEditor({
  value,
  onChange,
  models,
  collapsed,
  onToggleGroup,
  readOnly = false,
}: GgConfigEditorProps) {
  const paramsErrors = draftParamErrors(value);

  // --- Capability mutators --------------------------------------------------
  function updateDraft(id: string, patch: Partial<GgCapabilityDraft>) {
    onChange({
      ...value,
      capabilities: {
        ...value.capabilities,
        [id]: {
          ...(value.capabilities[id] ?? blankCapabilityDraft()),
          ...patch,
        },
      },
    });
  }
  function setParam(id: string, key: string, param: string) {
    const base = value.capabilities[id] ?? blankCapabilityDraft();
    updateDraft(id, { params: { ...(base.params ?? {}), [key]: param } });
  }

  // --- Run-limit mutator ----------------------------------------------------
  function setLimit(key: RunLimitSpec["key"], limit: string) {
    onChange({ ...value, limits: { ...value.limits, [key]: limit } });
  }

  // --- Model-slot (launch parameter) mutators -------------------------------
  function updateModelSlot(index: number, patch: Partial<GgModelSlotDraft>) {
    const previous = value.modelSlots[index];
    const next = value.modelSlots.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    // Renaming a declaration must carry every role bound to it along, or the rename
    // would silently orphan them.
    const renamed =
      patch.name !== undefined && previous && patch.name !== previous.name;
    onChange({
      ...value,
      modelSlots: next,
      slots: renamed
        ? value.slots.map((s) =>
            s.source === "model-slot" && s.modelSlot === previous.name
              ? { ...s, modelSlot: patch.name! }
              : s,
          )
        : value.slots,
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

  // --- Role-binding mutators ------------------------------------------------
  function updateSlot(index: number, patch: Partial<GgSlotDraft>) {
    onChange({
      ...value,
      slots: value.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }
  function addSlot() {
    onChange({
      ...value,
      slots: [
        ...value.slots,
        // Default a new role to the first declared model slot, so the common case
        // ("another role on a model I pick at launch") needs one more click, not four.
        {
          ...blankSlot(),
          modelSlot: value.modelSlots[0]?.name ?? PRIMARY_SLOT,
        },
      ],
    });
  }
  function removeSlot(index: number) {
    onChange({ ...value, slots: value.slots.filter((_, i) => i !== index) });
  }

  // --- Tool-ablation mutator ------------------------------------------------
  // A capability's per-feature slider withholds or restores a whole tool bundle at
  // once; the wire format stays per-tool (`disabledTools`).
  function setToolAblation(tools: ReadonlyArray<string>, on: boolean) {
    onChange({
      ...value,
      disabledTools: setToolBundle(value.disabledTools, tools, on),
    });
  }

  // The declared model slots, and which of them a role actually binds — a slot
  // nothing consumes is dead weight the launch form will never ask about, so the
  // editor says so rather than letting it look wired up.
  const declaredNames = value.modelSlots.map((s) => s.name.trim());
  const referenced = referencedModelSlots(value);

  // The ceilings are checked as a set rather than per field: the rate ceiling's two
  // halves are only meaningful together, so "which field is wrong" is not always a
  // question with an answer.
  const limitsError = runLimitsError(value.limits);
  const limitsWarning = runLimitsWarning(value.limits);

  return (
    <>
      {/* Run limits — the operator's guardrails, deliberately not capabilities:
          they apply to every capability and to both execution modes at once, so
          they sit above the catalog rather than inside a group of it. Panelled into
          their own widget so the fields read against a surface, not the backdrop. */}
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

      {/* The full capability catalog, grouped by concern, collapsible. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Capabilities
      </p>
      {CAP_GROUPS.map(({ group }) => {
        const groupCaps = CAPABILITIES.filter((c) => c.group === group);
        const isCollapsed = collapsed.has(group);
        const onCount = groupCaps.filter(
          (c) => value.capabilities[c.id]?.enabled,
        ).length;
        return (
          <div key={group} className={gg.group}>
            <button
              type="button"
              className={gg.groupHeader}
              onClick={() => onToggleGroup(group)}
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
                    value.capabilities[cap.id] ?? blankCapabilityDraft();
                  const enabled = Boolean(draft.enabled);
                  const error = paramsErrors[cap.id];
                  const hasBody =
                    cap.params?.length ||
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
                            updateDraft(cap.id, { enabled: next })
                          }
                        />
                        <span className={gg.capName}>{cap.name}</span>
                        <span className={gg.capId}>{cap.id}</span>
                      </label>
                      <p className={gg.capPurpose}>{cap.purpose}</p>
                      {enabled && hasBody && (
                        <div className={gg.capBody}>
                          {(cap.params?.length || cap.implementationLabel) && (
                            <div className={gg.capParamGrid}>
                              {cap.implementationLabel && (
                                <label className={gg.capParamField}>
                                  <FieldLabel
                                    label={cap.implementationLabel}
                                    hint={cap.implementationHint}
                                  />
                                  {/* A closed set of implementations is a picker, so
                                      an operator never has to remember how a mode is
                                      spelled; an open-ended one stays free text. */}
                                  {cap.implementationOptions ? (
                                    <select
                                      className={runExec.select}
                                      value={draft.implementation ?? ""}
                                      disabled={readOnly}
                                      onChange={(e) =>
                                        updateDraft(cap.id, {
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
                                        updateDraft(cap.id, {
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
                              {(cap.params ?? []).map((p) => {
                                // A toggles param is several controls, so it is a
                                // group rather than a `<label>` — wrapping a set of
                                // checkboxes in one label would make clicking the
                                // group's caption flip whichever one came first.
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
                          {/* Per-feature ablation: withhold a sub-feature of this
                              capability without turning the whole thing off. Each
                              slider covers a bundle of tools that move together. */}
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
                                    {/* The label wraps the switch + name (so its
                                        accessible name is the feature and clicking
                                        the name toggles it); the help tip sits
                                        outside, or a click on it would flip the
                                        switch too. */}
                                    <label className={gg.ablationLabel}>
                                      <Switch
                                        checked={toolBundleOn(
                                          value.disabledTools,
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

      {/* Model slots — the launch-time model parameters. Declaring them is what
          keeps one configuration reusable across models: the New run page asks for
          these, pre-filled with any default, and never asks about a role this
          configuration pinned itself. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Model slots
      </p>
      <p className={`${runExec.muted} ${gg.backdropNote}`}>
        The models this configuration asks for at launch. Give each a name the
        launch form can label, and an optional default. Roles below bind to
        these by name.
        <HelpTip text="A slot lets two roles share one launch input — and a role bound to a slot with a default starts on that model unless the launcher overrides it." />
      </p>
      <div className={gg.slotList}>
        {value.modelSlots.map((modelSlot, i) => {
          const unused = !referenced.has(modelSlot.name.trim());
          return (
            <div key={i} className={gg.slotBlock}>
              {/* Slot name and its optional default model on one row, with the
                  remove control aligned to their bottom edge. */}
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
                    onChange={(v) => updateModelSlot(i, { defaultModelId: v })}
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
                  No role binds this slot, so launching will never ask for it.
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

      {/* Role bindings — every model the configuration needs, each taken from a
          declared model slot or pinned outright here. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Role bindings
      </p>
      <p className={`${runExec.muted} ${gg.backdropNote}`}>
        Every model this configuration needs, by the role capabilities reference
        it by. A role from a model slot is chosen at launch; one pinned to a
        specific model is fixed here and never surfaces on the New run page
        again.
      </p>
      <datalist id="gg-role-slots">
        {COMMON_ROLE_SLOTS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className={gg.slotList}>
        {value.slots.map((slot, i) => {
          const isPrimary = slot.slot === PRIMARY_SLOT && i === 0;
          const fromModelSlot = slot.source === "model-slot";
          const dangling =
            fromModelSlot && !declaredNames.includes(slot.modelSlot.trim());
          return (
            <div key={i} className={gg.slotBlock}>
              {/* Row 1: the role identity only. "Model from" and the model control
                  drop to their own row below, so a stacked label+input never sits
                  beside the single-line role caption. */}
              <div className={gg.slotTop}>
                {isPrimary ? (
                  <span className={gg.slotName}>
                    <span className={gg.capName}>primary</span>
                    <span className={gg.capId}>
                      the model that drives the run
                    </span>
                  </span>
                ) : (
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Role</span>
                    <input
                      className={runExec.input}
                      type="text"
                      list="gg-role-slots"
                      value={slot.slot}
                      disabled={readOnly}
                      onChange={(e) => updateSlot(i, { slot: e.target.value })}
                      placeholder="e.g. reviewer"
                    />
                  </label>
                )}
                {!isPrimary && !readOnly && (
                  <button
                    type="button"
                    className={gg.slotRemove}
                    onClick={() => removeSlot(i)}
                    aria-label={`Remove the ${slot.slot || "unnamed"} role`}
                  >
                    ✕
                  </button>
                )}
              </div>
              {/* Row 2: "Model from" beside the model (or model-slot) control it
                  governs, both label+input pairs of equal height. */}
              <div className={gg.slotFields}>
                <label className={`${runExec.field} ${gg.slotSourceField}`}>
                  <span className={runExec.fieldLabel}>Model from</span>
                  <select
                    className={runExec.select}
                    value={slot.source}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateSlot(i, {
                        source: e.target.value as GgSlotDraft["source"],
                      })
                    }
                  >
                    <option value="model-slot">a model slot (at launch)</option>
                    <option value="model">a specific model (fixed here)</option>
                  </select>
                </label>
                {fromModelSlot ? (
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>Model slot</span>
                    <select
                      className={runExec.select}
                      value={slot.modelSlot}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateSlot(i, { modelSlot: e.target.value })
                      }
                    >
                      {dangling && (
                        <option value={slot.modelSlot}>
                          {slot.modelSlot || "(none)"}
                        </option>
                      )}
                      {declaredNames.map((name) => (
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
                      value={slot.modelId}
                      onChange={(v) => updateSlot(i, { modelId: v })}
                      models={models}
                      harnessFamily={GG_MODEL_FAMILY}
                      inputClassName={runExec.input}
                      disabled={readOnly}
                      placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                    />
                  </label>
                )}
              </div>
              {dangling && (
                <span className={gg.fieldError}>
                  That model slot isn&rsquo;t declared above.
                </span>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <button type="button" className={runExec.secondary} onClick={addSlot}>
            + Add role binding
          </button>
        )}
        {!value.capabilities["multi-model"]?.enabled &&
          value.slots.length > 1 && (
            <p className={`${runExec.muted} ${gg.backdropNote}`}>
              Extra roles resolve only when the <code>multi-model</code>{" "}
              capability is on — with it off, every agent falls back to the
              primary slot.
            </p>
          )}
      </div>
    </>
  );
}
