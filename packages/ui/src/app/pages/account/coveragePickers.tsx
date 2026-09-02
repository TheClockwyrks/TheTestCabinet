import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  CoverageAxis,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import type { Model } from "../../../client/types";
import { harnesses, recordedHarnesses } from "../../data/harnesses";
import { familyOf, modelForHarness } from "../../data/families";
import {
  OPENROUTER_PROVIDER,
  PROVIDERS,
  harnessUsesProvider,
} from "../../data/providers";
import {
  CATALOG_CATEGORIES,
  categoryLabel,
  categoryOf,
  type CatalogCategory,
} from "../../data/testCaseTabs";
import { useTestCases } from "../../data/useTestCases";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { ModelCombobox } from "../../components/ModelCombobox";
import { SettingRow } from "../../components/SettingRow";
import { routes } from "../../routes";
import { launchModelSlots } from "../runs/gg/ggConfigDraft";
import { findGgConfig, useGgConfigs } from "../runs/gg/useGgConfigs";
import {
  comboDetail,
  comboModels,
  ggConfigKey,
  ggConfigLabel,
  isGgCombo,
} from "./comboLabels";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The combination and version-pinned-case pickers, shared by the coverage plan editor
// (its one-off members) and the group editor (a group's members). Each is a
// self-contained editor over an array: it renders the current entries as pills grouped
// by section and an add-a-row control, and reports the new array back through
// `onChange`. Lifted out of the old single-plan config page so the plan editor and
// group editor stay byte-for-byte identical.
//
// It also holds the small controls over a plan's *schedule* (the ordering axis and
// the review-buffer override), which the editor renders and the dashboard has to be
// able to name — one home for them means the two surfaces can never call the same
// ordering by two different names.

/**
 * How each ordering axis is described to a reviewer.
 *
 * The wire calls them `case` and `combination`, but a reviewer is not choosing a
 * traversal — they are choosing what they will be able to compare side by side when
 * the runs land. "One case at a time" finishes every model on a case before moving
 * on (so a case's results are reviewable together); "One model at a time" walks one
 * combination through every case first (so a model's results are). The
 * depth-first/breadth-first vocabulary is deliberately absent: it describes the
 * implementation and answers none of the reviewer's question.
 */
export const AXIS_LABELS: Readonly<Record<CoverageAxis, string>> = {
  case: "One case at a time",
  combination: "One model at a time",
};

/** The longer form shown under the picker, saying what the choice buys. */
const AXIS_HINTS: Readonly<Record<CoverageAxis, string>> = {
  case: "Every model runs a case before the next case starts, so a case's runs arrive together and can be judged against each other.",
  combination:
    "One model climbs the whole case list before the next model starts, so a model's runs arrive together.",
};

/** The order runs will arrive in, named the way the console names it everywhere. */
export function axisLabel(axis: CoverageAxis): string {
  return AXIS_LABELS[axis];
}

/**
 * The ordering control: two mutually exclusive pills over {@link AXIS_LABELS}.
 *
 * The choice is real and not cosmetic — a top-up emits whole cells in this order,
 * `job.queue_seq` is monotonic, and the dispatcher claims in ascending order, so the
 * order shown here *is* the order the runs execute and therefore the order they
 * become reviewable in.
 */
export function AxisPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CoverageAxis;
  onChange: (next: CoverageAxis) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className={styles.kindRow} role="radiogroup" aria-label="Run order">
        {(Object.keys(AXIS_LABELS) as CoverageAxis[]).map((axis) => (
          <button
            key={axis}
            type="button"
            role="radio"
            aria-checked={value === axis}
            disabled={disabled}
            className={`${styles.groupPick} ${
              value === axis ? styles.groupPickOn : ""
            }`}
            onClick={() => onChange(axis)}
          >
            {AXIS_LABELS[axis]}
          </button>
        ))}
      </div>
      <p className={styles.fieldHint}>{AXIS_HINTS[value]}</p>
    </>
  );
}

/**
 * The review-buffer override: how many runs this plan or ladder may leave outstanding
 * (in flight, or finished and unreviewed by you) before a top-up stops.
 *
 * Empty is not zero, and the field is built around that distinction: empty means
 * "no opinion — use my account default", while `0` means "never top this one up",
 * which is a different instruction the reviewer is entitled to give. So the value is
 * a nullable number, the placeholder shows the account default that an empty field
 * inherits, and the row's reset control drops the override rather than making the
 * reviewer delete digits until the input happens to be blank.
 */
export function BufferTargetField({
  value,
  accountDefault,
  onChange,
  subject = "plan",
}: {
  /** The override, or null to inherit the account default. */
  value: number | null;
  /** The account-wide default an empty field falls back to. */
  accountDefault: number;
  onChange: (next: number | null) => void;
  /** What the override belongs to, so the row names it. */
  subject?: "plan" | "ladder";
}) {
  const description =
    value === null
      ? `Empty inherits your account default of ${accountDefault} outstanding runs.`
      : value === 0
        ? `0 stops this ${subject} topping itself up at all, which is different from empty, where it inherits your account default.`
        : `This ${subject} keeps ${value} run${value === 1 ? "" : "s"} outstanding before a top-up stops.`;
  return (
    <SettingRow
      label="Review buffer"
      description={description}
      modified={value !== null}
      onReset={() => onChange(null)}
    >
      {(id) => (
        <span className={styles.settingNumber}>
          <input
            id={id}
            className={exec.input}
            type="number"
            min={0}
            max={500}
            step={1}
            value={value ?? ""}
            placeholder={String(accountDefault)}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onChange(null);
                return;
              }
              const n = Math.floor(Number(raw));
              onChange(
                Number.isFinite(n) ? Math.min(Math.max(n, 0), 500) : null,
              );
            }}
          />
        </span>
      )}
    </SettingRow>
  );
}

/** gg is not in the launchable harness catalog, so a group heading for it comes from
 *  the wider list of harnesses a *recorded* run can name. */
function harnessName(slug: string): string {
  return recordedHarnesses.find((h) => h.slug === slug)?.displayName ?? slug;
}

/** One block of member pills: the axis its pills vary within, named, over the members
 *  that vary within it. Each item keeps its original index in the member list so
 *  removal targets the right entry after grouping and sorting. */
interface ComboGroup {
  key: string;
  /** The heading — the harness, or the gg configuration, the pills vary within. */
  title: string;
  items: { combo: ReviewPlanCombo; i: number; label: string }[];
}

/**
 * Member pills grouped under the axis they vary within.
 *
 * A harness member varies by the model it runs, so its block is its harness and its
 * pill is the model. A gg member varies by the models it binds within one
 * configuration, so its block is the configuration and its pill is those models. One
 * block per configuration is what makes the heading name a real axis and the block's
 * Clear all mean "drop this configuration's arm" rather than "drop every gg member".
 */
function useComboGroups(
  combos: ReviewPlanCombo[],
  /** The current name of each configuration, keyed by {@link ggConfigKey}. */
  ggNames: ReadonlyMap<string, string>,
): ComboGroup[] {
  return useMemo(() => {
    const indexed = combos.map((combo, i) => ({ combo, i }));
    const harnessMembers = indexed.filter(({ combo }) => !isGgCombo(combo));
    const known = harnesses.map((h) => h.slug);
    const extra = harnessMembers
      .map(({ combo }) => combo.harness)
      .filter((slug) => !known.includes(slug));
    const groups: ComboGroup[] = [];
    for (const slug of new Set([...known, ...extra])) {
      const items = harnessMembers
        .filter(({ combo }) => combo.harness === slug)
        .map(({ combo, i }) => ({ combo, i, label: comboDetail(combo) }));
      if (items.length > 0) {
        groups.push({
          key: `harness:${slug}`,
          title: harnessName(slug),
          items,
        });
      }
    }
    // One block per configuration, headed by the name it carries *now*: a stored member
    // carries whatever name the server resolved when it read it, so preferring the
    // option in hand renames the block along with the configuration.
    const byConfig = new Map<string, ComboGroup>();
    for (const { combo, i } of indexed) {
      if (!isGgCombo(combo)) continue;
      const key = ggConfigKey(combo.ggConfigId);
      let group = byConfig.get(key);
      if (!group) {
        group = {
          key: `gg:${key}`,
          title: ggNames.get(key) ?? ggConfigLabel(combo),
          items: [],
        };
        byConfig.set(key, group);
      }
      // The configuration is already the heading, so the pill is only what varies under
      // it. A configuration that pins every model itself binds none, and says so rather
      // than reading as an empty pill.
      group.items.push({
        combo,
        i,
        label: comboModels(combo) || "pinned models",
      });
    }
    groups.push(
      ...[...byConfig.values()].sort((a, b) => a.title.localeCompare(b.title)),
    );
    // Sorted on what the pill actually reads, not on the model alone: a gg member's
    // model is empty until a read fills it, so sorting on that field would leave every
    // gg pill in an arbitrary order.
    for (const group of groups) {
      group.items.sort((a, b) => a.label.localeCompare(b.label));
    }
    return groups;
  }, [combos, ggNames]);
}

/** The two shapes the add-row can produce, in the order it offers them. */
type AddMode = "harness" | "gg";

/** How each shape is named on the add-row's mode switch. */
const ADD_MODES: Readonly<Record<AddMode, string>> = {
  harness: "Harness",
  gg: "gg configuration",
};

/**
 * What makes two members the same member, so adding one twice is a no-op.
 *
 * Derived facts are deliberately absent: a gg member's identity is the configuration
 * it names and the models it binds, never the configuration's current name or the root
 * model a read filled in, because those change without the member changing at all.
 */
function comboIdentity(combo: ReviewPlanCombo): string {
  if (combo.ggConfigId) {
    const slots = Object.entries(combo.ggSlotModels ?? {})
      .map(([slot, model]) => `${slot}=${model}`)
      .sort();
    return ["gg", combo.ggConfigId, ...slots].join("\u0000");
  }
  return [combo.harness, combo.model, combo.provider ?? ""].join("\u0000");
}

/**
 * The member editor shared by the group, plan and ladder editors: the combinations
 * already chosen, as removable pills grouped by harness, over an add-row that builds
 * the next one.
 *
 * The add-row has two modes because a combination has two shapes — a harness and the
 * model it runs, or a saved [gg configuration](../runs/gg/useGgConfigs) and a model for
 * every launch slot it declares. They land in one list rather than in two pickers, so a
 * plan that crosses both against its cases needs no second axis.
 */
export function ComboPicker({
  combos,
  onChange,
  models,
}: {
  combos: ReviewPlanCombo[];
  onChange: (next: ReviewPlanCombo[]) => void;
  models: Model[];
}) {
  const { token } = useAuth();
  const {
    options: ggOptions,
    loading: ggLoading,
    error: ggError,
  } = useGgConfigs();
  const [addMode, setAddMode] = useState<AddMode>("harness");
  const [addHarness, setAddHarness] = useState(harnesses[0]?.slug ?? "");
  const [addModel, setAddModel] = useState("");
  const [addProvider, setAddProvider] = useState(OPENROUTER_PROVIDER);
  // The gg add-row: the configuration it points at, the model each of that
  // configuration's launch slots is bound to, which slot the row fans out across, and
  // the extra models staged against that slot (see `fanOutModels`).
  const [addGgConfig, setAddGgConfig] = useState("");
  const [addSlotModels, setAddSlotModels] = useState<Record<string, string>>(
    {},
  );
  const [addFanSlot, setAddFanSlot] = useState("");
  const [addGgModels, setAddGgModels] = useState<string[]>([]);
  const fanSlotId = useId();

  const ggNames = useMemo(
    () => new Map(ggOptions.map((o) => [ggConfigKey(o.key), o.name] as const)),
    [ggOptions],
  );
  const comboGroups = useComboGroups(combos, ggNames);

  // The launch inputs each configuration asks for — its own configuration slots, then
  // its agents' passthrough slots — memoized per configuration so the add-row does not
  // re-derive them on every keystroke.
  const ggSlotsByKey = useMemo(
    () =>
      new Map(
        ggOptions.map(
          (o) => [o.key, launchModelSlots(o.capabilitySet)] as const,
        ),
      ),
    [ggOptions],
  );
  // Tolerant of both forms a stored member can carry: the picker writes the launcher's
  // `saved:<id>` key, but the wire contract accepts a bare id and stores what arrived.
  const ggOptionFor = (key: string) => findGgConfig(ggOptions, key);
  const ggSlotsFor = (key: string) => ggSlotsByKey.get(key) ?? [];
  const ggSlots = ggSlotsFor(addGgConfig);
  // The slot the row fans out across, which is the operator's to choose: the slots come
  // out in declaration order, and a sweep is as often over a reviewer's model as over
  // the root's. It defaults to the first so a row nobody touches behaves as before.
  const fanSlot =
    ggSlots.find((slot) => slot.name === addFanSlot) ?? ggSlots[0];
  const boundSlots = ggSlots.filter((slot) => slot !== fanSlot);
  const slotModel = (slot: string) => (addSlotModels[slot] ?? "").trim();

  // Point the gg add-row at the first configuration once they load, with that
  // configuration's declared defaults already filled in, so the row opens ready to add
  // rather than as a blank picker.
  useEffect(() => {
    if (addGgConfig || ggOptions.length === 0) return;
    const first = ggOptions[0]!;
    setAddGgConfig(first.key);
    setAddSlotModels(
      Object.fromEntries(
        launchModelSlots(first.capabilitySet).map((slot) => [
          slot.name,
          slot.defaultModelId ?? "",
        ]),
      ),
    );
  }, [ggOptions, addGgConfig]);

  // Models already paired with the harness/provider the add-row is pointed at.
  // Adding one again is a no-op (the entry would be de-duped below), so the
  // dropdown leaves them out. Scoped to the current harness/provider because
  // that, with the model, is what makes a combination distinct.
  const addProviderKey = harnessUsesProvider(addHarness) ? addProvider : "";
  const alreadyAdded = useMemo(
    () =>
      combos
        .filter(
          (c) =>
            !c.ggConfigId &&
            c.harness === addHarness &&
            (c.provider ?? "") === addProviderKey,
        )
        .map((c) => c.model),
    [combos, addHarness, addProviderKey],
  );

  // Append the members that are not already in the list, and report the whole list
  // back. Adding an exact duplicate is silently a no-op rather than an error: the two
  // entries would be the same cell.
  function appendCombos(next: ReviewPlanCombo[]) {
    const seen = new Set(combos.map(comboIdentity));
    const added: ReviewPlanCombo[] = [];
    for (const combo of next) {
      const key = comboIdentity(combo);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(combo);
    }
    if (added.length > 0) onChange([...combos, ...added]);
  }

  function addCombination() {
    if (!addHarness || !addModel) return;
    appendCombos([
      {
        harness: addHarness as ReviewPlanCombo["harness"],
        model: addModel,
        ...(harnessUsesProvider(addHarness) ? { provider: addProvider } : {}),
      },
    ]);
    setAddModel("");
  }

  // Switching the configuration re-seeds the slot models and drops the staged ones:
  // the launch inputs a configuration asks for are its own, so carrying the previous
  // one's picks over would bind models to inputs that no longer exist.
  function setGgConfig(key: string) {
    setAddGgConfig(key);
    setAddSlotModels(
      Object.fromEntries(
        ggSlotsFor(key).map((slot) => [slot.name, slot.defaultModelId ?? ""]),
      ),
    );
    setAddFanSlot("");
    setAddGgModels([]);
  }

  // Moving the fan-out drops the staged models: they were staged against the slot that
  // was fanning out, and they are not what the new one is being swept over.
  function setFanSlot(name: string) {
    setAddFanSlot(name);
    setAddGgModels([]);
  }

  function setSlotModel(slot: string, modelId: string) {
    setAddSlotModels((prev) => ({ ...prev, [slot]: modelId }));
  }

  // Stage another model against the fan-out slot and clear the field for the next one.
  function stageModel(modelId: string) {
    const id = modelId.trim();
    if (!id || !fanSlot) return;
    setAddGgModels((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSlotModel(fanSlot.name, "");
  }

  // Every model the fan-out slot will be swept over: the staged ones plus whatever is
  // still in the field, so a reviewer who picked one model and pressed Add never has
  // to have staged it first.
  const fanOutModels = fanSlot
    ? [...new Set([...addGgModels, slotModel(fanSlot.name)].filter(Boolean))]
    : [];

  // The member this row would file for one model of the fan-out slot, or null when it
  // points at no configuration. One builder, so what the dropdown offers and what the
  // press adds are decided from the same member.
  function ggComboFor(head: string): ReviewPlanCombo | null {
    const option = ggOptionFor(addGgConfig);
    if (!option) return null;
    return {
      harness: "gg" as ReviewPlanCombo["harness"],
      // Empty because a gg member binds a model per slot instead; the server fills
      // this on read with the model the bound set's root agent runs.
      model: "",
      ggConfigId: option.key,
      ggConfigName: option.name,
      ggSlotModels: Object.fromEntries(
        ggSlots.map((slot) => [
          slot.name,
          slot === fanSlot ? head : slotModel(slot.name),
        ]),
      ),
    };
  }

  // Models the fan-out slot is already bound to in a member this row would rebuild
  // exactly. Adding one again is a no-op (the entry is de-duped in `appendCombos`), so
  // the dropdown leaves them out rather than letting "+ Add 3" file one member and say
  // nothing about the other two. Scoped to what is on screen, because a member that
  // differs on another slot is a different member and is still addable.
  const ggAlreadyAdded = (() => {
    if (!fanSlot) return [];
    const existing = new Set(combos.map(comboIdentity));
    const out: string[] = [];
    for (const combo of combos) {
      const head = (combo.ggSlotModels?.[fanSlot.name] ?? "").trim();
      if (!head || out.includes(head)) continue;
      const candidate = ggComboFor(head);
      if (candidate && existing.has(comboIdentity(candidate))) out.push(head);
    }
    return out;
  })();

  // A configuration that pins every model itself asks for nothing and adds exactly one
  // member; otherwise every slot but the fan-out one needs a model, and the fan-out
  // slot needs at least one.
  const ggAddReady =
    Boolean(ggOptionFor(addGgConfig)) &&
    (!fanSlot || fanOutModels.length > 0) &&
    boundSlots.every((slot) => slotModel(slot.name));

  // One member per model the fan-out slot names, every other slot taking the model on
  // screen. Adding gg members one at a time is the tedium that would make planning gg
  // runs not worth doing, and a fan-out across the models of one configuration is the
  // reason a reviewer opens this row at all.
  function addGgCombinations() {
    if (!ggAddReady) return;
    const heads = fanSlot ? fanOutModels : [""];
    const built = heads
      .map(ggComboFor)
      .filter((combo): combo is ReviewPlanCombo => combo !== null);
    if (built.length === 0) return;
    appendCombos(built);
    setAddGgModels([]);
    if (fanSlot) setSlotModel(fanSlot.name, "");
  }

  // Why the gg mode has nothing to offer, or null when it does. Each reason is its own
  // answer, because they are not the same fact about the account: signed out there is
  // nothing to list, a failed read knows nothing either way, and "you have none" is a
  // claim about the operator's own data that only a successful read can make.
  const ggUnavailable = !token
    ? "Sign in to plan runs for a gg configuration — a configuration belongs to your account."
    : ggLoading
      ? "Loading your gg configurations…"
      : ggError
        ? `Your gg configurations could not be loaded, so none can be offered: ${ggError}`
        : ggOptions.length === 0
          ? "You have no saved gg configurations yet."
          : null;

  return (
    <>
      {comboGroups.length > 0 && (
        <div className={styles.chipGroups}>
          {comboGroups.map((group) => (
            <div key={group.key} className={styles.chipGroup}>
              <div className={styles.chipGroupHead}>
                <span className={styles.chipGroupTitle}>{group.title}</span>
                <button
                  type="button"
                  className={styles.chipGroupClear}
                  // Scoped by the indices the block actually holds, so clearing a
                  // configuration's arm leaves every other configuration's alone.
                  onClick={() => {
                    const dropped = new Set(group.items.map((item) => item.i));
                    onChange(combos.filter((_, j) => !dropped.has(j)));
                  }}
                >
                  Clear all
                </button>
              </div>
              <ul className={styles.chipList}>
                {group.items.map(({ combo, i, label }) => (
                  <li
                    key={`${comboIdentity(combo)}:${i}`}
                    className={styles.chip}
                  >
                    <span>{label}</span>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label="Remove combination"
                      onClick={() => onChange(combos.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div
        className={styles.kindRow}
        role="radiogroup"
        aria-label="Combination kind"
      >
        {(Object.keys(ADD_MODES) as AddMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={addMode === mode}
            className={`${styles.groupPick} ${
              addMode === mode ? styles.groupPickOn : ""
            }`}
            onClick={() => setAddMode(mode)}
          >
            {ADD_MODES[mode]}
          </button>
        ))}
      </div>
      {addMode === "harness" ? (
        <div className={styles.inputRow}>
          <label className={`${exec.field} ${exec.comboField}`}>
            <span className={exec.fieldLabel}>Harness</span>
            <select
              className={exec.select}
              value={addHarness}
              onChange={(e) => {
                const next = e.target.value;
                setAddModel((m) => modelForHarness(models, m, next));
                setAddHarness(next);
              }}
            >
              {harnesses.map((h) => (
                <option key={h.slug} value={h.slug}>
                  {h.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className={`${exec.field} ${exec.comboFieldWide}`}>
            <span className={exec.fieldLabel}>Model</span>
            <ModelCombobox
              value={addModel}
              onChange={setAddModel}
              models={models}
              harnessFamily={familyOf(addHarness)}
              excludeIds={alreadyAdded}
              inputClassName={exec.input}
              placeholder="model id (e.g. claude-opus-4-8)"
            />
          </label>
          {harnessUsesProvider(addHarness) && (
            <label className={`${exec.field} ${exec.comboField}`}>
              <span className={exec.fieldLabel}>Provider</span>
              <select
                className={exec.select}
                value={addProvider}
                onChange={(e) => setAddProvider(e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={exec.secondary}
            onClick={addCombination}
            disabled={!addHarness || !addModel}
          >
            + Add
          </button>
        </div>
      ) : ggUnavailable ? (
        <p className={`${exec.notice} ${exec.muted}`}>
          {ggUnavailable}{" "}
          {/* Offered only where authoring one is the answer. A read that failed says
              nothing about whether the account already has twenty. */}
          {token && !ggLoading && !ggError && (
            <Link to={routes.accountGgConfigs()}>Save one</Link>
          )}
        </p>
      ) : (
        // A gg row is a stack rather than a line: a configuration declares as many
        // launch slots as it likes, and laid out beside each other they squeeze every
        // one below the width a model id is legible in.
        <div className={styles.ggAdd}>
          <label className={`${exec.field} ${exec.comboFieldWide}`}>
            <span className={exec.fieldLabel}>gg configuration</span>
            <select
              className={exec.select}
              value={addGgConfig}
              onChange={(e) => setGgConfig(e.target.value)}
              title={ggOptionFor(addGgConfig)?.description}
            >
              {ggOptions.map((o) => (
                <option key={o.key} value={o.key} title={o.description}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {ggSlots.length === 0 && (
            <p className={styles.fieldHint}>
              This configuration pins every model itself, so it asks for none.
            </p>
          )}
          {ggSlots.length > 1 && (
            <label className={`${exec.field} ${exec.comboFieldWide}`}>
              <span className={exec.fieldLabel}>Fan out across</span>
              <select
                className={exec.select}
                value={fanSlot?.name ?? ""}
                onChange={(e) => setFanSlot(e.target.value)}
              >
                {ggSlots.map((slot) => (
                  <option key={slot.name} value={slot.name}>
                    {slot.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* In declaration order, so the slots read as the configuration declares
              them however the fan-out is pointed. */}
          {ggSlots.map((slot) =>
            slot === fanSlot ? (
              <div
                key={slot.name}
                className={`${exec.field} ${exec.comboSlotField}`}
              >
                <label className={exec.fieldLabel} htmlFor={fanSlotId}>
                  {slot.name}
                </label>
                <div className={styles.modelStage}>
                  <ModelCombobox
                    id={fanSlotId}
                    value={addSlotModels[slot.name] ?? ""}
                    onChange={(v) => setSlotModel(slot.name, v)}
                    onCommit={stageModel}
                    models={models}
                    harnessFamily={familyOf("gg")}
                    excludeIds={[...addGgModels, ...ggAlreadyAdded]}
                    inputClassName={exec.input}
                    placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                  />
                  <button
                    type="button"
                    className={exec.secondary}
                    onClick={() => stageModel(addSlotModels[slot.name] ?? "")}
                    disabled={!slotModel(slot.name)}
                  >
                    + Model
                  </button>
                </div>
                <p className={styles.fieldHint}>
                  Pick as many models as you like — one combination is added per
                  model, and the other slots take the models on screen.
                </p>
                {addGgModels.length > 0 && (
                  <ul className={styles.chipList}>
                    {addGgModels.map((id) => (
                      <li key={id} className={styles.chip}>
                        <span>{id}</span>
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label={`Remove ${id}`}
                          onClick={() =>
                            setAddGgModels((prev) =>
                              prev.filter((m) => m !== id),
                            )
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <label
                key={slot.name}
                className={`${exec.field} ${exec.comboSlotField}`}
              >
                <span className={exec.fieldLabel}>{slot.name}</span>
                <ModelCombobox
                  value={addSlotModels[slot.name] ?? ""}
                  onChange={(v) => setSlotModel(slot.name, v)}
                  models={models}
                  harnessFamily={familyOf("gg")}
                  inputClassName={exec.input}
                  placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                />
              </label>
            ),
          )}
          <div className={styles.inputRow}>
            <button
              type="button"
              className={exec.secondary}
              onClick={addGgCombinations}
              disabled={!ggAddReady}
            >
              {fanOutModels.length > 1
                ? `+ Add ${fanOutModels.length}`
                : "+ Add"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function CasePicker({
  cases,
  onChange,
}: {
  cases: ReviewPlanCase[];
  onChange: (next: ReviewPlanCase[]) => void;
}) {
  const testCaseName = useTestCaseName();
  const sel = useCatalog();
  const { testCases } = useTestCases();

  const summaryBySlug = useMemo(
    () => new Map(testCases.map((c) => [c.slug, c])),
    [testCases],
  );
  const slugCategory = (slug: string): CatalogCategory | null => {
    const summary = summaryBySlug.get(slug);
    return summary ? categoryOf(summary) : null;
  };

  // The test-case type the case dropdown is scoped to, so it offers one
  // category's cases rather than the whole catalog in a single giant list (the
  // same partitioning the new-run form uses). Null until resolved below.
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const activeCategory: CatalogCategory =
    category ?? CATALOG_CATEGORIES[0]!.value;

  // Settle on the default type once the catalog metadata resolves. `useCatalog`
  // leads with the catalog's first case, which need not sit in the default
  // category — move the selection to that category's first case so the case
  // dropdown and the type agree.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || category !== null || !sel.slug) return;
    const currentCategory = slugCategory(sel.slug);
    // Wait until the selected case's catalog metadata has loaded to resolve it.
    if (currentCategory === null) return;
    initialized.current = true;
    const target = CATALOG_CATEGORIES[0]!.value;
    setCategory(target);
    if (currentCategory !== target) selectFirstOf(target);
    // slugCategory/testCaseName close over the catalog; re-run as it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sel.slug, sel.cases, summaryBySlug]);

  // Point the case selection at the first case of a category, so the version and
  // variant re-resolve for a case the dropdown actually shows.
  function selectFirstOf(next: CatalogCategory) {
    const first = [...sel.cases]
      .filter((c) => slugCategory(c.slug) === next)
      .sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      )[0];
    if (first) sel.setSlug(first.slug);
  }

  function onCategoryChange(next: CatalogCategory) {
    setCategory(next);
    if (slugCategory(sel.slug) === next) return;
    selectFirstOf(next);
  }

  // The catalog arrives in slug order; sort by display name to match the labels.
  // Scoped to the selected type so the list only offers cases of that category.
  const sortedCases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // slugCategory closes over summaryBySlug; the list depends on both it and
    // the selected category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  // Case pills grouped under their catalog category, each carrying its original
  // index (from the old config page). Unknown slugs fall into a trailing "Other".
  const caseGroups = useMemo(() => {
    const indexed = cases.map((c, i) => ({ c, i }));
    const order: (CatalogCategory | null)[] = [
      ...CATALOG_CATEGORIES.map((entry) => entry.value),
      null,
    ];
    return order
      .map((value) => ({
        category: value,
        items: indexed
          .filter(({ c }) => slugCategory(c.slug) === value)
          .sort(
            (a, b) =>
              testCaseName(a.c.slug).localeCompare(testCaseName(b.c.slug)) ||
              a.c.variant.localeCompare(b.c.variant) ||
              a.c.version.localeCompare(b.c.version),
          ),
      }))
      .filter((group) => group.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, summaryBySlug, testCaseName]);

  // A category with no cases in the catalog leaves the selection pointed at a case
  // the dropdown no longer offers; adding it would file a member the picker never
  // showed, so the add-row stays disabled until the two agree.
  const selectionShown = sortedCases.some((c) => c.slug === sel.slug);

  function addCase() {
    if (!selectionShown) return;
    if (!sel.slug || !sel.version || !sel.variant) return;
    if (
      cases.some(
        (c) =>
          c.slug === sel.slug &&
          c.version === sel.version &&
          c.variant === sel.variant,
      )
    ) {
      return;
    }
    onChange([
      ...cases,
      { slug: sel.slug, version: sel.version, variant: sel.variant },
    ]);
  }

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  return (
    <>
      {caseGroups.length > 0 && (
        <div className={styles.chipGroups}>
          {caseGroups.map((group) => (
            <div key={group.category ?? "other"} className={styles.chipGroup}>
              <div className={styles.chipGroupHead}>
                <span className={styles.chipGroupTitle}>
                  {group.category ? categoryLabel(group.category) : "Other"}
                </span>
                <button
                  type="button"
                  className={styles.chipGroupClear}
                  onClick={() =>
                    onChange(
                      cases.filter(
                        (c) => slugCategory(c.slug) !== group.category,
                      ),
                    )
                  }
                >
                  Clear all
                </button>
              </div>
              <ul className={styles.chipList}>
                {group.items.map(({ c, i }) => (
                  <li
                    key={`${c.slug}@${c.version}@${c.variant}`}
                    className={styles.chip}
                  >
                    <span>
                      {testCaseName(c.slug)} · {c.variant} · {c.version}
                    </span>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label="Remove case"
                      onClick={() => onChange(cases.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className={styles.inputRow}>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Test case type</span>
          <select
            className={exec.select}
            value={activeCategory}
            onChange={(e) =>
              onCategoryChange(e.target.value as CatalogCategory)
            }
          >
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Test case</span>
          <select
            className={exec.select}
            value={sel.slug}
            onChange={(e) => sel.setSlug(e.target.value)}
          >
            {sortedCases.map((c) => (
              <option key={c.slug} value={c.slug}>
                {testCaseName(c.slug)}
              </option>
            ))}
          </select>
        </label>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Version</span>
          <select
            className={exec.select}
            value={sel.version}
            onChange={(e) => sel.setVersion(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Variant</span>
          <select
            className={exec.select}
            value={sel.variant}
            onChange={(e) => sel.setVariant(e.target.value)}
            disabled={!sel.versionInfo}
          >
            {(sel.versionInfo?.variants ?? []).map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name} ({v.slug})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={exec.secondary}
          onClick={addCase}
          disabled={
            !selectionShown || !sel.slug || !sel.version || !sel.variant
          }
        >
          + Add
        </button>
      </div>
    </>
  );
}
