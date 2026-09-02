import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { LoadingState } from "../../components/LoadingState";
import type {
  CoverageAxis,
  CoverageCell,
  CoverageMatrix,
  CoveragePlanOut,
  CoverageQueue,
  CoverageSchedule,
  HaltResult,
  TopUpBlocked,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import type { BackendClient, WorkerClient } from "../../../client/clients";
import type { InProgressRun } from "../../../client/types";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { GG_HARNESS_SLUG } from "../../data/runLinks";
import { bindModelSlots } from "../runs/gg/ggConfigDraft";
import {
  findGgConfig,
  useGgConfigs,
  type GgConfigOption,
} from "../runs/gg/useGgConfigs";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  claimSectionReturn,
  useRecordSectionIndex,
} from "../../components/backReturn";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import { launchBatch, type LaunchItem } from "../runs/launchBatch";
import { axisLabel } from "./coveragePickers";
import {
  comboLabel,
  ggConfigKey,
  isGgCombo,
  type CombinationLike,
} from "./comboLabels";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

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
  } & CombinationLike,
): string {
  return `${c.slug}@${c.version}@${c.variant}::${c.harness}::${c.model}::${ggIdentity(c)}`;
}

// The group a cell belongs to under the plan's ordering. The dashboard groups on
// whichever axis the plan's schedule nests on, so the page is laid out in the order
// the runs will actually arrive: grouping a "one model at a time" plan by case would
// scatter each model's contiguous block of runs across every block on the page.
function groupKey(cell: CoverageCell, axis: CoverageAxis): string {
  return axis === "case"
    ? `${cell.slug}@${cell.version}@${cell.variant}`
    : `${cell.harness}::${cell.model}::${ggIdentity(cell)}`;
}

/**
 * The launch items for a set of coverage cells — `remaining` runs per cell, each
 * config resolved exactly as the new-run form does (provider prefix applied for
 * provider-routed harnesses; the default one-shot orchestrator, since a plan does not
 * pin one).
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
          maxRuntimeOverride: null,
        },
        track: {
          testCaseSlug: cell.slug,
          testCaseVersion: cell.version,
          variant: cell.variant,
          harnessSlug: cell.harness,
          modelId: cell.model,
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
          // No engine and no runtime override, matching the harness cells beside it: a
          // plan crosses cases with combinations and pins neither dimension, so a
          // triggered run takes the engineless default and the case's own runtime.
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
// away, leaving an empty page for a cell that plainly has runs. Variant is not a
// facet the listing offers, so a multi-variant case's cells share a link.
//
// A gg cell adds the configuration's id as the listing's `ggConfigId` filter, the
// same value the cell's own counts group on, so the rows behind the figure are exactly
// the rows the link lands on. The id and never the name: the runs recorded before a
// rename carry the old name, and another account's same-named configuration carries
// this one, so a name narrows to a set the count was never made of.
function cellRunsHref(cell: CoverageCell): string {
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
  /** The muted qualifier beside the heading (a case's `variant · version`). */
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
function barWidths(
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
      subtitle:
        coverage.outerAxis === "case"
          ? `${cell0.variant} · ${cell0.version}`
          : "",
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
 * for each: a paused plan wants resuming, a busy one wants nothing (another tab is
 * already doing the work), a full buffer wants *reviews* rather than more runs, and
 * a satisfied plan wants a bigger target or nothing at all. "Top up did nothing" for
 * all four is the failure mode this exists to avoid — and a plan whose members are
 * broken is a fifth, which is why the blocked cells trail every outcome the scheduler
 * actually reached.
 */
export function describeTopUp(result: TopUpResult): string {
  if (result.skipped === "paused") {
    return "This plan is paused, so nothing was enqueued. Resume it to let it refill.";
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
  if (outstanding >= result.bufferTarget) {
    return (
      `Nothing enqueued: your review buffer is full (${outstanding} of ` +
      `${result.bufferTarget} outstanding). Review some runs and top up again.${blocked}`
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
 * cannot act on.
 */
export function describeHalt(result: HaltResult): string {
  const scope = result.includedActive
    ? "including runs already executing"
    : "that had not started";
  if (result.canceled === 0) {
    return `Paused. No jobs of this plan were waiting to cancel (${scope}).`;
  }
  const jobs = `${result.canceled} job${result.canceled === 1 ? "" : "s"}`;
  return `Paused and canceled ${jobs} ${scope}.`;
}

/**
 * Why this plan is not currently producing runs, or null when nothing needs saying.
 *
 * An idle plan is the single most confusing state this page can be in — the target
 * is unmet, nothing is running, and no control is obviously wrong — and each cause
 * has its own remedy: resume it, review the runs holding the buffer, fix the members
 * nothing can launch, or accept that it is finished. The `pending` count is folded in
 * for the same reason it exists on the wire: a game jam's runs are serialized per model
 * by the queue, so they sit held back rather than running, which otherwise reads
 * exactly like a stuck queue.
 */
export function planStatusNote(
  coverage: CoverageMatrix,
  paused: boolean,
): string | null {
  const held =
    coverage.runsPending > 0
      ? ` ${coverage.runsPending} in-flight run${coverage.runsPending === 1 ? " is" : "s are"} pending: held back by the queue (its harness is at its parallelism cap, or a game jam is already running on that model), not stuck.`
      : "";
  // A cell nothing can launch is missing runs that will never arrive, so it has to be
  // named here or the plan simply looks stuck. The reason lives on the cell itself;
  // this is the pointer that sends the reviewer to it.
  const blockedCells = coverage.cells.filter((c) => c.unlaunchable).length;
  const blocked =
    blockedCells > 0
      ? ` ${blockedCells} cell${blockedCells === 1 ? " cannot" : "s cannot"} be launched at all — expand the blocks below for the reason on each, and fix or drop the combination.`
      : "";
  if (paused) {
    return (
      "Paused: this plan will not enqueue anything until you resume it. " +
      `Whatever is already queued is untouched.${held}${blocked}`
    );
  }
  if (coverage.runsMissing === 0) {
    if (coverage.runsUnreviewed === 0)
      return `${held}${blocked}`.trim() || null;
    return (
      `Every cell is at its target, satisfied partly by ${coverage.runsUnreviewed} ` +
      `run${coverage.runsUnreviewed === 1 ? "" : "s"} you have not reviewed yet.${held}${blocked}`
    );
  }
  if (coverage.runsOutstanding >= coverage.bufferTarget) {
    return (
      `Waiting on you: ${coverage.runsOutstanding} of ${coverage.bufferTarget} ` +
      "buffered runs are outstanding (in flight, or finished and unreviewed), so a " +
      `top-up deliberately enqueues nothing until you review some.${held}${blocked}`
    );
  }
  return `${held}${blocked}`.trim() || null;
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

// One block of the matrix: its header (title, qualifier, a stale-pin hint, and the
// block-wide progress rollup) is always shown; the per-cell rows are revealed only
// when expanded. Starts collapsed so a large plan reads as a scannable list of
// progress bars, mirroring the Inputs/Changelog accordion.
//
// Which axis the block is (a case, or a combination) follows the plan's ordering, so
// each row's label is the *other* axis — hence `axis` here rather than a fixed
// combination row label.
export function MatrixSection({
  group,
  axis,
  busy,
  canTrigger,
  onTrigger,
}: {
  group: MatrixGroup;
  axis: CoverageAxis;
  busy: boolean;
  canTrigger: boolean;
  onTrigger: (cells: CoverageCell[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const testCaseName = useTestCaseName();
  const { cells, done, desired, donePct, flightPct } = group;
  const cell0 = cells[0]!;
  // A case-grouped block shares one pinned version, so its staleness belongs on the
  // header; a combination-grouped block spans every case, so it belongs per row.
  const headerStale = axis === "case" && cell0.stale;

  return (
    <section className={styles.group}>
      <header
        className={`${styles.groupHead} ${
          open ? "" : styles.groupHeadCollapsed
        }`}
      >
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.twisty} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={styles.groupTitle}>
            {group.title}
            {group.subtitle && (
              <span className={styles.groupVersion}>{group.subtitle}</span>
            )}
          </span>
        </button>
        <span className={styles.groupRight}>
          {group.unreviewed > 0 && (
            <span
              className={styles.waitingBadge}
              title="Completed runs here that you have not reviewed. They count toward the plan's target and occupy your review buffer."
            >
              {group.unreviewed} to review
            </span>
          )}
          {headerStale && (
            <span
              className={styles.staleBadge}
              title={`A newer version (${cell0.latestVersion}) is ingested. Bump the pin from the plan editor.`}
            >
              {cell0.version} → {cell0.latestVersion} ↑
            </span>
          )}
          <span
            className={styles.groupProgress}
            title={`${done} of ${desired} runs across every cell in this block`}
          >
            <span className={styles.groupBar} aria-hidden>
              <span
                className={styles.groupBarDone}
                style={{ width: `${donePct}%` }}
              />
              <span
                className={styles.groupBarFlight}
                style={{ width: `${flightPct}%` }}
              />
            </span>
            <span className={styles.groupCount}>
              {done}/{desired}
            </span>
          </span>
        </span>
      </header>
      {open && (
        <ul className={styles.cellList}>
          {cells.map((cell) => {
            const cellDone = cell.completed + cell.inFlight;
            const satisfied = cell.remaining === 0;
            const blocked = cell.unlaunchable;
            const { donePct: cellDonePct, flightPct: cellFlightPct } =
              barWidths(cell.completed, cell.inFlight, cell.desired);
            return (
              <li
                key={cellKey(cell)}
                className={`${styles.cell} ${satisfied ? styles.cellDone : ""}`}
              >
                <span className={styles.cellLabel}>
                  {axis === "case"
                    ? comboLabel(cell)
                    : `${testCaseName(cell.slug)} · ${cell.variant} · ${cell.version}`}
                  {axis === "combination" && cell.stale && (
                    <span
                      className={styles.staleBadge}
                      title={`A newer version (${cell.latestVersion}) is ingested. Bump the pin from the plan editor.`}
                    >
                      ↑ {cell.latestVersion}
                    </span>
                  )}
                </span>
                <span className={styles.cellBar} aria-hidden>
                  <span
                    className={styles.cellBarDone}
                    style={{ width: `${cellDonePct}%` }}
                  />
                  <span
                    className={styles.cellBarFlight}
                    style={{ width: `${cellFlightPct}%` }}
                  />
                </span>
                <span className={styles.cellCount}>
                  {cellDone}/{cell.desired}
                  {cell.pending > 0 && (
                    <span
                      className={styles.cellNote}
                      title="Held back by the queue, because its harness is at its parallelism cap or a game jam is already running on this model. Not stuck."
                    >
                      {cell.pending} pending
                    </span>
                  )}
                  {cell.unreviewed > 0 && (
                    <span
                      className={styles.cellNote}
                      title="Completed runs you have not reviewed. They count toward the target and occupy your review buffer."
                    >
                      {cell.unreviewed} to review
                    </span>
                  )}
                </span>
                <Link className={styles.cellLink} to={cellRunsHref(cell)}>
                  Runs
                </Link>
                <button
                  className={`${exec.secondary} ${styles.cellButton}`}
                  type="button"
                  disabled={
                    busy || !canTrigger || satisfied || Boolean(blocked)
                  }
                  title={blocked}
                  onClick={() => onTrigger([{ ...cell, remaining: 1 }])}
                >
                  {blocked ? "Blocked" : satisfied ? "Covered" : "Trigger one"}
                </button>
                {/* The reason gets the full width of a row of its own: it is a
                    sentence naming a configuration and a slot, not a badge, and a
                    reviewer cannot act on it truncated. */}
                {blocked && (
                  <span className={styles.cellBlocked}>{blocked}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The plan's own review queue: the completed runs of this plan the signed-in account
// has not reviewed, listed in the plan's emission order rather than newest-first like
// the global Unreviewed page. That order is the whole point — the buffer was filled
// deliberately so a cell's repeats arrive adjacent, and walking them in arrival order
// is what lets them be judged against each other.
//
// Each row claims the coverage back-return before it navigates, so reviewing a run
// and pressing back lands here rather than on the runs index: open, review, back,
// repeat. `returnLabel` is what the run page's back control then calls this
// dashboard — the ladder reuses this component verbatim, and the two must not both
// announce themselves as the plan.
export function ReviewQueue({
  queue,
  returnLabel = "Back to the coverage plan",
}: {
  queue: CoverageQueue;
  returnLabel?: string;
}) {
  const testCaseName = useTestCaseName();
  if (queue.runs.length === 0) return null;
  return (
    <section className={styles.queue}>
      <p className={exec.sectionLabel}>
        Waiting on your review ({queue.runs.length}
        {queue.truncated ? "+" : ""})
      </p>
      <ol className={styles.queueList}>
        {queue.runs.map((entry) => (
          <li key={entry.runId} className={styles.queueRow}>
            <Link
              className={styles.queueLink}
              to={routes.runVerdict(entry.runId)}
              onClick={() => claimSectionReturn("coverage", returnLabel)}
            >
              {testCaseName(entry.slug)}
            </Link>
            <span className={styles.queueMeta}>
              {entry.variant} · {entry.version}
            </span>
            {/* Through the shared label, so a gg run reads the way its cell does.
                A queue entry carries only the recorded launch identity, so a gg run
                falls through to `gg · <model>` — the model its root agent ran. */}
            <span className={styles.queueMeta}>{comboLabel(entry)}</span>
          </li>
        ))}
      </ol>
      {queue.truncated && (
        <p className={exec.muted}>
          More are waiting behind these. The queue is walked from the front, not
          paged.
        </p>
      )}
    </section>
  );
}

// The per-plan coverage dashboard (`/account/coverage/:planId`): the matrix of what
// this plan still needs — grouped and ordered exactly as the plan runs it — over the
// controls that feed it (top up, pause, halt) and the review queue it has filled.
// Console-only; gated on a signed-in account.
export function CoveragePlanPage() {
  const { planId = "" } = useParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();
  // The account's gg configurations, needed only to trigger a gg cell by hand: the
  // matrix already carries every gg cell's name and models, but launching one needs the
  // capability set behind it, which only the configuration itself has. The load's state
  // is read alongside them, because "none yet" and "the request failed" resolve gg
  // cells identically and mean opposite things (see `ggTriggerReadiness`).
  const {
    options: ggOptions,
    loading: ggLoading,
    error: ggError,
  } = useGgConfigs();

  // Record this dashboard as the coverage section's index, so a run opened from a
  // cell or from the review queue can return here (see `backReturn`).
  useRecordSectionIndex("coverage");

  const [coverage, setCoverage] = useState<CoverageMatrix | null>(null);
  const [plan, setPlan] = useState<CoveragePlanOut | null>(null);
  const [queue, setQueue] = useState<CoverageQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last thing a control did (topped up, halted), reported verbatim: these
  // actions are only trustworthy if they say what they changed.
  const [note, setNote] = useState<string | null>(null);

  // A worker is what executes a hand-triggered run; the gg configurations are what one
  // of them is built from. They are kept apart because only the first is worth its own
  // standing notice — the second resolves on its own within a moment of the page
  // opening.
  const hasWorker = Boolean(worker && (worker.local || token));
  const ggTrigger = ggTriggerReadiness(ggLoading, ggError);
  const canTrigger = hasWorker && ggTrigger.ready;

  // Re-read everything the controls can move: the matrix's counts, and the review
  // queue the buffer has filled.
  const refresh = useCallback(async () => {
    if (!backend || !token) return;
    const [cov, q] = await Promise.all([
      backend.getCoveragePlanCoverage?.(planId, token) ?? Promise.resolve(null),
      backend.getCoveragePlanQueue?.(planId, token) ?? Promise.resolve(null),
    ]);
    setCoverage(cov);
    setQueue(q);
  }, [backend, token, planId]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      backend.getCoveragePlanCoverage?.(planId, token) ?? Promise.resolve(null),
      backend.listCoveragePlans?.(token) ?? Promise.resolve([]),
      backend.getCoveragePlanQueue?.(planId, token) ?? Promise.resolve(null),
    ])
      .then(([cov, plans, q]) => {
        if (!active) return;
        setCoverage(cov);
        setPlan(plans.find((p) => p.id === planId) ?? null);
        setQueue(q);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token, planId]);

  // Run the server-side top-up. `announce` distinguishes the reviewer pressing the
  // button (which must always answer, even to say "nothing to do") from the
  // on-open call, which speaks only when it actually enqueued something rather than
  // greeting every visit with a status line the page already shows.
  const topUp = useCallback(
    async (announce: boolean) => {
      if (!backend?.topUpCoveragePlan || !token) return;
      setBusy(true);
      setError(null);
      try {
        const result = await backend.topUpCoveragePlan(planId, token);
        if (announce || result.enqueued > 0) setNote(describeTopUp(result));
        if (result.enqueued > 0) await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId, refresh],
  );

  // Top up once when the plan is opened. There is no background scheduler, so this
  // call *is* the scheduler's other half (a submitted review being the first): a
  // reviewer arriving at a plan that has room in its buffer should find it filling,
  // not waiting to be asked. It is idempotent and serialized server-side, so a
  // second tab doing the same thing enqueues nothing twice.
  const toppedUpFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !plan || toppedUpFor.current === planId) return;
    toppedUpFor.current = planId;
    void topUp(false);
  }, [loading, plan, planId, topUp]);

  // Launch a set of cells by hand. The two shapes a combination takes go out on two
  // different endpoints — harness cells in one batch, gg cells one gg run each — so the
  // trigger fans out to both and reports what did not go.
  const triggerCells = useCallback(
    async (cells: CoverageCell[]) => {
      if (!worker || !canTrigger) return;
      const items = itemsForCells(cells);
      const { launches, unresolved } = planGgLaunches(cells, ggOptions);
      if (
        items.length === 0 &&
        launches.length === 0 &&
        unresolved.length === 0
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // Attributed to this plan, so the jobs land inside its halt scope. Without
        // the origin they would carry `job.origin = null` and no amount of pressing
        // Halt would reach them — a plan that visibly refuses to stop.
        const batch =
          items.length > 0
            ? await launchBatch(worker, token, runtime.track, items, {
                kind: "plan",
                id: planId,
              })
            : [];
        const failed = await launchGgCells(
          worker,
          token,
          runtime.track,
          launches,
        );
        // Said rather than swallowed: a trigger that enqueued four of six runs and
        // returned silently is indistinguishable from one that worked. Both endpoints
        // isolate their failures, so the partial success is the normal case.
        //
        // De-duplicated, because a cell's repeats fail identically and one sentence
        // repeated five times is not five pieces of information.
        const problems = new Set([
          ...unresolved.map((cell) => unresolvedGgProblem(cell, ggError)),
          ...batch.flatMap((result, i) => {
            const item = items[i];
            if (!result.error || !item) return [];
            const named = comboLabel({
              harness: item.track.harnessSlug,
              model: item.track.modelId,
            });
            return [`${named}: ${result.error}`];
          }),
          ...failed.map((f) => `${comboLabel(f.cell)}: ${f.error}`),
        ]);
        setError(problems.size > 0 ? [...problems].join(" ") : null);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      worker,
      canTrigger,
      token,
      runtime.track,
      refresh,
      planId,
      ggOptions,
      ggError,
    ],
  );

  // Suspend or resume topping up, leaving the queue alone. Takes the state rather
  // than toggling, so the control cannot disagree with the server about which way it
  // is going.
  const setPaused = useCallback(
    async (paused: boolean) => {
      if (!backend?.pauseCoveragePlan || !token) return;
      setBusy(true);
      setError(null);
      try {
        const schedule = await backend.pauseCoveragePlan(planId, paused, token);
        setPlan((p) => (p ? { ...p, ...schedule } : p));
        setNote(
          paused
            ? "Paused. Nothing new will be enqueued; the queue is untouched."
            : "Resumed. Top up now, or submit a review, to start refilling.",
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId],
  );

  // Turn "top up when I submit a review" on or off. Written through the schedule
  // resource (not the plan save), so it can never be clobbered by a member-list edit
  // saved from another tab.
  const setAutoTopUp = useCallback(
    async (autoTopUp: boolean) => {
      if (!backend?.setCoveragePlanSchedule || !token || !plan) return;
      const schedule: CoverageSchedule = {
        outerAxis: plan.outerAxis,
        paused: plan.paused,
        autoTopUp,
        bufferTarget: plan.bufferTarget,
      };
      setBusy(true);
      setError(null);
      try {
        const saved = await backend.setCoveragePlanSchedule(
          planId,
          schedule,
          token,
        );
        setPlan((p) => (p ? { ...p, ...saved } : p));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId, plan],
  );

  // Pause and cancel this plan's jobs. `all` extends the sweep to jobs already
  // executing, which are partly or wholly paid for — so it is confirmed, and never
  // the control the reviewer reaches by accident.
  const halt = useCallback(
    async (all: boolean) => {
      if (!backend || !token) return;
      // Resolved (not called) through the client so the transport keeps its own
      // receiver; a transport that does not implement halting simply has no control.
      const supported = all
        ? backend.haltAllCoveragePlan
        : backend.haltCoveragePlan;
      if (!supported) return;
      if (
        all &&
        !(await confirm({
          title: "Halt everything",
          message:
            "Cancel every job this plan launched, including runs already executing? " +
            "Their work so far is lost and their cost is already spent. Use “Halt” " +
            "to cancel only what has not started.",
          confirmLabel: "Halt everything",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result: HaltResult | undefined = all
          ? await backend.haltAllCoveragePlan?.(planId, token)
          : await backend.haltCoveragePlan?.(planId, token);
        if (result) setNote(describeHalt(result));
        // A halt always leaves the plan paused, whatever it found to cancel.
        setPlan((p) => (p ? { ...p, paused: true } : p));
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId, refresh, confirm],
  );

  // The matrix grouped on the plan's own ordering axis, in the plan's own order.
  const groups = useMemo<MatrixGroup[]>(
    () => (coverage ? buildGroups(coverage, testCaseName) : []),
    [coverage, testCaseName],
  );

  // What "Trigger all missing" would actually launch. A cell nothing can launch is
  // excluded, so the control disables itself on a plan whose whole shortfall is broken
  // members rather than offering a press that could only fail.
  const deficientCells = useMemo(
    () =>
      coverage?.cells.filter((c) => c.remaining > 0 && !c.unlaunchable) ?? [],
    [coverage],
  );

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron to={routes.accountCoverage()} label="All plans" />
            <h1 className={styles.detailTitle}>Coverage plan</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a coverage plan. Plans are saved to your account.
        </p>
      </PageLayout>
    );
  }

  const statusNote = coverage
    ? planStatusNote(coverage, plan?.paused ?? false)
    : null;

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountCoverage()} label="All plans" />
          <h1 className={styles.detailTitle}>{plan?.name ?? planId}</h1>
          {plan?.paused && <span className={styles.pausedBadge}>paused</span>}
        </div>
        <Link
          className={exec.secondary}
          to={routes.accountCoveragePlanEdit(planId)}
        >
          Edit plan
        </Link>
      </header>

      <SubmitNotice message={error} />
      {/* The note stays a plain notice: a top-up runs on open with no press behind
        it, and a note that revealed itself would pull a reader who had already
        scrolled down back to the top of the page. */}
      {note && <p className={`${exec.notice} ${exec.ok}`}>{note}</p>}
      {!hasWorker && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected. Open the connections drawer (the gear in the top
          bar) to add a worker before triggering runs by hand. Topping up needs
          no worker; the backend enqueues those itself.
        </p>
      )}
      {ggTrigger.notice && (
        <p className={`${exec.notice} ${exec.warn}`}>{ggTrigger.notice}</p>
      )}

      {loading ? (
        <LoadingState label="Loading coverage…" />
      ) : !coverage || coverage.cellsTotal === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            This plan is empty. Edit it to add the cases and the combinations
            you want covered — a harness with its model, or a gg configuration
            with the models it binds.
          </p>
          <Link
            className={exec.primary}
            to={routes.accountCoveragePlanEdit(planId)}
          >
            Edit this plan
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryStat}>
              <strong>
                {coverage.cellsSatisfied}/{coverage.cellsTotal}
              </strong>{" "}
              cells covered
            </span>
            <span className={styles.summaryStat}>
              <strong>{coverage.runsMissing}</strong> runs missing
            </span>
            <span
              className={styles.summaryStat}
              title="Runs waiting on you or on the queue: in flight (queued, pending, or executing) plus finished but unreviewed by you. A top-up stops once this reaches the buffer target."
            >
              <strong>
                {coverage.runsOutstanding}/{coverage.bufferTarget}
              </strong>{" "}
              buffered
            </span>
            <span
              className={styles.summaryStat}
              title="Completed runs of this plan you have not reviewed."
            >
              <strong>{coverage.runsUnreviewed}</strong> to review
            </span>
            {coverage.runsPending > 0 && (
              <span
                className={styles.summaryStat}
                title="In-flight runs the queue is deliberately holding back, because the harness is at its parallelism cap or a game jam is already running on that model. A subset of the runs in flight, not an addition to them."
              >
                <strong>{coverage.runsPending}</strong> pending
              </span>
            )}
          </div>

          <div className={styles.controls}>
            <span className={styles.controlOrder}>
              Runs in this order:{" "}
              <strong>{axisLabel(coverage.outerAxis)}</strong>
            </span>
            <label className={`${styles.controlToggle} ${styles.controlEnd}`}>
              <input
                type="checkbox"
                checked={plan?.autoTopUp ?? false}
                disabled={busy || !plan || !backend?.setCoveragePlanSchedule}
                onChange={(e) => void setAutoTopUp(e.target.checked)}
              />
              Top up when I submit a review
            </label>
            <span className={styles.controlActions}>
              <button
                type="button"
                className={exec.primary}
                disabled={busy || !backend?.topUpCoveragePlan}
                onClick={() => void topUp(true)}
              >
                {busy ? "Working…" : "Top up now"}
              </button>
              <button
                type="button"
                className={exec.secondary}
                // Gated on the plan having loaded: the control sends a state, not a
                // toggle, and it cannot know which state to send until it knows the
                // one the plan is in.
                disabled={busy || !plan || !backend?.pauseCoveragePlan}
                onClick={() => void setPaused(!plan?.paused)}
              >
                {plan?.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className={exec.secondary}
                disabled={busy || !backend?.haltCoveragePlan}
                title="Pause, and cancel this plan's jobs that have not started yet."
                onClick={() => void halt(false)}
              >
                Halt
              </button>
              <button
                type="button"
                className={exec.danger}
                disabled={busy || !backend?.haltAllCoveragePlan}
                title="Pause, and cancel every job this plan launched, runs already executing included."
                onClick={() => void halt(true)}
              >
                Halt all
              </button>
              <button
                className={exec.secondary}
                type="button"
                disabled={busy || !canTrigger || deficientCells.length === 0}
                onClick={() => void triggerCells(deficientCells)}
              >
                Trigger all missing
              </button>
            </span>
          </div>

          {statusNote && (
            <p className={`${exec.notice} ${exec.warn}`}>{statusNote}</p>
          )}

          {queue && <ReviewQueue queue={queue} />}

          <div className={styles.matrix}>
            {groups.map((group) => (
              <MatrixSection
                key={group.key}
                group={group}
                axis={coverage.outerAxis}
                busy={busy}
                canTrigger={canTrigger}
                onTrigger={triggerCells}
              />
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
