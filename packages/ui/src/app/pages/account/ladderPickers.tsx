import { useEffect, useMemo, useRef, useState } from "react";
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

/** The longer form shown under the picker, saying what the choice buys. */
const LADDER_AXIS_HINTS: Readonly<Record<LadderAxis, string>> = {
  rung: "Every climber comes up a rung before anyone moves on, so a rung's runs arrive together and the models can be judged against each other on the same case.",
  combination:
    "One climber goes as high as it can before the next one starts, so you find out how far a single model gets soonest.",
};

/** The order a ladder's runs will arrive in, named the way the console names it. */
export function ladderAxisLabel(axis: LadderAxis): string {
  return LADDER_AXIS_LABELS[axis];
}

/**
 * The ordering control: two mutually exclusive pills over {@link LADDER_AXIS_LABELS}.
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
    <>
      <div
        className={styles.kindRow}
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
      <p className={styles.fieldHint}>{LADDER_AXIS_HINTS[value]}</p>
    </>
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
    return `At ${total} runs a rung, this gate demands nothing: every climber advances past every rung. Raise the threshold to make the ladder able to stop anyone.`;
  }
  const decides = gate.earlyStop
    ? "The rung is decided as soon as the outcome is certain, and its remaining runs are cancelled."
    : "The rung still finishes all of its runs either way — the evidence is worth having even once the outcome is certain.";
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
      <div className={ladder.gateRow}>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Counts as clearing the rung</span>
          <select
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
        </label>
        <label className={exec.runCountField}>
          <span className={exec.fieldLabel}>How many must clear it</span>
          <input
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
        </label>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Measured as</span>
          <select
            className={exec.select}
            value={gate.threshold.kind}
            // Switching unit re-seeds the amount rather than reinterpreting it: "50"
            // means half as a percentage and fifty runs as a count, and silently
            // carrying the number across would change the gate by an order of
            // magnitude on a control the reviewer only meant to relabel.
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
        </label>
      </div>
      <p className={ladder.gateExample}>
        {describeGate(gate)} {gateExample(gate, runsPerCell)}
      </p>

      <label className={styles.controlToggle}>
        <input
          type="checkbox"
          checked={gate.unloadedCountsAsBroken}
          onChange={(e) =>
            onChange({ ...gate, unloadedCountsAsBroken: e.target.checked })
          }
        />
        Count a run whose build never loaded as broken, without a review
      </label>
      <p className={styles.fieldHint}>
        On by default. There is nothing for a reviewer to judge in a build that
        does not load, so counting it immediately keeps it from blocking the
        climb and from occupying a slot in your review buffer. Turn it off only
        if you want to look at every one of them yourself.
      </p>

      <label className={styles.controlToggle}>
        <input
          type="checkbox"
          checked={gate.earlyStop}
          onChange={(e) => onChange({ ...gate, earlyStop: e.target.checked })}
        />
        Decide a rung early and cancel its remaining runs
      </label>
      <p className={styles.fieldHint}>
        Off by default: a rung <strong>completes all of its runs</strong> even
        once the verdict is certain, because those runs are evidence in their
        own right — five runs of a case on a model are worth having in full.
        Turn this on when you are spending real money to find a wall and do not
        need the rest.
      </p>
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
 * The ordered rung list: the climb itself.
 *
 * Unlike a plan's case picker this is a *sequence*, not a set, so it is rendered as a
 * numbered list with explicit move controls rather than as pills — the order is the
 * only thing that makes a ladder a ladder, and a picker that hid it would be
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
    const next = [...rungs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  }

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
          No rungs yet. Add the cases you want climbed, easiest first — the
          order is the climb, and a model that walls on one rung never reaches
          the next.
        </p>
      ) : (
        <ol className={ladder.rungEditList}>
          {rungs.map((rung, index) => (
            <li
              key={rung.id ?? `${rung.slug}@${rung.version}@${rung.variant}`}
              className={ladder.rungEditItem}
            >
              <span className={ladder.rungEditIndex}>{index + 1}</span>
              <span className={ladder.rungEditName}>
                {testCaseName(rung.slug)} · {rung.variant} · {rung.version}
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
                    const runs =
                      raw === "" || !Number.isFinite(n)
                        ? undefined
                        : Math.min(Math.max(n, 1), 100);
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
                  onClick={() => move(index, index - 1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={ladder.rungMove}
                  aria-label={`Move rung ${index + 1} down`}
                  disabled={index === rungs.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove rung ${index + 1}`}
                  onClick={() => onChange(rungs.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
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
      <p className={styles.fieldHint}>
        Performance cases and game jams cannot be rungs: the first is graded
        automatically and never reaches a reviewer, the second is scored on the
        graded category scale and records no rating — so a gate over either
        could never resolve and the climber would stall with nothing looking
        wrong.
      </p>
    </>
  );
}
