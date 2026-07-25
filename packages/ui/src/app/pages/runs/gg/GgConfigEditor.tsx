import type { Model } from "../../../../client/types";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { familyOf } from "../../../data/families";
import {
  CAPABILITIES,
  CAP_GROUPS,
  COMMON_ROLE_SLOTS,
  MOCK_MODEL_ID,
  MOCK_PROVIDER,
  PRIMARY_SLOT,
  type CapGroup,
} from "./ggCatalog";
import {
  blankCapabilityDraft,
  blankSlot,
  draftParamErrors,
  referencedModelSlots,
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

// The gg capability-set editor: the full capability catalog grouped by concern, the
// declared model slots and the role bindings that consume them, and the per-tool
// ablation overrides.
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
      modelSlots: [
        ...value.modelSlots,
        { name: "", defaultModelId: "", provider: "" },
      ],
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

  // --- Toolset-ablation mutator ---------------------------------------------
  function toggleToolDisabled(tool: string, disabled: boolean) {
    onChange({
      ...value,
      disabledTools: disabled
        ? [...new Set([...value.disabledTools, tool])]
        : value.disabledTools.filter((t) => t !== tool),
    });
  }

  // Capabilities that offer tools, for the toolset-ablation surface.
  const ablatableCaps = CAPABILITIES.filter(
    (c) => c.tools && c.tools.length > 0,
  );

  // The declared model slots, and which of them a role actually binds — a slot
  // nothing consumes is dead weight the launch form will never ask about, so the
  // editor says so rather than letting it look wired up.
  const declaredNames = value.modelSlots.map((s) => s.name.trim());
  const referenced = referencedModelSlots(value);

  return (
    <>
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
                  return (
                    <div
                      key={cap.id}
                      className={`${gg.capRow}${enabled ? "" : ` ${gg.capOff}`}`}
                    >
                      <label className={gg.capHeader}>
                        <input
                          className={gg.capCheckbox}
                          type="checkbox"
                          checked={enabled}
                          disabled={readOnly}
                          onChange={(e) =>
                            updateDraft(cap.id, { enabled: e.target.checked })
                          }
                        />
                        <span className={gg.capName}>{cap.name}</span>
                        <span className={gg.capId}>{cap.id}</span>
                      </label>
                      <p className={gg.capPurpose}>{cap.purpose}</p>
                      {enabled && (
                        <div className={gg.capBody}>
                          {(cap.params?.length || cap.implementationLabel) && (
                            <div className={gg.capParamGrid}>
                              {cap.implementationLabel && (
                                <label className={gg.capParamField}>
                                  <span className={runExec.fieldLabel}>
                                    {cap.implementationLabel}
                                  </span>
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
                              {(cap.params ?? []).map((p) => (
                                <label key={p.key} className={gg.capParamField}>
                                  <span className={runExec.fieldLabel}>
                                    {p.label}
                                  </span>
                                  {p.kind === "select" ? (
                                    <select
                                      className={runExec.select}
                                      value={draft.params?.[p.key] ?? ""}
                                      disabled={readOnly}
                                      onChange={(e) =>
                                        setParam(cap.id, p.key, e.target.value)
                                      }
                                    >
                                      {(p.options ?? []).map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
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
                                        setParam(cap.id, p.key, e.target.value)
                                      }
                                      placeholder={p.placeholder}
                                    />
                                  )}
                                  {p.hint && (
                                    <span className={gg.paramHint}>
                                      {p.hint}
                                    </span>
                                  )}
                                </label>
                              ))}
                            </div>
                          )}
                          <details className={gg.advancedParams}>
                            <summary className={gg.advancedSummary}>
                              Advanced params (JSON)
                            </summary>
                            <textarea
                              className={`${runExec.textarea} ${gg.paramsInput}`}
                              value={draft.paramsText}
                              disabled={readOnly}
                              onChange={(e) =>
                                updateDraft(cap.id, {
                                  paramsText: e.target.value,
                                })
                              }
                              placeholder={'e.g. { "customKnob": 3 }'}
                              spellCheck={false}
                            />
                          </details>
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
      <p className={runExec.muted}>
        The models this configuration asks for when a run is launched from it.
        Give each one a name the launch form can label — <code>primary</code>,{" "}
        <code>critic</code>, … — and, if you like, a default it starts on. Roles
        below bind to these by name, so two roles can share one launch input.
      </p>
      <div className={gg.slotList}>
        {value.modelSlots.map((modelSlot, i) => {
          const unused = !referenced.has(modelSlot.name.trim());
          return (
            <div key={i} className={gg.slotBlock}>
              <div className={gg.slotTop}>
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
              <div className={gg.slotFields}>
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
                <label className={`${runExec.field} ${gg.slotProviderField}`}>
                  <span className={runExec.fieldLabel}>
                    Provider (optional)
                  </span>
                  <input
                    className={runExec.input}
                    type="text"
                    value={modelSlot.provider}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateModelSlot(i, { provider: e.target.value })
                    }
                    placeholder="inferred from id"
                  />
                </label>
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
      <p className={runExec.muted}>
        Every model this configuration needs, by the role capabilities reference
        it by. A role bound to a <strong>model slot</strong> is chosen at
        launch; one pinned to a <strong>specific model</strong> is fixed here
        and never surfaces on the New run page again.
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
                <label className={`${runExec.field} ${gg.slotNameField}`}>
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
                {!fromModelSlot && (
                  <label className={gg.mockToggle}>
                    <input
                      type="checkbox"
                      checked={slot.mockModel}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateSlot(i, { mockModel: e.target.checked })
                      }
                    />
                    <span>Mock (offline — no API key)</span>
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
              {fromModelSlot ? (
                <div className={gg.slotFields}>
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
                  {dangling && (
                    <span className={gg.fieldError}>
                      That model slot isn&rsquo;t declared above.
                    </span>
                  )}
                </div>
              ) : slot.mockModel ? (
                <p className={runExec.muted}>
                  Binds <code>{MOCK_MODEL_ID}</code> ({MOCK_PROVIDER}) — runs
                  offline against the scripted builder, no credentials required.
                </p>
              ) : (
                <div className={gg.slotFields}>
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
                  <label className={`${runExec.field} ${gg.slotProviderField}`}>
                    <span className={runExec.fieldLabel}>
                      Provider (optional)
                    </span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={slot.provider}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateSlot(i, { provider: e.target.value })
                      }
                      placeholder="inferred from id"
                    />
                  </label>
                </div>
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
            <p className={runExec.muted}>
              Extra roles resolve only when the <code>multi-model</code>{" "}
              capability is on — with it off, every agent falls back to the
              primary slot.
            </p>
          )}
      </div>

      {/* Toolset ablation — withhold individual tools even when their capability is
          on (the finest-grained ablation lever). */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Toolset ablation
      </p>
      <p className={runExec.muted}>
        Withhold individual tools even when their capability is on — the fine
        ablation lever (e.g. drop <code>edit_file</code> while keeping{" "}
        <code>write_file</code>). A tool whose capability is off is already
        withheld.
      </p>
      <div className={gg.toolList}>
        {ablatableCaps.map((cap) => {
          const capOn = Boolean(value.capabilities[cap.id]?.enabled);
          return (
            <div
              key={cap.id}
              className={`${gg.toolGroup}${capOn ? "" : ` ${gg.toolGroupOff}`}`}
            >
              <span className={gg.toolGroupName}>
                {cap.name}
                {!capOn && <span className={gg.capId}> capability off</span>}
              </span>
              <div className={gg.toolGrid}>
                {cap.tools!.map((tool) => (
                  <label key={tool} className={gg.toolItem}>
                    <input
                      type="checkbox"
                      checked={value.disabledTools.includes(tool)}
                      disabled={readOnly}
                      onChange={(e) =>
                        toggleToolDisabled(tool, e.target.checked)
                      }
                    />
                    <code>{tool}</code>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
