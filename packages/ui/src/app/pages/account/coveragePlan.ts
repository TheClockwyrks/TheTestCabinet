import type {
  CoverageAxis,
  CoverageCell,
  CoverageMatrix,
  HaltResult,
  TopUpBlocked,
  TopUpResult,
} from "@clockwyrks/run-record/coverage";
import type { GgCapabilitySet } from "@clockwyrks/run-record/gg";
import type { BackendClient, WorkerClient } from "../../../client/clients";
import type { InProgressRun } from "../../../client/types";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { GG_HARNESS_SLUG } from "../../data/runLinks";
import { bindModelSlots } from "../runs/gg/ggConfigDraft";
import { findGgConfig, type GgConfigOption } from "../runs/gg/useGgConfigs";
import { routes } from "../../routes";
import type { LaunchItem } from "../runs/launchBatch";
import { bufferIsFull, formatBufferTarget } from "./bufferTarget";
import {
  comboLabel,
  ggConfigKey,
  isGgCombo,
  type CombinationLike,
} from "./comboLabels";
import { caseEngine, caseQualifier } from "./caseLabels";

// The pure half of the coverage plan dashboard: how a cell is identified, what a
// trigger launches, and how an action's outcome is worded. It holds no JSX and reaches
// no React state, so the dashboard's three tabs, the ladder, and the review editor can
// all share it without importing a page.

// The gg half of a cell's identity: the configuration it names, and exactly which model
// it bound to each launch slot. Both halves are load-bearing — one configuration run on
// two root models is two arms of a study, and two members differing only on a
// subagent's model are two more — so a key built from the harness and the root model
// alone would silently merge cells the plan deliberately keeps apart. It keys on the
// whole slot map rather than on the de-duplicated model list the label uses, because a
// key must never collide and two members that swapped one model between two slots bind
// the same set of models.
//
// The configuration is named by its id, which is what the server keys a cell on: two of
// an account's configurations may carry one name, and a key built from the name would
// hand React one key for the two cells that pair produces.
//
// Empty for a harness cell, which leaves its key byte-identical to what it always was.
function ggIdentity(c: CombinationLike): string {
  if (!isGgCombo(c)) return "";
  const slots = Object.entries(c.ggSlotModels ?? {})
    .map(([slot, model]) => `${slot}=${model}`)
    .sort()
    .join(",");
  return `${ggConfigKey(c.ggConfigId)}/${slots}`;
}

/**
 * A cell's identity, so a group's cells and a trigger's target line up.
 *
 * It carries the gg half because the matrix does: a plan crossing one configuration
 * against three models produces three cells whose case, harness and root model can all
 * agree, and React given one key for the three of them renders one row and silently
 * drops the rest.
 */
export function cellKey(
  c: {
    slug: string;
    version: string;
    variant: string;
    engine?: string | null;
  } & CombinationLike,
): string {
  return `${c.slug}@${c.version}@${c.variant}@${caseEngine(c)}::${c.harness}::${c.model}::${ggIdentity(c)}`;
}

// The group a cell belongs to under the plan's ordering. The dashboard groups on
// whichever axis the plan's schedule nests on, so the page is laid out in the order
// the runs will actually arrive: grouping a "one model at a time" plan by case would
// scatter each model's contiguous block of runs across every block on the page.
function groupKey(cell: CoverageCell, axis: CoverageAxis): string {
  return axis === "case"
    ? // The engine is in the case key because it is in the pin: one case at one
      // version and variant on two engines is two blocks, and a key without it would
      // roll their cells into one block whose heading described neither.
      `${cell.slug}@${cell.version}@${cell.variant}@${caseEngine(cell)}`
    : `${cell.harness}::${cell.model}::${ggIdentity(cell)}`;
}

/**
 * The launch items for a set of coverage cells — `remaining` runs per cell, each
 * config resolved exactly as the new-run form does (provider prefix applied for
 * provider-routed harnesses; the cell's own engine; the default one-shot
 * orchestrator, since a plan does not pin one).
 *
 * **Harness cells only.** A gg cell is configured by a capability set rather than a
 * `(harness, model, orchestrator)` tuple and has no batch endpoint at all, so it is
 * launched by {@link planGgLaunches} and {@link launchGgCells} instead.
 *
 * A cell the matrix marked [unlaunchable](CoverageCell.unlaunchable) is skipped by
 * both. What is broken there is the member, not the trigger, so launching it by hand
 * would fail in exactly the way the top-up already reported.
 */
export function itemsForCells(cells: CoverageCell[]): LaunchItem[] {
  return cells
    .filter((cell) => !isGgCombo(cell) && !cell.unlaunchable)
    .flatMap((cell) =>
      Array.from({ length: cell.remaining }, () => ({
        config: {
          testCase: cell.slug,
          version: cell.version,
          variant: cell.variant,
          harness: cell.harness,
          modelId: resolveLaunchModel(
            cell.harness,
            cell.provider ?? OPENROUTER_PROVIDER,
            cell.model,
          ),
          orchestrator: DEFAULT_ORCHESTRATOR_SLUG,
          // The cell's own engine, named rather than defaulted. The engine is a
          // segment of the cell's identity, so a run launched engineless from a cell
          // pinned to a runtime is counted against a different cell — leaving the one
          // that asked for it short by exactly the run just paid for, and pressable
          // again forever. This is the by-hand half of what a top-up does server-side
          // (`top_up_launch_body`), and the two must agree on the whole pin.
          engine: caseEngine(cell),
          maxRuntimeOverride: null,
        },
        track: {
          testCaseSlug: cell.slug,
          testCaseVersion: cell.version,
          variant: cell.variant,
          harnessSlug: cell.harness,
          modelId: cell.model,
          // Tracked as launched, so the in-flight row is filed under the cell that
          // launched it while it runs, as the produced record will be after.
          engine: caseEngine(cell),
        },
      })),
    );
}

/** One gg run a trigger will enqueue: the cell it fills, and the set that fills it. */
export interface GgCellLaunch {
  /** The cell this run counts against. */
  cell: CoverageCell;
  /**
   * The configuration as the account saved it, with this cell's models bound onto its
   * launch slots — the same set the new-run form's gg mode submits.
   */
  capabilitySet: GgCapabilitySet;
}

/** What {@link planGgLaunches} resolved a set of cells into. */
export interface GgCellPlan {
  /** One entry per run to enqueue, in cell order, repeats adjacent. */
  launches: GgCellLaunch[];
  /**
   * The gg cells naming a configuration this account cannot resolve *right now* —
   * reported rather than dropped, because a trigger that quietly launched fewer runs
   * than it was asked for is a trigger nobody can debug. The matrix normally flags
   * such a cell `unlaunchable` first; this catches the narrower case of a
   * configuration deleted since the page loaded.
   */
  unresolved: CoverageCell[];
}

/**
 * Resolve a set of coverage cells into the gg runs a trigger should enqueue —
 * `remaining` per cell, each carrying the cell's own models bound onto its
 * configuration's launch slots.
 *
 * This is the by-hand half of what a top-up does server-side, and it binds through the
 * same {@link bindModelSlots} the new-run form uses, so a cell triggered from the
 * dashboard produces the identical capability set — and therefore the identical cell
 * identity — as one the plan enqueued for itself. Anything less and the run a reviewer
 * triggered would not count against the cell they triggered it from.
 */
export function planGgLaunches(
  cells: CoverageCell[],
  options: GgConfigOption[],
): GgCellPlan {
  const launches: GgCellLaunch[] = [];
  const unresolved: CoverageCell[] = [];
  for (const cell of cells) {
    // `ggConfigId` directly rather than `isGgCombo`, which returns a boolean and so
    // does not narrow the id away from `undefined` for the lookup below.
    if (!cell.ggConfigId || cell.unlaunchable) continue;
    const option = findGgConfig(options, cell.ggConfigId);
    if (!option) {
      unresolved.push(cell);
      continue;
    }
    const capabilitySet = bindModelSlots(
      option.capabilitySet,
      cell.ggSlotModels ?? {},
    );
    for (let i = 0; i < cell.remaining; i += 1) {
      launches.push({ cell, capabilitySet });
    }
  }
  return { launches, unresolved };
}

/**
 * Enqueue a plan's gg cells, one `POST /gg/runs` each, and report the ones that failed.
 *
 * gg has no batch endpoint — a run is configured by a capability set rather than a flat
 * launch body — so the fan-out is sequential and every launch is isolated: a
 * configuration the backend refuses must not take the rest of the trigger down with it,
 * exactly as `launchBatch` isolates a harness batch server-side.
 *
 * Each enqueued run is registered with the runs runtime here, because it does not travel
 * through `launchBatch` and would otherwise be missing from the Runs page's in-progress
 * list for its whole life.
 *
 * **These jobs carry no plan origin.** `POST /gg/runs` takes no `origin` query the way
 * `POST /jobs` does, so a gg run triggered from a plan cell sits outside that plan's
 * scoped halt and must be stopped from the Runs page instead. The plan's own top-up is
 * unaffected: it mints its jobs server-side and attributes them itself.
 */
export async function launchGgCells(
  worker: { client: WorkerClient },
  token: string | null,
  track: (run: InProgressRun) => void,
  launches: GgCellLaunch[],
): Promise<{ cell: CoverageCell; error: string }[]> {
  const failures: { cell: CoverageCell; error: string }[] = [];
  for (const { cell, capabilitySet } of launches) {
    try {
      const ack = await worker.client.launchGgRun(
        {
          testCase: cell.slug,
          version: cell.version,
          variant: cell.variant,
          capabilitySet,
          // The cell's own engine, exactly as the harness cells beside it send it: a
          // gg run seeds and builds a workspace like any other run, and the engine is
          // a segment of the cell it counts against. No runtime override, because a
          // plan pins none and the case's own runtime applies.
          engine: caseEngine(cell),
        },
        token ?? "",
      );
      track({
        testCaseSlug: cell.slug,
        testCaseVersion: cell.version,
        variant: cell.variant,
        harnessSlug: GG_HARNESS_SLUG,
        // Read off the set that was actually sent rather than the cell, so the identity
        // shown now is byte-identical to the one the backend lifts back out of the job.
        modelId: capabilitySet.agents?.[0]?.modelId ?? "",
        engine: caseEngine(cell),
        ggPreset: capabilitySet.preset ?? null,
        runId: ack.jobId,
        state: "queued",
      });
    } catch (e) {
      failures.push({
        cell,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return failures;
}

// The runs listing narrowed to exactly this cell — the link that turns a progress
// bar into the runs behind it, which is half of the review loop this page exists to
// serve. The keys mirror the run filters' URL params (`useRunFilters`), which is
// what makes a narrowed listing linkable at all.
//
// `latest=0` because a cell pins an exact version: the listing's "current versions
// only" default is on, and would filter a deliberately-pinned older version's runs
// away, leaving an empty page for a cell that plainly has runs. Neither the variant
// nor the engine is a facet the listing offers, so a case's cells that differ only on
// one of those share a link.
//
// A gg cell adds the configuration's id as the listing's `ggConfigId` filter, the
// same value the cell's own counts group on, so the rows behind the figure are exactly
// the rows the link lands on. The id and never the name: the runs recorded before a
// rename carry the old name, and another account's same-named configuration carries
// this one, so a name narrows to a set the count was never made of.
export function cellRunsHref(cell: CoverageCell): string {
  const ggConfigId = ggConfigKey(cell.ggConfigId);
  const params = new URLSearchParams({
    case: cell.slug,
    version: cell.version,
    harness: cell.harness,
    model: cell.model,
    latest: "0",
    ...(ggConfigId ? { ggConfigId } : {}),
  });
  return `${routes.runs()}?${params.toString()}`;
}

/** One block of the dashboard: the cells sharing an outer-axis value, rolled up. */
export interface MatrixGroup {
  /** The group's identity (its React key). */
  key: string;
  /** The block's heading — a case name, or a combination as {@link comboLabel}
   *  reads it. */
  title: string;
  /** The muted qualifier beside the heading — a case's pin, as {@link caseQualifier}
   *  spells it. */
  subtitle: string;
  /** The cells in this block, in the plan's own emission order. */
  cells: CoverageCell[];
  /** Completed plus in-flight runs, the block's "done" count. */
  done: number;
  /** The block's target run count. */
  desired: number;
  /** In-flight jobs the queue is deliberately holding back. */
  pending: number;
  /** Completed runs the signed-in account has not reviewed. */
  unreviewed: number;
  /** The completed segment's width, as a percentage. */
  donePct: number;
  /** The in-flight segment's width, as a percentage (stacked after `donePct`). */
  flightPct: number;
}

// The two stacked bar segments for a set of counts: completed (green) first, then
// in-flight (amber) filling what is left, so the two can never overflow the track
// even when a cell has more runs than the target asks for.
export function barWidths(
  completed: number,
  inFlight: number,
  desired: number,
): { donePct: number; flightPct: number } {
  if (desired <= 0) return { donePct: 0, flightPct: 0 };
  const donePct = Math.min(100, (completed / desired) * 100);
  return {
    donePct,
    flightPct: Math.min(100 - donePct, (inFlight / desired) * 100),
  };
}

/**
 * Group a matrix's cells for display on its plan's own ordering axis, preserving
 * the order the backend emitted them in.
 *
 * The order is not incidental and is deliberately *not* re-sorted alphabetically:
 * the matrix arrives in the plan's emission order, which is the order a top-up
 * enqueues cells and therefore — `job.queue_seq` being monotonic and the dispatcher
 * claiming in ascending order — the order the runs execute and land for review. A
 * page sorted by name would describe a different plan than the one running.
 */
export function buildGroups(
  coverage: CoverageMatrix,
  testCaseName: (slug: string) => string,
): MatrixGroup[] {
  const byKey = new Map<string, CoverageCell[]>();
  for (const cell of coverage.cells) {
    const key = groupKey(cell, coverage.outerAxis);
    const cells = byKey.get(key);
    if (cells) cells.push(cell);
    else byKey.set(key, [cell]);
  }
  return [...byKey.entries()].map(([key, cells]) => {
    const cell0 = cells[0]!;
    const sum = (pick: (c: CoverageCell) => number) =>
      cells.reduce((total, c) => total + pick(c), 0);
    const completed = sum((c) => c.completed);
    const inFlight = sum((c) => c.inFlight);
    const desired = sum((c) => c.desired);
    return {
      key,
      title:
        coverage.outerAxis === "case"
          ? testCaseName(cell0.slug)
          : comboLabel(cell0),
      subtitle: coverage.outerAxis === "case" ? caseQualifier(cell0) : "",
      cells,
      done: completed + inFlight,
      desired,
      pending: sum((c) => c.pending),
      unreviewed: sum((c) => c.unreviewed),
      ...barWidths(completed, inFlight, desired),
    };
  });
}

/**
 * The cells a top-up wanted and could not have, as a trailing sentence — shared by the
 * plan's report and the ladder's.
 *
 * It trails whatever else the top-up did rather than replacing it, because one broken
 * member never stops the rest of a plan being fed: "enqueued six runs" and "two cells
 * are broken" are routinely both true, and a reviewer who is told only the first will
 * spend a long time wondering where the other runs went. The first reason is quoted
 * in full because the reasons are usually the same one repeated (a configuration
 * deleted, a slot left unbound), and the count says how far it reaches.
 */
export function describeUnlaunchable(blocked: TopUpBlocked[]): string {
  const first = blocked[0];
  if (!first) return "";
  const cells = `${blocked.length} cell${blocked.length === 1 ? "" : "s"}`;
  const more = blocked.length > 1 ? " (and others)" : "";
  return ` ${cells} could not be launched: ${first.reason}${more}.`;
}

/**
 * What a top-up actually did, in one sentence.
 *
 * Every outcome has to read differently, because the reviewer's next move differs
 * for each: a halted plan wants pressing again, a busy one wants nothing (another tab
 * is already doing the work), a full buffer wants *reviews* rather than more runs, and
 * a satisfied plan wants a bigger target or nothing at all. "Top up did nothing" for
 * all four is the failure mode this exists to avoid — and a plan whose members are
 * broken is a fifth, which is why the blocked cells trail every outcome the scheduler
 * actually reached.
 */
export function describeTopUp(result: TopUpResult): string {
  // Only reachable by a race: the button clears a halt before it tops up, and the
  // on-open call is not made while one stands. So this is "somebody else, just now".
  if (result.skipped === "paused") {
    return (
      "Nothing was enqueued: this plan was halted from another tab just now. " +
      "Press Top up now to refill it anyway."
    );
  }
  if (result.skipped === "busy") {
    return "A top-up for this plan was already running, so nothing was enqueued twice.";
  }
  const blocked = describeUnlaunchable(result.unlaunchable);
  if (result.enqueued > 0) {
    const runs = `${result.enqueued} run${result.enqueued === 1 ? "" : "s"}`;
    const cells = `${result.cells.length} cell${result.cells.length === 1 ? "" : "s"}`;
    return `Enqueued ${runs} across ${cells}, in the order this plan runs them.${blocked}`;
  }
  const outstanding = result.outstanding ?? 0;
  if (bufferIsFull(result.bufferTarget, outstanding)) {
    return (
      `Nothing enqueued: your review buffer is full (${outstanding} of ` +
      `${formatBufferTarget(result.bufferTarget)} outstanding). Review some runs and top up again.${blocked}`
    );
  }
  if (blocked) {
    return `Nothing enqueued: every cell is either at its target or unlaunchable.${blocked}`;
  }
  return "Nothing left to enqueue: every cell is at its target.";
}

/**
 * Whether the by-hand trigger controls can be pressed given the state of the account's
 * gg configurations, and what to say when something is wrong with them.
 *
 * Triggering a gg cell needs the capability set behind its configuration, which only
 * `useGgConfigs` has — so the press is held until the configurations are in hand.
 * Pressed a moment earlier it resolves every gg cell to nothing and reports the
 * operator's *own* configurations as deleted, while the harness cells of the same press
 * launch normally: a false statement about their data, in the one place they would
 * believe it.
 *
 * A failure to load is a different sentence from "still loading", and both are
 * different from "you have none saved": the first two are temporary and say nothing
 * about what the account holds. So an error is said out loud and, unlike loading, does
 * not disable the controls — the harness half of a plan is still perfectly launchable,
 * and the gg half reports the load failure as its reason rather than a deletion.
 */
export function ggTriggerReadiness(
  loading: boolean,
  error: string | null,
): { ready: boolean; notice: string | null } {
  return {
    ready: !loading,
    notice: error
      ? "Your saved gg configurations could not be loaded, so gg cells cannot be " +
        "triggered by hand and may be reported as unresolved. Harness cells are " +
        "unaffected, and this plan's own top-up runs on the backend regardless. " +
        error
      : null,
  };
}

/**
 * Why a gg cell a trigger asked for was not launched, when its configuration could not
 * be resolved from the account's saved ones.
 *
 * "That configuration is no longer on your account" is true only when the configurations
 * are actually in hand. When the load itself failed, the account may hold twenty of
 * them, and telling an operator their data is gone — on the evidence of a request that
 * never arrived — is worse than saying nothing at all.
 */
export function unresolvedGgProblem(
  cell: CoverageCell,
  ggError: string | null,
): string {
  return ggError
    ? `${comboLabel(cell)}: your saved gg configurations could not be loaded, so this cell was not launched.`
    : `${comboLabel(cell)}: that gg configuration is no longer on your account.`;
}

/**
 * What a halt cancelled. The count is the point: "the queue was already empty" and
 * "nothing I launched was found" call for opposite next moves and are otherwise
 * indistinguishable, so a halt that merely succeeded quietly is a halt the reviewer
 * cannot act on. That the halt also switched auto top-up off is not restated here:
 * the switch itself moves, and a sentence saying so would say it twice.
 */
export function describeHalt(result: HaltResult): string {
  const scope = result.includedActive
    ? "including runs already executing"
    : "that had not started";
  if (result.canceled === 0) {
    return `No jobs of this plan were waiting to cancel (${scope}).`;
  }
  const jobs = `${result.canceled} job${result.canceled === 1 ? "" : "s"}`;
  return `Canceled ${jobs} ${scope}.`;
}

/**
 * Top up every plan of the signed-in account that asked to be topped up on review.
 *
 * There is no background scheduler, so a review landing is one of the two moments
 * that can refill a buffer (opening a plan is the other) — and it is the one that
 * matters, because the review is exactly what freed a buffer slot. Only plans with
 * `autoTopUp` on and not paused are touched, so an existing plan never silently
 * starts enqueueing.
 *
 * Failures are swallowed on purpose: this runs *after* a review has been accepted,
 * and a scheduling hiccup must never present itself as the review having failed.
 * Resolves how many runs were enqueued in total, for a caller that wants to say so.
 */
export async function topUpAfterReview(
  backend: BackendClient | null,
  token: string | null,
): Promise<number> {
  if (
    !backend?.getCoveragePlansSummary ||
    !backend.topUpCoveragePlan ||
    !token
  ) {
    return 0;
  }
  let enqueued = 0;
  try {
    const plans = await backend.getCoveragePlansSummary(token);
    for (const plan of plans) {
      if (!plan.autoTopUp || plan.paused) continue;
      const result = await backend.topUpCoveragePlan(plan.id, token);
      enqueued += result.enqueued;
    }
  } catch {
    // Deliberately silent — see above.
  }
  return enqueued;
}
