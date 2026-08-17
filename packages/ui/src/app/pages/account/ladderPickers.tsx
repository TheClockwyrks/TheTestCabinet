import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Gate,
  GateThreshold,
  LadderAxis,
  LadderRungInput,
} from "@test-cabinet/run-record/ladders";
import type { Rating } from "@test-cabinet/run-record/review";
import { RATINGS, RATING_META } from "../../../ratings";
import {
  CATALOG_CATEGORIES,
  categoryOf,
  type CatalogCategory,
} from "../../data/testCaseTabs";
import { useTestCases } from "../../data/useTestCases";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useCatalog } from "../../runtime/useCatalog";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";
import ladder from "./Ladder.module.scss";

// The controls a ladder has and a coverage plan does not: the ordering axis in the
// ladder's own vocabulary, the gate every rung is judged by, and the ordered rung
// list. They live here, apart from the pages, for the same reason the coverage
// pickers do — the editor renders them and the dashboard has to be able to *name*
// what they mean, and one home for them is what stops the two surfaces describing
// the same rule two different ways.

/**
 * The gate a new ladder starts with, mirroring the Rust `Gate::default`.
 *
 * The gentlest rule that still stops a hopeless climb: a climber advances as long as
 * one run was playable at all, and is walled only when the whole rung came back
 * broken. It is also the value every gate control resets to, which is how the editor
 * shows where the defaults are without captioning each control with its own.
 */
export const DEFAULT_GATE: Gate = {
  floor: "scuffed",
  threshold: { kind: "count", runs: 1 },
  unloadedCountsAsBroken: true,
  earlyStop: false,
};

/**
 * How each ladder ordering axis is described to a reviewer.
 *
 * The ladder vocabulary, not the plan's: a ladder's outer loop is a rung rather than
 * a case, and "rung by rung" says the thing a reviewer wants to know — that the whole
 * board comes up one step before anyone moves on, which is what makes the models
 * comparable. As on a plan, the depth-first/breadth-first vocabulary is deliberately
 * absent: it describes the implementation and answers none of the reviewer's
 * question.
 */
export const LADDER_AXIS_LABELS: Readonly<Record<LadderAxis, string>> = {
  rung: "Rung by rung",
  combination: "Model by model",
};

/** The longer form shown beside the picker, saying what the choice buys. */
const LADDER_AXIS_HINTS: Readonly<Record<LadderAxis, string>> = {
  rung: "Every climber comes up a rung before anyone moves on, so a rung's runs arrive together and can be judged against each other.",
  combination:
    "One climber goes as high as it can before the next one starts, so you find out how far a single model gets soonest.",
};

/** The order a ladder's runs will arrive in, named the way the console names it. */
export function ladderAxisLabel(axis: LadderAxis): string {
  return LADDER_AXIS_LABELS[axis];
}

/** The order a new ladder starts in, and the one the picker resets to. */
export const DEFAULT_LADDER_AXIS: LadderAxis = "rung";

/**
 * The ordering setting: two mutually exclusive pills over {@link LADDER_AXIS_LABELS},
 * described by what the selected order buys.
 *
 * The choice is real and not cosmetic — a top-up emits whole cells in this order,
 * `job.queue_seq` is monotonic, and the dispatcher claims in ascending order, so the
 * order shown here *is* the order the runs execute and therefore become reviewable
 * in.
 */
export function LadderAxisPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: LadderAxis;
  onChange: (next: LadderAxis) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow
      label="Climb order"
      description={LADDER_AXIS_HINTS[value]}
      modified={value !== DEFAULT_LADDER_AXIS}
      onReset={() => onChange(DEFAULT_LADDER_AXIS)}
    >
      <div
        className={styles.settingPills}
        role="radiogroup"
        aria-label="Climb order"
      >
        {(Object.keys(LADDER_AXIS_LABELS) as LadderAxis[]).map((axis) => (
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
            {LADDER_AXIS_LABELS[axis]}
          </button>
        ))}
      </div>
    </SettingRow>
  );
}

/**
 * The runs a fractional threshold demands of a rung that completes `total` runs.
 *
 * Mirrors `GateThreshold::required` + `GateTally::required_runs` on the Rust side,
 * rounding up: half of five runs is 2.5, which three runs clear and two do not — the
 * whole point of "over half". The console re-derives it only to *show* the reviewer
 * what their setting means before any run exists; every decision is the server's.
 */
export function requiredRuns(threshold: GateThreshold, total: number): number {
  if (threshold.kind === "count") return threshold.runs;
  const fraction = Number.isFinite(threshold.fraction)
    ? Math.min(Math.max(threshold.fraction, 0), 1)
    : 0;
  // The same epsilon the Rust gate uses, for the same reason: `fraction * total` is
  // computed in binary floating point, where a product that is whole in decimal need
  // not be, and rounding that up would demand a run that can never exist.
  return Math.max(0, Math.ceil(fraction * total - 1e-9));
}

/** Whether two thresholds demand the same thing, so a control knows it has moved. */
function sameThreshold(a: GateThreshold, b: GateThreshold): boolean {
  if (a.kind === "count" && b.kind === "count") return a.runs === b.runs;
  if (a.kind === "fraction" && b.kind === "fraction")
    return a.fraction === b.fraction;
  return false;
}

/** A rating named as the reviewer sees it ("Passable"), never as the wire spells it. */
function ratingLabel(rating: Rating): string {
  return RATING_META[rating].label;
}

/**
 * The gate stated as its one rule, independent of any particular rung's target.
 *
 * There is exactly one rule — `advance when count(my runs rated FLOOR or better) >=
 * THRESHOLD` — so this reads it back rather than naming a mode. Naming modes is what
 * the whole design avoids: "stop when all are broken" and "pass if any run is
 * passable" are the *same* rule with different numbers, and a console that presented
 * them as separate settings would have to invent a third name for every combination a
 * reviewer actually typed.
 */
export function describeGate(gate: Gate): string {
  const floor = `rated ${ratingLabel(gate.floor)} or better`;
  if (gate.threshold.kind === "count") {
    const runs = gate.threshold.runs;
    return `A climber advances past a rung once ${runs} of its runs ${
      runs === 1 ? "is" : "are"
    } ${floor}.`;
  }
  const percent = Math.round(gate.threshold.fraction * 100);
  return `A climber advances past a rung once ${percent}% of its completed runs are ${floor}.`;
}

/**
 * The gate restated in whole runs at a given target — the check that makes the two
 * knobs legible together.
 *
 * The floor and the threshold interact, and neither alone says what will happen: at
 * five runs a rung, "Scuffed or better, 1 run" walls a model only when every run is
 * broken, while "Scuffed or better, 50%" walls it as soon as over half are. Showing
 * the arithmetic is the difference between a setting a reviewer can check and one
 * they have to guess at.
 */
export function gateExample(gate: Gate, runsPerCell: number): string {
  const total = Math.max(1, runsPerCell);
  const need = Math.min(requiredRuns(gate.threshold, total), total);
  const floor = `rated ${ratingLabel(gate.floor)} or better`;
  if (need <= 0) {
    return `At ${total} runs a rung, this gate demands nothing: every climber advances past every rung. Raise the threshold to let the ladder stop anyone.`;
  }
  const decides = gate.earlyStop
    ? "Its remaining runs are cancelled once the outcome is certain."
    : "The rung still finishes all of its runs either way.";
  return (
    `At ${total} runs a rung: a climber advances once ${need} of its ${total} runs ` +
    `${need === 1 ? "is" : "are"} ${floor}, and is walled when ` +
    `${total - need + 1} or more come back worse. ${decides}`
  );
}

/**
 * The gate's two controls: the rating floor, and the threshold as a count **or** a
 * share of the rung's completed runs.
 *
 * Two controls and no mode picker, deliberately. The rule is one parameterised
 * sentence, and every intent a reviewer has ("stop when over half are broken", "stop
 * only when all are", "pass if any run is playable") is that sentence with different
 * numbers. A menu of named modes would be a list of presets that could not express
 * the fourth thing somebody wanted.
 */
export function GateEditor({
  gate,
  runsPerCell,
  onChange,
}: {
  gate: Gate;
  /** The ladder's runs-per-cell, so the worked example is in this ladder's terms. */
  runsPerCell: number;
  onChange: (next: Gate) => void;
}) {
  const threshold = gate.threshold;
  const isCount = threshold.kind === "count";
  // A fractional threshold is stored as a share and edited as a percentage: nobody
  // types 0.5 when they mean half, and the round percentages a reviewer actually
  // types convert back exactly.
  const amount =
    threshold.kind === "count"
      ? threshold.runs
      : Math.round(threshold.fraction * 100);

  function setThreshold(threshold: GateThreshold) {
    onChange({ ...gate, threshold });
  }

  return (
    <>
      <SettingRow
        label="Counts as clearing the rung"
        help={describeGate(gate)}
        modified={gate.floor !== DEFAULT_GATE.floor}
        onReset={() => onChange({ ...gate, floor: DEFAULT_GATE.floor })}
      >
        {(id) => (
          <span className={styles.settingSelect}>
            <select
              id={id}
              className={exec.select}
              value={gate.floor}
              onChange={(e) =>
                onChange({ ...gate, floor: e.target.value as Rating })
              }
            >
              {RATINGS.map((rating) => (
                <option key={rating} value={rating}>
                  {ratingLabel(rating)} or better
                </option>
              ))}
            </select>
          </span>
        )}
      </SettingRow>

      <SettingRow
        label="How many must clear it"
        description={gateExample(gate, runsPerCell)}
        modified={!sameThreshold(threshold, DEFAULT_GATE.threshold)}
        onReset={() => setThreshold(DEFAULT_GATE.threshold)}
      >
        {(id) => (
          <>
            <span className={styles.settingNumber}>
              <input
                id={id}
                className={exec.input}
                type="number"
                min={isCount ? 1 : 0}
                max={100}
                step={isCount ? 1 : 5}
                value={amount}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  if (!Number.isFinite(n)) return;
                  setThreshold(
                    isCount
                      ? { kind: "count", runs: Math.min(Math.max(n, 1), 100) }
                      : {
                          kind: "fraction",
                          fraction: Math.min(Math.max(n, 0), 100) / 100,
                        },
                  );
                }}
              />
            </span>
            <span className={styles.settingUnit}>
              <select
                className={exec.select}
                aria-label="Measured as"
                value={gate.threshold.kind}
                // Switching unit re-seeds the amount rather than reinterpreting it:
                // "50" means half as a percentage and fifty runs as a count, and
                // silently carrying the number across would change the gate by an
                // order of magnitude on a control the reviewer only meant to
                // relabel.
                onChange={(e) =>
                  setThreshold(
                    e.target.value === "count"
                      ? { kind: "count", runs: 1 }
                      : { kind: "fraction", fraction: 0.5 },
                  )
                }
              >
                <option value="count">runs</option>
                <option value="fraction">
                  % of the rung&rsquo;s completed runs
                </option>
              </select>
            </span>
          </>
        )}
      </SettingRow>

      <SettingRow
        label="Count a run whose build never loaded as broken"
        help="A build that does not load leaves a reviewer nothing to judge, so counting it at once keeps it from holding up the climb and from taking a slot in your review buffer."
        modified={
          gate.unloadedCountsAsBroken !== DEFAULT_GATE.unloadedCountsAsBroken
        }
        onReset={() =>
          onChange({
            ...gate,
            unloadedCountsAsBroken: DEFAULT_GATE.unloadedCountsAsBroken,
          })
        }
      >
        {(id) => (
          <Switch
            id={id}
            checked={gate.unloadedCountsAsBroken}
            onChange={(next) =>
              onChange({ ...gate, unloadedCountsAsBroken: next })
            }
          />
        )}
      </SettingRow>

      <SettingRow
        label="Decide a rung early and cancel its remaining runs"
        help="A rung's runs are evidence as well as a verdict, so leaving this off keeps the full record of every rung. Turn it on to stop paying for runs whose outcome is already certain."
        modified={gate.earlyStop !== DEFAULT_GATE.earlyStop}
        onReset={() => onChange({ ...gate, earlyStop: DEFAULT_GATE.earlyStop })}
      >
        {(id) => (
          <Switch
            id={id}
            checked={gate.earlyStop}
            onChange={(next) => onChange({ ...gate, earlyStop: next })}
          />
        )}
      </SettingRow>
    </>
  );
}

/**
 * The test types a rung may not hold, mirroring the backend's
 * `RUNG_INELIGIBLE_TEST_TYPES`.
 *
 * A performance case is graded automatically and never appears on a reviewer
 * worklist, and a game jam is scored on the graded category scale and records no
 * domain rating at all — so in both cases a rung's runs could never be judged, the
 * gate could never resolve, and the climber would stall forever with nothing looking
 * wrong. The backend rejects them outright; the picker simply never offers them, so
 * the rejection is not something a reviewer has to discover by hitting it.
 */
const INELIGIBLE_CATEGORIES: ReadonlySet<CatalogCategory> =
  new Set<CatalogCategory>(["performance", "game-jam"]);

/** The case categories a rung may be picked from. */
const RUNG_CATEGORIES = CATALOG_CATEGORIES.filter(
  (entry) => !INELIGIBLE_CATEGORIES.has(entry.value),
);

/**
 * The identity a rung is tracked by while the draft is being edited.
 *
 * A saved rung has a server id, which is the thing the save reconciles on. One added
 * in this session has none yet, so it falls back to the coordinates that make it the
 * rung it is — and those are unique within a climb because {@link RungListEditor}
 * refuses to add a case at a version and variant the climb already holds.
 */
function rungKey(rung: LadderRungInput): string {
  return rung.id ?? `${rung.slug}@${rung.version}@${rung.variant}`;
}

/**
 * One row of the climb: a drag handle, the rung's ordinal and case, its run-count
 * override, and the move/remove controls.
 *
 * Dragging and the ▲▼ buttons are deliberately both here rather than one replacing
 * the other. Dragging is how a reviewer reorders a climb they are reading — it moves
 * a rung several places in one gesture, which is what building a climb easiest-first
 * actually involves — while the buttons remain the precise, always-visible way to
 * nudge one step, and are what a reviewer reaches for on a trackpad or without a
 * pointer at all. The handle is a real `<button>` so it takes focus and dnd-kit's
 * keyboard sensor can lift it too.
 */
function SortableRung({
  id,
  rung,
  index,
  total,
  label,
  runsPerCell,
  onMove,
  onRunsChange,
  onRemove,
}: {
  id: string;
  rung: LadderRungInput;
  index: number;
  /** How many rungs the climb has, so the ends know not to offer a move off it. */
  total: number;
  /** The rung's case named as a reviewer sees it, for the row and its drag handle. */
  label: string;
  /** The ladder's default target, shown as this rung's inherited placeholder. */
  runsPerCell: number;
  onMove: (to: number) => void;
  onRunsChange: (runs: number | undefined) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      className={`${ladder.rungEditItem} ${
        isDragging ? ladder.rungEditItemDragging : ""
      }`}
      style={{
        // Translate rather than the full transform: a sorting list only ever needs to
        // slide rows past each other, and scaling a row mid-drag would resize the
        // number field the reviewer is dragging past.
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <button
        type="button"
        className={ladder.rungDragHandle}
        {...attributes}
        {...listeners}
        aria-label={`Reorder rung ${index + 1}, ${label}`}
      >
        ⠿
      </button>
      <span className={ladder.rungEditIndex}>{index + 1}</span>
      <span className={ladder.rungEditName}>
        {label} · {rung.variant} · {rung.version}
      </span>
      <label className={ladder.rungEditRuns}>
        runs
        <input
          className={exec.input}
          type="number"
          min={1}
          max={100}
          step={1}
          aria-label={`Runs for rung ${index + 1}`}
          placeholder={String(runsPerCell)}
          value={rung.runs ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const n = Math.floor(Number(raw));
            onRunsChange(
              raw === "" || !Number.isFinite(n)
                ? undefined
                : Math.min(Math.max(n, 1), 100),
            );
          }}
        />
      </label>
      <span className={ladder.rungEditActions}>
        <button
          type="button"
          className={ladder.rungMove}
          aria-label={`Move rung ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          ▲
        </button>
        <button
          type="button"
          className={ladder.rungMove}
          aria-label={`Move rung ${index + 1} down`}
          disabled={index === total - 1}
          onClick={() => onMove(index + 1)}
        >
          ▼
        </button>
        <button
          type="button"
          className={styles.chipRemove}
          aria-label={`Remove rung ${index + 1}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </span>
    </li>
  );
}

/**
 * The ordered rung list: the climb itself.
 *
 * Unlike a plan's case picker this is a *sequence*, not a set, so it is rendered as a
 * numbered list that can be dragged into order rather than as pills — the order is
 * the only thing that makes a ladder a ladder, and a picker that hid it would be
 * describing a coverage plan. Each rung carries its own optional run-count override
 * so one pivotal step can demand more evidence without making the whole climb more
 * expensive.
 *
 * Reordering here is local to the draft and saved with everything else: a save
 * reconciles rungs on their stable ids, so a rung that merely moved keeps every
 * climber's recorded verdicts.
 */
export function RungListEditor({
  rungs,
  runsPerCell,
  onChange,
}: {
  rungs: LadderRungInput[];
  /** The ladder's default target, shown as each rung's inherited placeholder. */
  runsPerCell: number;
  onChange: (next: LadderRungInput[]) => void;
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

  // The category the add-a-rung dropdown is scoped to, so it offers one type's cases
  // rather than the whole catalog in a single list (as the plan's case picker does).
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const activeCategory: CatalogCategory = category ?? RUNG_CATEGORIES[0]!.value;

  // Settle on the default category once the catalog metadata resolves. `useCatalog`
  // leads with the catalog's first case, which need not sit in an eligible category —
  // move the selection to the default category's first case so the case dropdown and
  // the type agree, and so the add control is never pointed at a case a rung may not
  // hold.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || category !== null || !sel.slug) return;
    const current = slugCategory(sel.slug);
    // Wait until the selected case's catalog metadata has loaded to resolve it.
    if (current === null) return;
    initialized.current = true;
    const target = RUNG_CATEGORIES[0]!.value;
    setCategory(target);
    if (current !== target) selectFirstOf(target);
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
  const sortedCases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // slugCategory closes over summaryBySlug; the list depends on both it and the
    // selected category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  // A category with no cases in the catalog leaves the selection pointed at a case
  // the dropdown no longer offers; adding it would file a rung the picker never
  // showed, so the add-row stays disabled until the two agree.
  const selectionShown = sortedCases.some((c) => c.slug === sel.slug);

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  function move(from: number, to: number) {
    if (to < 0 || to >= rungs.length) return;
    onChange(arrayMove(rungs, from, to));
  }

  // A short drag threshold so the handle can still be clicked, focused, and
  // keyboard-lifted without a stray pixel of pointer movement starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = rungs.findIndex((r) => rungKey(r) === active.id);
    const to = rungs.findIndex((r) => rungKey(r) === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(rungs, from, to));
  }

  // Where a rung is going is the whole content of this interaction, and a reviewer
  // driving it from the keyboard cannot see the rows slide. dnd-kit's stock
  // announcements name opaque droppable ids; these name the case and the position it
  // would land at, which is what the list is showing everyone else.
  const announcements = useMemo<Announcements>(() => {
    const position = (id: UniqueIdentifier) =>
      rungs.findIndex((r) => rungKey(r) === id) + 1;
    const named = (id: UniqueIdentifier) => {
      const rung = rungs.find((r) => rungKey(r) === id);
      return rung ? testCaseName(rung.slug) : "rung";
    };
    return {
      onDragStart: ({ active }) =>
        `Picked up ${named(active.id)} at rung ${position(active.id)} of ${rungs.length}.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${named(active.id)} would become rung ${position(over.id)} of ${rungs.length}.`
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `${named(active.id)} is now rung ${position(over.id)} of ${rungs.length}.`
          : `${named(active.id)} was left where it was.`,
      onDragCancel: ({ active }) =>
        `Reordering cancelled. ${named(active.id)} is still rung ${position(active.id)}.`,
    };
  }, [rungs, testCaseName]);

  function addRung() {
    if (!selectionShown || !sel.slug || !sel.version || !sel.variant) return;
    // The same case at the same version and variant twice in one climb would be two
    // rungs a climber must clear with identical evidence — the second is always
    // already decided by the first.
    if (
      rungs.some(
        (r) =>
          r.slug === sel.slug &&
          r.version === sel.version &&
          r.variant === sel.variant,
      )
    ) {
      return;
    }
    onChange([
      ...rungs,
      { slug: sel.slug, version: sel.version, variant: sel.variant },
    ]);
  }

  return (
    <>
      {rungs.length === 0 ? (
        <p className={styles.empty}>
          No rungs yet. Add the cases to be climbed, easiest first.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          // A rung can only ever change its place in the climb, so the drag is pinned
          // to the list's own axis and bounds: nothing is dropped anywhere else, and
          // a row dragged sideways off the editor would only suggest otherwise.
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
          accessibility={{ announcements }}
        >
          <SortableContext
            items={rungs.map(rungKey)}
            strategy={verticalListSortingStrategy}
          >
            <ol className={ladder.rungEditList}>
              {rungs.map((rung, index) => (
                <SortableRung
                  key={rungKey(rung)}
                  id={rungKey(rung)}
                  rung={rung}
                  index={index}
                  total={rungs.length}
                  label={testCaseName(rung.slug)}
                  runsPerCell={runsPerCell}
                  onMove={(to) => move(index, to)}
                  onRunsChange={(runs) =>
                    onChange(
                      rungs.map((r, i) =>
                        i === index
                          ? // Dropped rather than set to null: an absent override is
                            // what "inherit the ladder's target" is on the wire.
                            runs === undefined
                            ? { ...r, runs: undefined }
                            : { ...r, runs }
                          : r,
                      ),
                    )
                  }
                  onRemove={() => onChange(rungs.filter((_, i) => i !== index))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
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
            {RUNG_CATEGORIES.map((c) => (
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
          onClick={addRung}
          disabled={
            !selectionShown || !sel.slug || !sel.version || !sel.variant
          }
        >
          + Add rung
        </button>
      </div>
    </>
  );
}
