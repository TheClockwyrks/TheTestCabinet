import { useState } from "react";
import type { BulkCancelOut } from "@test-cabinet/run-record/jobs-api";
import { useAuth } from "../../../client/auth";
import { useOptionalWorkers } from "../../../client/context";
import {
  useConfirm,
  type ConfirmOptions,
} from "../../components/ConfirmDialog";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import type { InProgressRun } from "../../../client/types";
import styles from "./StopRunsControls.module.scss";

// Which slice of the in-flight queue a sweep clears. Named after the backend's own
// `waiting`/`active` vocabulary (and its `/jobs/cancel-*` routes) so the button, the
// transport method, and the endpoint are one word apart at every layer.
type StopScope = "waiting" | "active" | "all";

// The job phases that have not started executing: they hold a queue slot but have
// spent nothing, so discarding them throws no work away. `pending` is surfaced
// distinctly from `queued` elsewhere (a game jam is serialized per model, so its
// jobs legitimately wait there) but both are equally free to cancel.
const WAITING_STATES: InProgressRun["state"][] = ["queued", "pending"];

// The job phases that are already burning a driver, a container, and tokens.
// `dispatched` reaches the console mapped onto `starting` — see `InProgressRun` —
// so the two names here cover all three of the backend's active states.
const ACTIVE_STATES: InProgressRun["state"][] = ["starting", "running"];

/**
 * The transport and token a sweep needs, or null where the cabinet cannot be stopped from
 * here at all: a worker whose transport implements the sweeps, and a signed-in account
 * whose token authorizes them.
 *
 * Bound up front as plain consts so the narrowing survives into the click handlers'
 * closures, which narrowing on the optional methods themselves would not.
 */
function useSweeps() {
  // Optional: the static site mounts no <WorkersProvider>, so the hook must not throw
  // where the public gallery renders a runs-section header.
  const client = useOptionalWorkers()?.active?.client ?? null;
  const { token } = useAuth();
  const cancelWaiting = client?.cancelWaitingRuns?.bind(client);
  const cancelActive = client?.cancelActiveRuns?.bind(client);
  const cancelAll = client?.cancelAllRuns?.bind(client);
  if (!cancelWaiting || !cancelActive || !cancelAll || !token) return null;
  return { token, cancelWaiting, cancelActive, cancelAll };
}

/**
 * Whether {@link StopRunsControls} would render anything here.
 *
 * A page asks before putting the cluster in its header, because a header told it carries
 * trailing controls lays its comment line out for them — and a page that laid out for a
 * cluster which then rendered nothing would be reshaping itself around empty space.
 */
export function useCanStopRuns(): boolean {
  return useSweeps() !== null;
}

/**
 * The three global stop controls of the runs section. They are **global**: every job
 * in the named states, whoever launched it and whatever launched it, which is
 * precisely what distinguishes them from a coverage plan's or a ladder's scoped
 * halt. That breadth is why the two destructive ones confirm first and why each
 * confirmation names the count it is about to cancel.
 *
 * Rendered on the trailing edge of each runs-section page header's comment line,
 * rather than in the tab bar beneath it: the bar gained a fifth tab, and a strip of
 * five tabs plus three buttons is a bar that wraps onto two rows at any ordinary
 * window width. The header's second line is already a half-empty row on every one
 * of those pages, so the cluster costs no vertical space at all there.
 *
 * Rendered only where cancellation is actually possible — a worker whose transport
 * implements the sweeps, and a signed-in account whose token authorizes them. Either
 * one missing hides the cluster rather than showing three buttons that fail when
 * pressed, mirroring `KillRunControl` / `useRunKill`; the static site has neither,
 * so the public gallery's headers carry their comment alone.
 */
export function StopRunsControls() {
  const sweeps = useSweeps();
  const { confirm } = useConfirm();
  const runtime = useRunsRuntime();
  const [busy, setBusy] = useState<StopScope | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!sweeps) return null;
  const { token, cancelWaiting, cancelActive, cancelAll } = sweeps;

  // What there is to cancel, from the reconciled in-flight list the runs runtime
  // holds. That list is every worker's authoritative active set (`GET /jobs/active`),
  // not just this session's launches, so it is the right global signal for whether
  // a sweep would do anything — and a sweep that would cancel nothing is disabled
  // rather than offered and answered with "0".
  const waiting = runtime.inProgress.filter((run) =>
    WAITING_STATES.includes(run.state),
  ).length;
  const running = runtime.inProgress.filter((run) =>
    ACTIVE_STATES.includes(run.state),
  ).length;

  const controls: {
    scope: StopScope;
    label: string;
    title: string;
    /** Null when the sweep is cheap enough to need no confirmation. */
    confirm: ConfirmOptions | null;
    disabled: boolean;
    sweep: () => Promise<BulkCancelOut>;
  }[] = [
    {
      scope: "waiting",
      label: "Clear pending",
      title:
        "Cancel every run that has not started yet (queued and pending). " +
        "Runs already executing keep going.",
      // Deliberately unconfirmed: these have no driver and have spent nothing, so
      // the control discards no work and a prompt would only be noise.
      confirm: null,
      disabled: waiting === 0,
      sweep: () => cancelWaiting(token),
    },
    {
      scope: "active",
      label: "Kill active",
      title:
        "Cancel every run that is already executing. The queue is left alone, " +
        "so the dispatcher starts claiming from it again.",
      confirm: {
        title: "Kill active runs",
        message:
          `Kill ${count(running, "run")} already executing? Their work is ` +
          "discarded and each is recorded as canceled. This cannot be undone. " +
          "Runs still waiting in the queue are left alone — the dispatcher will " +
          "start claiming them immediately.",
        confirmLabel: "Kill active",
      },
      disabled: running === 0,
      sweep: () => cancelActive(token),
    },
    {
      scope: "all",
      label: "Stop all",
      title: "Cancel everything: the waiting queue and the executing runs.",
      confirm: {
        title: "Stop all runs",
        message:
          `Stop everything — ${count(waiting, "run")} waiting and ` +
          `${count(running, "run")} already executing? The executing ones lose ` +
          "their work and every one is recorded as canceled. This cannot be undone.",
        confirmLabel: "Stop all",
      },
      disabled: waiting + running === 0,
      sweep: () => cancelAll(token),
    },
  ];

  const onSweep = async (control: (typeof controls)[number]) => {
    if (control.confirm && !(await confirm(control.confirm))) return;
    setBusy(control.scope);
    setStatus(null);
    setError(null);
    try {
      setStatus(describeSweep(await control.sweep()));
      // The swept jobs are moving to `canceled`. Nudge the data source to re-read
      // produced runs so they reappear as finished records; the in-flight list is
      // deliberately left to the console stream rather than pruned optimistically
      // here, because the backend publishes a `finished` run event per job the
      // sweep actually ended — which is the authoritative set, and a smaller one
      // than "everything this page was showing" whenever a run finished on its own
      // as the sweep raced past it.
      runtime.requestRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.actions} role="group" aria-label="Stop runs">
      {controls.map((control) => (
        <button
          key={control.scope}
          type="button"
          className={styles.action}
          title={control.title}
          onClick={() => void onSweep(control)}
          disabled={busy !== null || control.disabled}
        >
          {busy === control.scope ? "Canceling…" : control.label}
        </button>
      ))}
      {/*
        Always reported, never merely "succeeded": "the queue was already empty"
        and "nothing matched what I meant" look identical from the outside and call
        for opposite next moves. The live region is mounted from the start (and
        hidden while empty) rather than appearing with its first message, because a
        status region a screen reader has not been watching announces nothing.
      */}
      <span className={styles.status} role="status">
        {status}
      </span>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// Report a finished sweep in the terms the backend answered in, rather than the
// terms of the button that was pressed: the result's own `includedWaiting` /
// `includedActive` flags say which slice it actually reached, so a server that
// widens or narrows a sweep is reported honestly instead of being narrated by the
// console's assumption.
function describeSweep(result: BulkCancelOut): string {
  const noun =
    result.includedWaiting && result.includedActive
      ? "run"
      : result.includedActive
        ? "executing run"
        : "waiting run";
  if (result.canceled === 0)
    return `Nothing to cancel — no ${noun}s were left.`;
  return `Canceled ${count(result.canceled, noun)}.`;
}

// "1 run" / "3 runs" — the counts in this cluster's prompts and reports all read
// as sentences, and an off-by-one plural in a destructive confirmation reads as a
// bug in the thing about to be destroyed.
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
