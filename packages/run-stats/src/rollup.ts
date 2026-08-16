// Roll a set of published run summaries up into one set of figures.
//
// This exists so that a figure computed once and *frozen* — a model write-up that
// records where a model stood on the day it was reviewed — and the same figure
// recomputed *live* later are produced by the same function rather than by two
// implementations that drift. A frozen {@link RunRollup} and a live one are
// therefore directly comparable, which is what makes a "what changed since"
// reading meaningful instead of an artefact of two different definitions.
//
// The input is the `RunSummary` card, which is exactly what the snapshot's
// `runs.json` index holds. That is deliberate: a rollup costs one already-cached
// fetch and never has to walk per-run documents, so a live view stays cheap no
// matter how many runs it covers.
//
// The output is plain JSON — no `undefined`, no `Map`, no `Set` — so it can be
// serialized into a post verbatim and read back without a revival step.

import type { Rating } from "@test-cabinet/run-record/review";
import type { RunState } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { RATINGS } from "./scoring";

/** Every run state, so a rollup accounts for all of them rather than the handful
 * a given display happens to show. Mirrors `RunState` in the Rust core. */
export const RUN_STATES: readonly RunState[] = [
  "completed",
  "catastrophic",
  "timed_out",
  "harness_error",
  "hung",
  "infrastructure",
];

/**
 * A figure summed across runs where **not reporting it is distinct from
 * reporting zero**. Token counts and costs are both optional per run — a harness
 * that does not break out cached reads, or a model whose prices could not be
 * resolved, reports nothing rather than `0` — so a bare sum would quietly present
 * a partial total as a complete one.
 */
export interface SummedMetric {
  /** The sum over the runs that reported the figure. */
  total: number;
  /** How many runs reported it — the number `total` is actually a sum over. */
  reported: number;
  /** How many runs did not report it. Unknown, *not* zero. */
  unknown: number;
}

/** The reviewer-score standing across a rolled-up set of runs. */
export interface ScoreRollup {
  /**
   * The pooled points: every run's mean earned weight summed, over every run's
   * available weight summed. Weighted by case size — a big checklist counts for
   * more — which is the right reading for "how many of the points on offer did
   * this model take".
   */
  earned: number;
  /** The total weight available across the scored runs. */
  total: number;
  /** {@link earned} over {@link total}, or null when no points were on offer. */
  fraction: number | null;
  /**
   * The unweighted mean of each run's own earned/total fraction. Every run counts
   * once regardless of its checklist size, which is the right reading for "how
   * well did this model do on a typical case". Null when no scored run had any
   * points on offer.
   */
  meanFraction: number | null;
  /** How many runs carried a score — the denominator of {@link meanFraction}. */
  runs: number;
}

/** The figures a set of runs rolls up to. Plain JSON, and stable for a given set
 * of runs regardless of the order they arrive in. */
export interface RunRollup {
  /** How many runs the rollup covers. */
  runs: number;
  /** The covered run ids, sorted. The identity of the set: a frozen rollup and a
   * live one can be diffed on this to say exactly which runs are new. */
  runIds: string[];
  /** How the runs ended, by state. Every {@link RUN_STATES} key is present. */
  outcomes: Record<RunState, number>;
  /** The share of runs that reached `completed`, or null when there are no runs. */
  completionRate: number | null;
  /** How many runs carry each overall rating. Every {@link RATINGS} key is
   * present; a run with no rating is counted in {@link unrated} instead. */
  ratings: Record<Rating, number>;
  /** How many runs carry no overall rating at all. */
  unrated: number;
  /** The reviewer-score standing, or null when no run carries a score. */
  score: ScoreRollup | null;
  /** How many reviews the covered runs carry in total. */
  reviews: number;
  /** How many distinct test cases (by slug) the runs cover. */
  testCases: number;
  /** How many distinct harnesses (by slug) the runs cover. */
  harnesses: number;
  /** Token usage, per class. Each is optional per run — see {@link SummedMetric}. */
  tokens: {
    uncachedInput: SummedMetric;
    cachedInput: SummedMetric;
    output: SummedMetric;
    reasoning: SummedMetric;
  };
  /** Cost, both ways it is recorded. Optional per run — see {@link SummedMetric}. */
  cost: {
    comparable: SummedMetric;
    actual: SummedMetric;
  };
  /** Total wall-clock seconds across the runs. Always recorded, so a plain sum. */
  runTimeSeconds: number;
  /** When the earliest covered run started, or null when there are no runs. */
  firstRunAt: string | null;
  /** When the latest covered run finished, or null when there are no runs. */
  lastRunAt: string | null;
}

// Accumulate one optional figure, keeping the reported and unknown counts apart.
function sumOptional(values: readonly (number | null)[]): SummedMetric {
  let total = 0;
  let reported = 0;
  let unknown = 0;
  for (const value of values) {
    if (value == null) unknown += 1;
    else {
      total += value;
      reported += 1;
    }
  }
  return { total, reported, unknown };
}

// The lexicographically smallest/largest of the given timestamps, or null when
// there are none. The contract's timestamps are RFC 3339 in UTC, so ordering them
// as strings orders them chronologically without parsing.
function earliest(values: readonly string[]): string | null {
  return values.reduce<string | null>(
    (min, value) => (min === null || value < min ? value : min),
    null,
  );
}

function latest(values: readonly string[]): string | null {
  return values.reduce<string | null>(
    (max, value) => (max === null || value > max ? value : max),
    null,
  );
}

/**
 * Roll `summaries` up into one set of figures.
 *
 * The caller decides what the set *is* — every run of one model, of one case, of
 * one harness, or the whole cabinet. This function only reduces it, so the same
 * rollup shape describes any of those.
 *
 * The result depends only on the set's contents, not on its order, so freezing
 * one and recomputing it later compares like for like.
 */
export function rollupRuns(summaries: readonly RunSummary[]): RunRollup {
  const outcomes = Object.fromEntries(
    RUN_STATES.map((state) => [state, 0]),
  ) as Record<RunState, number>;
  const ratings = Object.fromEntries(
    RATINGS.map((rating) => [rating, 0]),
  ) as Record<Rating, number>;

  let unrated = 0;
  let reviews = 0;
  let runTimeSeconds = 0;
  const testCases = new Set<string>();
  const harnesses = new Set<string>();

  // Pooled score across the runs that carry one, plus each run's own fraction so
  // the unweighted mean can be taken alongside the weighted one.
  let scoreEarned = 0;
  let scoreTotal = 0;
  let scoredRuns = 0;
  const perRunFractions: number[] = [];

  const uncachedInput: (number | null)[] = [];
  const cachedInput: (number | null)[] = [];
  const output: (number | null)[] = [];
  const reasoning: (number | null)[] = [];
  const comparable: (number | null)[] = [];
  const actual: (number | null)[] = [];

  for (const run of summaries) {
    // A state outside the known set would silently vanish from `outcomes`, so
    // count it only when it is one we declared. `RUN_STATES` mirrors the contract,
    // so this is a guard against a contract addition landing unnoticed, not an
    // expected branch.
    if (run.state in outcomes) outcomes[run.state] += 1;
    if (run.rating != null) ratings[run.rating] += 1;
    else unrated += 1;

    reviews += run.reviewCount;
    runTimeSeconds += run.metrics.runTimeSeconds;
    testCases.add(run.subject.testCaseSlug);
    harnesses.add(run.subject.harnessSlug);

    if (run.score) {
      scoreEarned += run.score.earned;
      scoreTotal += run.score.total;
      scoredRuns += 1;
      // A checklist with nothing on offer has no fraction to contribute; it still
      // counts as a scored run, so the two denominators legitimately differ.
      if (run.score.total > 0) {
        perRunFractions.push(run.score.earned / run.score.total);
      }
    }

    uncachedInput.push(run.metrics.tokens.uncachedInput);
    cachedInput.push(run.metrics.tokens.cachedInput);
    output.push(run.metrics.tokens.output);
    reasoning.push(run.metrics.tokens.reasoning);
    comparable.push(run.metrics.cost.comparable);
    actual.push(run.metrics.cost.actual);
  }

  const runs = summaries.length;
  const meanFraction =
    perRunFractions.length === 0
      ? null
      : perRunFractions.reduce((sum, f) => sum + f, 0) / perRunFractions.length;

  return {
    runs,
    runIds: summaries.map((run) => run.id).sort(),
    outcomes,
    completionRate: runs === 0 ? null : outcomes.completed / runs,
    ratings,
    unrated,
    score:
      scoredRuns === 0
        ? null
        : {
            earned: scoreEarned,
            total: scoreTotal,
            fraction: scoreTotal === 0 ? null : scoreEarned / scoreTotal,
            meanFraction,
            runs: scoredRuns,
          },
    reviews,
    testCases: testCases.size,
    harnesses: harnesses.size,
    tokens: {
      uncachedInput: sumOptional(uncachedInput),
      cachedInput: sumOptional(cachedInput),
      output: sumOptional(output),
      reasoning: sumOptional(reasoning),
    },
    cost: {
      comparable: sumOptional(comparable),
      actual: sumOptional(actual),
    },
    runTimeSeconds,
    firstRunAt: earliest(summaries.map((run) => run.startedAt)),
    lastRunAt: latest(summaries.map((run) => run.finishedAt)),
  };
}
