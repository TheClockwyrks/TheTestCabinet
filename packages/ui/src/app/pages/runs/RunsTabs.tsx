import { useState } from "react";
import { NavLink } from "react-router";
import type { BulkCancelOut } from "@test-cabinet/run-record/jobs-api";
import { useAuth } from "../../../client/auth";
import { useOptionalWorkers } from "../../../client/context";
import { useGalleryData } from "../../data/galleryContext";
import { useRecordSectionIndex } from "../../components/backReturn";
import {
  useConfirm,
  type ConfirmOptions,
} from "../../components/ConfirmDialog";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { useLiveRunUpdates } from "../../runtime/useLiveRunUpdates";
import type { InProgressRun } from "../../../client/types";
import { routes } from "../../routes";
import styles from "./RunsTabs.module.scss";

// Which runs surface the rendering page represents, so its tab reads as active.
export type RunsTab = "runs" | "failures" | "unreviewed" | "unpublished";

// The shared control bar across the runs section's index surfaces: the tab strip
// on the leading edge, the global stop controls on the trailing one. Each tab is
// its own route (so a surface is linkable), mirroring the Settings section's tab
// bar. Failures, Unreviewed, and Unpublished are console-only reviewer tooling —
// their routes aren't mounted on the static site, and the public gallery holds
// nothing unreviewed or unpublished by definition — so it sees only the lone Runs
// tab, where a tab bar is redundant and is dropped entirely. (The coverage
// dashboard moved to the account section's Coverage tab.)
//
// The whole bar is one `<nav>` rather than a wrapper around one: the runs index's
// own stylesheet owns the gap between this bar and the filter bar beneath it via
// a `> nav` child selector, so the element the page sees must stay the nav.
export function RunsTabs({ active }: { active: RunsTab }) {
  const { canExecute } = useGalleryData();
  // The whole Runs section depends on a live in-flight list — the Runs tab lists
  // those runs, and the stop controls below size themselves from the same list —
  // so the run-lifecycle topic is declared here, once, rather than by each tab.
  useLiveRunUpdates();
  // Remember this surface so a run's detail back-control returns to the tab the
  // user was on (Runs / Failures / Unreviewed), not always the default Runs tab.
  // Recorded unconditionally, even where the bar itself is dropped below.
  useRecordSectionIndex("runs");
  const tabs: { key: RunsTab; label: string; to: string }[] = [
    { key: "runs", label: "Runs", to: routes.runs() },
    ...(canExecute
      ? [
          {
            key: "failures" as const,
            label: "Failures",
            to: routes.runFailures(),
          },
          {
            key: "unreviewed" as const,
            label: "Unreviewed",
            to: routes.runUnreviewed(),
          },
          {
            key: "unpublished" as const,
            label: "Unpublished",
            to: routes.runUnpublished(),
          },
        ]
      : []),
  ];

  // The public gallery's single tab: drop the bar entirely. The stop controls ride
  // the same `canExecute` gate that produces the extra tabs, so they can only ever
  // appear on a console — this early return is never the thing hiding them.
  if (tabs.length <= 1) return null;

  return (
    <nav className={styles.bar} aria-label="Runs sections">
      <div className={styles.tabs}>
        {tabs.map((entry) => (
          <NavLink
            key={entry.key}
            to={entry.to}
            className={
              entry.key === active
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
          >
            {entry.label}
          </NavLink>
        ))}
      </div>
      <StopRunsControls />
    </nav>
  );
}

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

// The three global stop controls, on the trailing edge of the runs tab bar. They
// are **global**: every job in the named states, whoever launched it and whatever
// launched it, which is precisely what distinguishes them from a coverage plan's or
// a ladder's scoped halt. That breadth is why the two destructive ones confirm
// first and why each confirmation names the count it is about to cancel.
//
// Rendered only where cancellation is actually possible — a console (the caller's
// `canExecute` gate), a worker whose transport implements the sweeps, and a
// signed-in account whose token authorizes them. Any one missing hides the cluster
// rather than showing three buttons that fail when pressed, mirroring
// `KillRunControl` / `useRunKill`.
function StopRunsControls() {
  // Optional: the static site mounts no <WorkersProvider>. It never reaches this
  // component (no `canExecute`), but the hook must not throw if it ever does.
  const worker = useOptionalWorkers()?.active ?? null;
  const { token } = useAuth();
  const { confirm } = useConfirm();
  const runtime = useRunsRuntime();
  const client = worker?.client ?? null;
  const [busy, setBusy] = useState<StopScope | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bound up front as plain consts so the narrowing below survives into the click
  // handlers' closures, which narrowing on the optional methods themselves would
  // not. A transport implementing none of them is a transport that cannot sweep.
  const cancelWaiting = client?.cancelWaitingRuns?.bind(client);
  const cancelActive = client?.cancelActiveRuns?.bind(client);
  const cancelAll = client?.cancelAllRuns?.bind(client);
  if (!cancelWaiting || !cancelActive || !cancelAll || !token) return null;

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
