// Per-test-case aggregation for one model, and where that model stands against
// the other models that ran the same thing.
//
// The model detail page's Overview tab is built on one rule: figures from
// different test cases are never mixed. A model's cost on a sprite case and its
// cost on a full end-to-end game say nothing when averaged together, and a
// percentile taken over that average is worse than no figure at all — it looks
// authoritative and means nothing. So everything here is scoped to a single case
// + variant cohort (the caller narrows the version scope on top), and the field a
// model is placed against is exactly the *other* models that ran that same
// cohort.
//
// This module is pure: it reduces `RunSummary` cards, which is what both hosts
// already hold (the console's backend listing, the static site's snapshot index),
// so the Overview costs no per-run document fetches.

import type { TestType } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { canonicalModelId } from "../../modelId";
import { formatSlug } from "../format";

/** One variant of a case the subject model has runs for. */
export interface ModelVariantOption {
  /** The variant slug as the run records it. */
  slug: string;
  /** Display name — the humanized slug (a variant's catalog name defaults to the
   * same humanization, and the run card carries no variant name). */
  name: string;
  /** How many of the model's runs are of this variant. */
  runs: number;
}

/** One test case the subject model has runs for, with the variants it covers. */
export interface ModelCaseOption {
  slug: string;
  /** The case's display name, denormalized onto the run card. */
  name: string;
  /** The case's test type, so the picker can group jams apart from test cases. */
  testType: TestType;
  /** How many of the model's runs are of this case, across every variant. */
  runs: number;
  /** When the model most recently started a run of this case, for the tie-break
   * and for showing recency in the picker. */
  latestStartedAt: string;
  /** The variants the model has runs for, most-run first. Never empty. */
  variants: ModelVariantOption[];
}

/**
 * The cases (and their variants) one model has runs for, most-run first with the
 * more recently exercised case winning a tie.
 *
 * Built from the model's own run cards rather than the case catalog on purpose:
 * the picker should offer exactly what there is data for, so switching cases can
 * never land on an empty aggregation. It also keeps the Overview catalog-free and
 * therefore identical on the static site and the consoles.
 */
export function modelCaseOptions(
  summaries: readonly RunSummary[],
): ModelCaseOption[] {
  interface Building extends Omit<ModelCaseOption, "variants"> {
    variants: Map<string, ModelVariantOption>;
  }
  const cases = new Map<string, Building>();

  for (const run of summaries) {
    const { testCaseSlug, variant, testType } = run.subject;
    let entry = cases.get(testCaseSlug);
    if (!entry) {
      entry = {
        slug: testCaseSlug,
        // The denormalized name is the display title; fall back to humanizing the
        // slug for a card old enough to carry an empty one.
        name: run.caseName || formatSlug(testCaseSlug),
        testType,
        runs: 0,
        latestStartedAt: run.startedAt,
        variants: new Map(),
      };
      cases.set(testCaseSlug, entry);
    }
    entry.runs += 1;
    if (run.startedAt > entry.latestStartedAt) {
      entry.latestStartedAt = run.startedAt;
    }
    const seen = entry.variants.get(variant);
    if (seen) seen.runs += 1;
    else {
      entry.variants.set(variant, {
        slug: variant,
        name: formatSlug(variant),
        runs: 1,
      });
    }
  }

  return [...cases.values()]
    .map((entry) => ({
      ...entry,
      variants: [...entry.variants.values()].sort(compareVariants),
    }))
    .sort(compareCases);
}

// Most-run first, then the more recently exercised case, then the slug — a total
// order, so the picker does not reshuffle between renders.
function compareCases(a: ModelCaseOption, b: ModelCaseOption): number {
  if (a.runs !== b.runs) return b.runs - a.runs;
  if (a.latestStartedAt !== b.latestStartedAt) {
    return a.latestStartedAt < b.latestStartedAt ? 1 : -1;
  }
  return compareSlug(a.slug, b.slug);
}

// Most-run first, then the slug. A variant card carries no timestamp of its own,
// so the slug is the whole tie-break.
function compareVariants(a: ModelVariantOption, b: ModelVariantOption): number {
  if (a.runs !== b.runs) return b.runs - a.runs;
  return compareSlug(a.slug, b.slug);
}

function compareSlug(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a run was produced by the model covering `modelIds`.
 *
 * Exact membership resolves the ordinary case — the catalog records the raw ids a
 * model covers — with a harness-aware canonical comparison as the fallback, so a
 * run recorded under an `openrouter/`-prefixed or `:free`-tagged form of a covered
 * id still counts as this model's (the same rule `findModelByModelId` applies).
 */
export function runIsModel(
  run: RunSummary,
  modelIds: readonly string[],
): boolean {
  const raw = run.subject.modelId;
  if (modelIds.includes(raw)) return true;
  const canonical = canonicalModelId(raw, run.subject.harnessSlug);
  return modelIds.some((id) => canonicalModelId(id) === canonical);
}

/** Where one model's figure lands among the models it shares a cohort with. */
export interface FieldStanding {
  /** The subject model's mean of the measured figure across the cohort. */
  value: number;
  /** How many of the subject's runs reported the figure — the denominator of
   * {@link value}, which is smaller than the cohort when a harness didn't report
   * it. */
  reported: number;
  /**
   * The share (0..1) of the *other* models whose mean is strictly below the
   * subject's. Read with the measure's polarity: for cost this is "more expensive
   * than", for a score it is "better than". `null` when the subject is the only
   * model in the field, where there is nothing to compare against.
   */
  greaterThan: number | null;
  /** 1-based rank ascending (1 = the lowest mean) among every model in the field,
   * the subject included. Ties share the better (lower) rank. */
  rank: number;
  /** How many models are in the field, the subject included. */
  fieldSize: number;
  /** The lowest and highest mean in the field, for placing `value` on a scale. */
  min: number;
  max: number;
}

/** One model's mean of a measured figure over a cohort. */
interface FieldEntry {
  /** The grouping key: the subject's marker, or a canonical model id. */
  key: string;
  mean: number;
  /** How many runs reported the figure. */
  reported: number;
}

// The key the subject model's runs group under. A NUL prefix cannot collide with
// a model id, and — written as an escape rather than a literal byte — keeps this
// file free of the NUL bytes the repo's commit hook rejects. (The same escape is
// used as a join separator in `useModelRunSummaries`.)
const SUBJECT_KEY = "\u0000subject";

/**
 * Place the subject model against every other model in `cohort` on one measured
 * figure.
 *
 * `cohort` must already be narrowed to a single comparable set — one case, one
 * variant, one version scope, completed runs only. Nothing here re-checks that,
 * because the caller is the only one that knows which scope the visitor picked;
 * handing it a mixed set produces a confident, meaningless number.
 *
 * A run whose figure is unreported (`value` returns null) is skipped rather than
 * counted as zero, and a model with no reported run at all is left out of the
 * field entirely — a model we cannot price is not "the cheapest".
 *
 * Returns `null` when the subject model reported the figure on no run, since
 * there is then no value to place.
 */
export function standInField(
  cohort: readonly RunSummary[],
  modelIds: readonly string[],
  value: (run: RunSummary) => number | null,
): FieldStanding | null {
  const totals = new Map<string, { sum: number; reported: number }>();
  for (const run of cohort) {
    const measured = value(run);
    if (measured === null) continue;
    const key = runIsModel(run, modelIds)
      ? SUBJECT_KEY
      : canonicalModelId(run.subject.modelId, run.subject.harnessSlug);
    const acc = totals.get(key);
    if (acc) {
      acc.sum += measured;
      acc.reported += 1;
    } else {
      totals.set(key, { sum: measured, reported: 1 });
    }
  }

  const entries: FieldEntry[] = [...totals].map(([key, acc]) => ({
    key,
    mean: acc.sum / acc.reported,
    reported: acc.reported,
  }));
  const subject = entries.find((entry) => entry.key === SUBJECT_KEY);
  if (!subject) return null;

  const others = entries.filter((entry) => entry.key !== SUBJECT_KEY);
  const means = entries.map((entry) => entry.mean);

  return {
    value: subject.mean,
    reported: subject.reported,
    // Strictly below, so models tied with the subject are not counted as beaten.
    greaterThan:
      others.length === 0
        ? null
        : others.filter((entry) => entry.mean < subject.mean).length /
          others.length,
    rank: means.filter((mean) => mean < subject.mean).length + 1,
    fieldSize: entries.length,
    min: Math.min(...means),
    max: Math.max(...means),
  };
}

/**
 * The subject model's mean of a figure over the cohort, ignoring runs that did
 * not report it. `null` when no run reported it — distinct from a mean of zero.
 */
export function meanReported(
  runs: readonly RunSummary[],
  value: (run: RunSummary) => number | null,
): number | null {
  let sum = 0;
  let reported = 0;
  for (const run of runs) {
    const measured = value(run);
    if (measured === null) continue;
    sum += measured;
    reported += 1;
  }
  return reported === 0 ? null : sum / reported;
}
