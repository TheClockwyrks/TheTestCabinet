import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type {
  BufferTarget,
  CoverageAxis,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@clockwyrks/run-record/coverage";
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
import { useEngineChoice } from "../../data/useEngineChoice";
import { ModelCombobox } from "../../components/ModelCombobox";
import { NumberValueField } from "../../components/NumberField";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";
import { routes } from "../../routes";
import {
  BUFFER_TARGET_CEILING,
  UNBOUNDED_BUFFER,
  boundedBuffer,
  describeBufferTarget,
} from "./bufferTarget";
import { CaseEngineField } from "./CaseEngineField";
import { launchModelSlots } from "../runs/gg/ggConfigDraft";
import { findGgConfig, useGgConfigs } from "../runs/gg/useGgConfigs";
import {
  comboDetail,
  ggConfigKey,
  ggConfigLabel,
  ggModelSummary,
  isGgCombo,
} from "./comboLabels";
import {
  caseEngine,
  caseLabel,
  pinnedEngine,
  samePinnedCase,
} from "./caseLabels";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The combination and version-pinned-case pickers, shared by the coverage plan editor
// (its one-off members) and the group editor (a group's members). Each is a
// self-contained editor over an array: it renders the current entries under the section
// each belongs to and an add-a-row control, and reports the new array back through
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

/** What the selected order does, in one line: the row's description. */
const AXIS_HINTS: Readonly<Record<CoverageAxis, string>> = {
  case: "Every model runs a case before the next case starts.",
  combination: "One model climbs the whole case list before the next starts.",
};

/**
 * What the choice buys, which is the same sentence whichever order is selected.
 *
 * One string rather than a second per-axis record: a reviewer weighing the two orders
 * needs both halves of the comparison, and a help tip that only described the order
 * already chosen would answer the question they are not asking.
 */
const AXIS_HELP =
  "Runs are enqueued in this order, so it is also the order they arrive and become reviewable in. One case at a time lands a case's runs together, where they can be judged against each other; one model at a time lands a model's runs together, so you learn what a single model does across the list soonest.";

/** The order runs will arrive in, named the way the console names it everywhere. */
export function axisLabel(axis: CoverageAxis): string {
  return AXIS_LABELS[axis];
}

/** The order a new plan starts in, and the one the picker resets to. */
export const DEFAULT_COVERAGE_AXIS: CoverageAxis = "case";

/**
 * The ordering setting: a dropdown over {@link AXIS_LABELS}, described by what the
 * selected order does.
 *
 * A dropdown rather than a pair of pills, for the reason `LadderAxisPicker` gives:
 * this is one setting with one answer sitting in a column of other settings, so its
 * control column should read as a value ("One case at a time") the way the review
 * buffer's reads as a number, not as two buttons of which one happens to be lit.
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
    <SettingRow
      label="Run order"
      description={AXIS_HINTS[value]}
      help={AXIS_HELP}
      modified={value !== DEFAULT_COVERAGE_AXIS}
      onReset={() => onChange(DEFAULT_COVERAGE_AXIS)}
    >
      {(id) => (
        <span className={styles.settingSelect}>
          <select
            id={id}
            className={exec.select}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value as CoverageAxis)}
          >
            {(Object.keys(AXIS_LABELS) as CoverageAxis[]).map((axis) => (
              <option key={axis} value={axis}>
                {AXIS_LABELS[axis]}
              </option>
            ))}
          </select>
        </span>
      )}
    </SettingRow>
  );
}

/**
 * The review-buffer override: how many runs this plan or ladder may leave outstanding
 * (in flight, or finished and unreviewed by you) before a top-up stops — or no limit
 * at all.
 *
 * Empty is not zero, and the field is built around that distinction: empty means
 * "no opinion — use my account default", while `0` means "never top this one up",
 * which is a different instruction the reviewer is entitled to give. So the value is
 * a nullable target, the placeholder shows the account default that an empty field
 * inherits, and the row's reset control drops the override rather than making the
 * reviewer delete digits until the input happens to be blank.
 *
 * "No limit" is a third instruction with a switch of its own rather than a large
 * number typed into the field: it tells the backend to run through every missing
 * cell whatever is outstanding, and it reads back as what it is instead of as a
 * figure that merely exceeds the plan today.
 */
export function BufferTargetField({
  value,
  accountDefault,
  onChange,
  subject = "plan",
}: {
  /** The override, or null to inherit the account default. */
  value: BufferTarget | null;
  /** The account-wide default an empty field falls back to. */
  accountDefault: BufferTarget;
  onChange: (next: BufferTarget | null) => void;
  /** What the override belongs to, so the row names it. */
  subject?: "plan" | "ladder";
}) {
  const unbounded = value?.kind === "unbounded";
  // The bound the field last held, so switching no-limit off restores it rather
  // than leaving the reviewer to retype it; null when the field has only ever
  // inherited.
  const [lastBound, setLastBound] = useState<number | null>(
    value?.kind === "bounded" ? value.runs : null,
  );
  const inherited = describeBufferTarget(accountDefault);
  const description =
    value === null
      ? `Empty inherits your account default of ${inherited}.`
      : value.kind === "unbounded"
        ? `No limit: a top-up enqueues every missing run of this ${subject} at once, however many are already waiting on you. Only its per-cell targets and the harness caps hold it back.`
        : value.runs === 0
          ? `0 stops this ${subject} topping itself up at all, which is different from empty, where it inherits your account default.`
          : `This ${subject} keeps ${value.runs} run${value.runs === 1 ? "" : "s"} outstanding before a top-up stops.`;
  const placeholder =
    accountDefault.kind === "bounded" ? String(accountDefault.runs) : "";
  return (
    <SettingRow
      label="Review buffer"
      description={description}
      modified={value !== null}
      onReset={() => onChange(null)}
    >
      {(id) => (
        <span className={styles.settingBuffer}>
          <span className={styles.settingNumber}>
            {/* Optional: empty is the answer "inherit my account default", so
                clearing it drops the override rather than being read as a zero.
                Typing that names nothing usable commits nothing at all — it no
                longer silently throws the override away mid-keystroke. */}
            <NumberValueField
              id={id}
              className={exec.input}
              optional
              label="The review buffer"
              min={0}
              max={BUFFER_TARGET_CEILING}
              integer
              showProblem={false}
              title={`Between 0 and ${BUFFER_TARGET_CEILING} runs, or empty to inherit your account default.`}
              value={unbounded || value === null ? undefined : value.runs}
              placeholder={unbounded ? "" : placeholder}
              disabled={unbounded}
              onCommit={(n) => {
                const next = boundedBuffer(n);
                setLastBound(next.kind === "bounded" ? next.runs : null);
                onChange(next);
              }}
              onClear={() => onChange(null)}
            />
          </span>
          <label className={styles.settingToggle}>
            <Switch
              checked={unbounded}
              ariaLabel="No limit"
              onChange={(next) =>
                onChange(
                  next
                    ? UNBOUNDED_BUFFER
                    : lastBound === null
                      ? null
                      : boundedBuffer(lastBound),
                )
              }
            />
            <span>No limit</span>
          </label>
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

/** One block of member pills: the harness its pills vary within, named, over the
 *  members that vary within it. Each item keeps its original index in the member list
 *  so removal targets the right entry after grouping and sorting. */
interface ComboGroup {
  key: string;
  /** The heading — the harness the pills vary within. */
  title: string;
  items: { combo: ReviewPlanCombo; i: number; label: string }[];
}

/**
 * Harness member pills grouped under the harness they run.
 *
 * A harness member varies by the model it runs, so its block is its harness and its
 * pill is the model. gg members are deliberately absent: a gg member is a configuration
 * *and* a model per launch slot, which is more than a pill holds, so they are listed
 * below as rows under one heading of their own (see {@link useGgMembers}).
 */
function useComboGroups(combos: ReviewPlanCombo[]): ComboGroup[] {
  return useMemo(() => {
    const harnessMembers = combos
      .map((combo, i) => ({ combo, i }))
      .filter(({ combo }) => !isGgCombo(combo));
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
    // Sorted on what the pill actually reads rather than on the model alone, so a
    // provider-routed member sorts where the reviewer sees it.
    for (const group of groups) {
      group.items.sort((a, b) => a.label.localeCompare(b.label));
    }
    return groups;
  }, [combos]);
}

/** One gg member as the list renders it: the configuration it names, the models it
 *  binds, and the binding behind them. It keeps its original index in the member list
 *  so removal targets the right entry after sorting. */
interface GgMemberEntry {
  combo: ReviewPlanCombo;
  i: number;
  /** The configuration's name as it reads now. */
  name: string;
  /** The models it binds, on one line. */
  summary: string;
  /** Every launch slot it binds, in slot-name order. */
  bindings: { slot: string; model: string }[];
}

/**
 * The gg members, one row each, ordered by configuration and then by what they bind.
 *
 * One row per *member* and not per configuration: two members of one configuration that
 * bind different models are two cells the plan will run and two entries the reviewer can
 * remove, and a block per configuration spent a heading, a divider and a Clear all on
 * what is one line of the list.
 */
function useGgMembers(
  combos: ReviewPlanCombo[],
  /** The current name of each configuration, keyed by {@link ggConfigKey}. */
  ggNames: ReadonlyMap<string, string>,
): GgMemberEntry[] {
  return useMemo(() => {
    const rows = combos
      .map((combo, i) => ({ combo, i }))
      .filter(({ combo }) => isGgCombo(combo))
      .map(({ combo, i }) => ({
        combo,
        i,
        // The name it carries *now*: a stored member carries whatever name the server
        // resolved when it read it, so preferring the option in hand renames the row
        // along with the configuration.
        name:
          ggNames.get(ggConfigKey(combo.ggConfigId)) ?? ggConfigLabel(combo),
        // A configuration that pins every model itself binds none and has no root model
        // until a read fills one in, so the row says what it is rather than reading as a
        // blank line.
        summary: ggModelSummary(combo) || "pinned models",
        // Every declared slot, including one nothing is bound to: an unbound slot is
        // exactly why the cell it makes can never launch, so the disclosure has to name
        // it rather than quietly leave it out.
        bindings: Object.keys(combo.ggSlotModels ?? {})
          .sort()
          .map((slot) => ({
            slot,
            model: (combo.ggSlotModels?.[slot] ?? "").trim(),
          })),
      }));
    rows.sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.summary.localeCompare(b.summary),
    );
    return rows;
  }, [combos, ggNames]);
}

/**
 * One gg member: the configuration and the models it binds, over the slot-by-slot
 * binding it discloses.
 *
 * The row answers "which member is this" and the disclosure answers "which model is on
 * which slot" — the second is what tells two arms of one study apart, and it is also as
 * many lines of model ids as the configuration has slots, so it stays folded until it is
 * asked for. The remove control is a sibling of the disclosure button rather than a
 * child of it: nested, a press aimed at opening the row could land on the destructive
 * control instead, and that is not a guess worth offering.
 */
function GgMemberRow({
  entry,
  onRemove,
}: {
  entry: GgMemberEntry;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  // A generated id rather than one built from the configuration's name: a name is
  // operator-authored and may hold spaces, which an `aria-controls` IDREF cannot.
  const panelId = useId();
  return (
    <li className={styles.ggMember}>
      <div className={styles.ggMemberRow}>
        <button
          type="button"
          className={styles.ggMemberOpen}
          aria-expanded={open}
          // Only while the panel exists — a control pointing at an absent id is a broken
          // reference, not an empty one.
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.twisty} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={styles.ggMemberName}>{entry.name}</span>
          <span className={styles.ggMemberModels}>{entry.summary}</span>
        </button>
        <button
          type="button"
          className={styles.chipRemove}
          aria-label="Remove combination"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      {open &&
        (entry.bindings.length === 0 ? (
          <p id={panelId} className={styles.ggBindingsNone}>
            This configuration pins every model itself, so it binds none.
          </p>
        ) : (
          <dl id={panelId} className={styles.ggBindings}>
            {entry.bindings.map(({ slot, model }) => (
              <Fragment key={slot}>
                <dt className={styles.ggBindingSlot}>{slot}</dt>
                <dd
                  className={`${styles.ggBindingModel} ${
                    model ? "" : styles.ggBindingUnbound
                  }`}
                >
                  {model || "not bound"}
                </dd>
              </Fragment>
            ))}
          </dl>
        ))}
    </li>
  );
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
 * already chosen, over an add-row that builds the next one.
 *
 * The add-row asks for a kind because a combination has two shapes — a harness and the
 * model it runs, or a saved [gg configuration](../runs/gg/useGgConfigs) and a model for
 * every launch slot it declares. They land in one list rather than in two pickers, so a
 * plan that crosses both against its cases needs no second axis. The two shapes are
 * listed differently for the same reason: a harness member is one model and reads as a
 * pill under its harness, while a gg member is a configuration and a model per slot,
 * which is a row that discloses what it binds.
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
  const comboGroups = useComboGroups(combos);
  const ggMembers = useGgMembers(combos, ggNames);

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
      {(comboGroups.length > 0 || ggMembers.length > 0) && (
        <div className={styles.chipGroups}>
          {comboGroups.map((group) => (
            <div key={group.key} className={styles.chipGroup}>
              <div className={styles.chipGroupHead}>
                <span className={styles.chipGroupTitle}>{group.title}</span>
                <button
                  type="button"
                  className={styles.chipGroupClear}
                  // Scoped by the indices the block actually holds, so clearing one
                  // harness leaves every other harness's members alone.
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
          {/* One section for every gg member, under the same divided heading a harness
              block carries. The heading names the shape rather than a configuration
              because the configuration names each row: one block per configuration made
              a heading and a divider out of a single entry, and stacked several of them
              between the reviewer and the add-row. */}
          {ggMembers.length > 0 && (
            <div className={styles.chipGroup}>
              <div className={styles.chipGroupHead}>
                <span className={styles.chipGroupTitle}>gg Configurations</span>
                <button
                  type="button"
                  className={styles.chipGroupClear}
                  // Every gg member, since the section is every gg member. Decided on
                  // what makes a member a gg member rather than on the row list, so a
                  // member the rows could not name is still cleared.
                  onClick={() => onChange(combos.filter((c) => !isGgCombo(c)))}
                >
                  Clear all
                </button>
              </div>
              <ul className={styles.ggMemberList}>
                {ggMembers.map((entry) => (
                  <GgMemberRow
                    key={`${comboIdentity(entry.combo)}:${entry.i}`}
                    entry={entry}
                    onRemove={() =>
                      onChange(combos.filter((_, j) => j !== entry.i))
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {/* One labelled field rather than two lit pills: the shape is a choice from a
          fixed set, which is what a select is for, and a pair of filled pills directly
          under a list of member pills read as members of it. Matches the comparison
          editor's own Kind field, which offers this same choice. */}
      <label className={`${exec.field} ${styles.kindField}`}>
        <span className={exec.fieldLabel}>Combination kind</span>
        <select
          className={exec.select}
          value={addMode}
          onChange={(e) => setAddMode(e.target.value as AddMode)}
        >
          {(Object.keys(ADD_MODES) as AddMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {ADD_MODES[mode]}
            </option>
          ))}
        </select>
      </label>
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
          {/* Every field in this stack takes `comboSlotField`, which is width and
              nothing else. `comboField`/`comboFieldWide` are for a row: their flex
              basis is a *main-axis* size, and the main axis of a column is the vertical
              one, so a 14rem basis here is 14rem of height and a field-sized hole under
              every control. */}
          <label className={`${exec.field} ${exec.comboSlotField}`}>
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
            <label className={`${exec.field} ${exec.comboSlotField}`}>
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
              a.c.version.localeCompare(b.c.version) ||
              // Last, because it is the finest split: two pins that agree on
              // everything else differ only here, and they are two pills.
              caseEngine(a.c).localeCompare(caseEngine(b.c)),
          ),
      }))
      .filter((group) => group.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, summaryBySlug, testCaseName]);

  // A category with no cases in the catalog leaves the selection pointed at a case
  // the dropdown no longer offers; adding it would file a member the picker never
  // showed, so the add-row stays disabled until the two agree.
  const selectionShown = sortedCases.some((c) => c.slug === sel.slug);

  // The engine this pin will name, held to what the resolved version supports.
  const engineChoice = useEngineChoice(sel.versionInfo?.engines);

  function addCase() {
    if (!selectionShown) return;
    if (!sel.slug || !sel.version || !sel.variant) return;
    const pin: ReviewPlanCase = {
      slug: sel.slug,
      version: sel.version,
      variant: sel.variant,
      ...pinnedEngine(engineChoice.engine),
    };
    // The same case at the same version, variant *and* engine is the same cell twice.
    // A different engine is a different case: the runs are not comparable, so the plan
    // is entitled to hold both and the refusal must not swallow the second.
    if (cases.some((c) => samePinnedCase(c, pin))) return;
    onChange([...cases, pin]);
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
                    key={`${c.slug}@${c.version}@${c.variant}@${caseEngine(c)}`}
                    className={styles.chip}
                  >
                    {/* Through the shared pin label, so a pill spells the engine the
                        same way the matrix and the review queue do — and so two pills
                        differing only on engine are not the same line of text. */}
                    <span>{caseLabel(testCaseName(c.slug), c)}</span>
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
      {/* The new-run form's Test grid, so choosing a case reads the same wherever it
          is done: the type, case and version on the first row, and the variant, the
          engine and the add control — everything the resolved version decides, plus
          the press that commits it — on the second. `editorFields` is the panel's
          variant of that grid; see Coverage.module.scss. */}
      <div
        className={`${exec.fields} ${exec.testFields} ${styles.editorFields}`}
      >
        <label className={exec.field}>
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
        <label className={exec.field}>
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
        <label className={exec.field}>
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
        <label className={exec.field}>
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
        {/* Shared with the ladder editor's rung list — see `CaseEngineField`, which
            also says why the field stays on screen once the version has decided. */}
        <CaseEngineField
          choice={engineChoice}
          title="The runtime this case's runs are built against. Coverage is counted per engine, because a result is only comparable with another result on the same engine."
        />
        <button
          type="button"
          className={`${exec.secondary} ${styles.editorAdd}`}
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
