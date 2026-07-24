import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useWorkers } from "../../../../client/context";
import type { HarnessEvent, RunOutcome } from "../../../../client/types";
import type { GgCapabilitySet, GgTelemetryEvent } from "@test-cabinet/run-record/gg";
import { KillRunControl } from "../../../components/KillRunControl";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { formatEventTime } from "../../../eventFeed";
import { routes } from "../../../routes";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import runExec from "../RunExec.module.scss";
import styles from "./GgRunMonitorPage.module.scss";

type MonitorStatus =
  | { kind: "running" }
  | { kind: "done"; outcome: RunOutcome };

// The visual tone of a feed row, driving the label/body accent in the stylesheet
// so a glance reads the shape of the run (agent talk vs tool calls vs failures).
type FeedTone = "system" | "agent" | "tool" | "ok" | "fail" | "warn";

interface FeedRow {
  key: string;
  timestamp: string;
  label: string;
  detail: string;
  // A compact, secondary line (a tool call's args), shown muted beneath the detail.
  args?: string;
  tone: FeedTone;
}

// A compact one-line view of a tool call's args object, for the feed. Empty for an
// empty/absent object; truncated so a large payload never blows out the row.
const ARGS_MAX = 160;
function compactArgs(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    return "";
  }
  if (!text || text === "{}") return "";
  return text.length > ARGS_MAX ? `${text.slice(0, ARGS_MAX)}…` : text;
}

// Map one gg-native telemetry event to a feed row. `usage` events are the running
// token/cost tally's input, not feed noise, so they render as no row (null).
function ggFeedRow(gg: GgTelemetryEvent, timestamp: string, key: string): FeedRow | null {
  const base = { key, timestamp };
  switch (gg.type) {
    case "session_started":
      return { ...base, label: "session", detail: "Session started.", tone: "system" };
    case "turn_started":
      return { ...base, label: "turn", detail: "Turn started.", tone: "system" };
    case "assistant_message":
      return { ...base, label: "agent", detail: gg.text, tone: "agent" };
    case "tool_call":
      return {
        ...base,
        label: "tool",
        detail: gg.name,
        args: compactArgs(gg.args),
        tone: "tool",
      };
    case "tool_result":
      return {
        ...base,
        label: gg.ok ? "result" : "result ✗",
        detail: gg.summary ? `${gg.name}: ${gg.summary}` : gg.name,
        tone: gg.ok ? "ok" : "fail",
      };
    case "log":
      return {
        ...base,
        label: gg.level || "log",
        detail: gg.message,
        tone:
          gg.level === "error" ? "fail" : gg.level === "warn" ? "warn" : "system",
      };
    case "session_ended":
      return {
        ...base,
        label: "session",
        detail: `Session ended: ${gg.status}.`,
        tone: gg.status === "completed" ? "ok" : "fail",
      };
    case "usage":
      return null;
    default:
      return null;
  }
}

// Turn a raw harness event into a feed row, or null to drop it. gg emits BOTH its
// typed `gg` telemetry AND the normalized human-facing events mapped from it
// (assistant_message→agent, tool_call→command/write/…), so rendering the mapped
// ones too would double every line — the feed is gg-native and prefers the typed
// events. The only non-gg events kept are the orchestrator's own setup/teardown
// stages, which have no gg equivalent and give useful "spinning up" context.
function toFeedRow(event: HarnessEvent, index: number): FeedRow | null {
  const key = `${index}`;
  switch (event.type) {
    case "gg":
      return ggFeedRow(event.event, event.timestamp, key);
    case "system":
      return {
        key,
        timestamp: event.timestamp,
        label: "setup",
        detail: event.message,
        tone: event.status === "failed" ? "fail" : "system",
      };
    default:
      // The mapped duplicates (agent/command/read/write/error/warning/…) are
      // dropped in favor of their gg-native twins above.
      return null;
  }
}

// The running token/cost tally, summed from the stream's incremental `usage`
// deltas (there is no cumulative total event — see the telemetry contract). Each
// token class stays null-aware: a class only counts once a delta reports it, and
// cost stays unknown until at least one delta carries a figure.
interface UsageTally {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  totalTokens: number;
  anyTokens: boolean;
  comparable: number | null;
  actual: number | null;
  count: number;
}

function sumUsage(events: HarnessEvent[]): UsageTally {
  const tally: UsageTally = {
    uncachedInput: 0,
    cachedInput: 0,
    output: 0,
    reasoning: 0,
    totalTokens: 0,
    anyTokens: false,
    comparable: null,
    actual: null,
    count: 0,
  };
  for (const event of events) {
    if (event.type !== "gg" || event.event.type !== "usage") continue;
    tally.count += 1;
    const { tokens, cost } = event.event;
    for (const key of ["uncachedInput", "cachedInput", "output", "reasoning"] as const) {
      const value = tokens[key];
      if (value != null) {
        tally[key] += value;
        tally.totalTokens += value;
        tally.anyTokens = true;
      }
    }
    if (cost?.comparable != null) {
      tally.comparable = (tally.comparable ?? 0) + cost.comparable;
    }
    if (cost?.actual != null) {
      tally.actual = (tally.actual ?? 0) + cost.actual;
    }
  }
  return tally;
}

const numberFmt = new Intl.NumberFormat("en-US");
function formatTokens(n: number): string {
  return numberFmt.format(n);
}
function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

// The live gg run monitor (`/runs/gg/:jobId/live`, consoles only). gg is
// headless, so this is the ONLY live window into a run: it rides the existing
// `GET /jobs/{id}/live` NDJSON relay (via `subscribeToRun`, the same mechanism the
// conventional monitor uses) under the launch ack's `jobId` and renders gg's
// first-party `GgTelemetryEvent` stream natively — run status, the agent's
// activity, and a running token/cost tally summed from the usage deltas. On a
// terminal state it links to the produced run so the scored artifact and the
// recorded capability set can be inspected. Later phases grow the feed into the
// agent tree / issue board / context-window graph.
export function GgRunMonitorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<MonitorStatus>({ kind: "running" });
  const [error, setError] = useState<string | null>(null);
  // Whether the feed auto-follows the newest row. On by default; scrolling up
  // turns it off, and toggling it back on snaps to the bottom and resumes.
  const [following, setFollowing] = useState(true);

  // Hold the latest runtime in a ref so the subscription effect can reflect a
  // finished run without depending on `runtime` (whose identity changes when
  // `onDone` mutates it) — depending on it would re-run the effect on completion,
  // re-subscribe, replay the stream, and fire `onDone` again in a loop. Mirrors
  // the conventional RunMonitorPage.
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (!worker || !jobId) return;
    setEvents([]);
    setStatus({ kind: "running" });
    setError(null);
    const unsubscribe = worker.client.subscribeToRun(jobId, {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onDone: (outcome) => {
        const rt = runtimeRef.current;
        setStatus({ kind: "done", outcome });
        // The run is now a persisted record (completed or failed); drop any
        // in-progress entry and nudge the runs list to re-read so it appears.
        rt.remove(jobId);
        rt.requestRefresh();
      },
      onError: (e) => setError(String(e)),
    });
    return unsubscribe;
  }, [worker, jobId]);

  const rows = useMemo(
    () =>
      events
        .map((event, index) => toFeedRow(event, index))
        .filter((row): row is FeedRow => row !== null),
    [events],
  );
  const usage = useMemo(() => sumUsage(events), [events]);

  // The gg session's own terminal status (e.g. completed / model_error /
  // timed_out / error), from the last `session_ended` event — distinct from the
  // transport-level outcome below, and shown even before the stream closes.
  const sessionEndStatus = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]!;
      if (event.type === "gg" && event.event.type === "session_ended") {
        return event.event.status;
      }
    }
    return null;
  }, [events]);
  const sawSession = useMemo(
    () =>
      events.some(
        (event) => event.type === "gg" && event.event.type === "session_started",
      ),
    [events],
  );

  // The auto-follow scroller: pin to the bottom as rows arrive while following.
  const feedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!following) return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, following]);

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    // Within a row's height of the bottom counts as "at the bottom".
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setFollowing(atBottom);
  };

  // --- Status presentation --------------------------------------------------
  const phase = statusPhase(status, sawSession);
  const completedRecord =
    status.kind === "done" && status.outcome.kind === "completed"
      ? status.outcome.record
      : null;
  const capSet = completedRecord?.subject.ggCapabilitySet ?? null;

  return (
    <PageLayout fill>
      <PromptHeader
        command="--gg watch"
        comment={<>// live telemetry for a gg run</>}
        arg={jobId ?? ""}
      />

      {!worker && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No worker connected — the live stream comes from the worker that ran
          this job.
        </p>
      )}

      {/* The cockpit: run status + the running token/cost tally. */}
      <div className={styles.cockpit}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Status</span>
          <div className={styles.statusLine}>
            <span className={`${styles.pill} ${phase.pillClass}`}>
              {phase.label}
            </span>
            {phase.detail && (
              <span className={styles.statusDetail}>{phase.detail}</span>
            )}
            {status.kind === "running" && jobId && (
              <span className={styles.statusKill}>
                <KillRunControl runId={jobId} />
              </span>
            )}
          </div>
          {sessionEndStatus && status.kind === "running" && (
            <span className={styles.statusDetail}>
              gg session ended: {sessionEndStatus} — finalizing…
            </span>
          )}
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Tokens &amp; cost</span>
          <span className={styles.metricValue}>
            {usage.anyTokens ? formatTokens(usage.totalTokens) : "—"}{" "}
            <span className={styles.rowArgs}>tokens</span>
          </span>
          <div className={styles.breakdown}>
            <span>
              <span className={styles.breakdownKey}>in</span>
              {formatTokens(usage.uncachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>cached</span>
              {formatTokens(usage.cachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>out</span>
              {formatTokens(usage.output)}
            </span>
            <span>
              <span className={styles.breakdownKey}>reasoning</span>
              {formatTokens(usage.reasoning)}
            </span>
          </div>
          <span className={styles.metricCost}>
            {formatCost(usage.comparable)}
            {usage.actual != null && usage.actual !== usage.comparable && (
              <span className={styles.rowArgs}>
                {" "}
                (actual {formatCost(usage.actual)})
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Terminal outcome + a link to the produced run. */}
      {status.kind === "done" && status.outcome.kind === "completed" && (
        <p className={`${runExec.notice} ${runExec.ok}`}>
          Run complete — state {status.outcome.record.status.state}.{" "}
          <Link to={routes.runDetail(status.outcome.record.id)}>
            Open the run
          </Link>{" "}
          to review it, or{" "}
          <Link to={routes.runMetrics(status.outcome.record.id)}>
            see its metrics
          </Link>
          .
        </p>
      )}
      {status.kind === "done" && status.outcome.kind === "canceled" && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Run canceled
          {status.outcome.message ? `: ${status.outcome.message}` : ""}.{" "}
          {jobId && (
            <Link to={routes.runDetail(jobId)}>
              Open the run to see what was recorded.
            </Link>
          )}
        </p>
      )}
      {status.kind === "done" && status.outcome.kind === "failed" && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          Run failed: {status.outcome.message}
          {jobId && (
            <>
              {" "}
              <Link to={routes.runDetail(jobId)}>
                Open the run to see what was recorded.
              </Link>
            </>
          )}
        </p>
      )}
      {error && <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>}

      {/* The recorded capability set, once the run has one — the run's exact,
          reproducible configuration (its independent variable). */}
      {capSet && <CapabilitySummary set={capSet} />}

      <div className={styles.feedHeader}>
        <span className={runExec.sectionLabel}>gg activity</span>
        <button
          type="button"
          className={styles.followButton}
          data-active={following ? "" : undefined}
          aria-pressed={following}
          onClick={() => setFollowing((on) => !on)}
        >
          Follow
        </button>
      </div>
      <div className={styles.feed} ref={feedRef} onScroll={onFeedScroll}>
        {rows.length === 0 ? (
          <p className={styles.empty}>
            {status.kind === "running"
              ? "Waiting for telemetry…"
              : "No telemetry was recorded."}
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className={`${styles.row} ${toneClass(row.tone)}`}>
              <div className={styles.rowGutter}>
                <span className={styles.rowLabel}>{row.label}</span>
                <span className={styles.rowTime}>
                  {formatEventTime(row.timestamp)}
                </span>
              </div>
              <div className={styles.rowBody}>
                {row.detail}
                {row.args && <div className={styles.rowArgs}>{row.args}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </PageLayout>
  );
}

// The status pill's label, detail, and cue for the current phase. Queued (no gg
// session yet) and running are the two live phases; a terminal state reflects the
// transport outcome — and, where gg reported it, the session's own end status.
function statusPhase(
  status: MonitorStatus,
  sawSession: boolean,
): { label: string; detail: string | null; pillClass: string } {
  const live = styles.pillLive ?? "";
  if (status.kind === "running") {
    return sawSession
      ? { label: "Running", detail: "the agent is working", pillClass: live }
      : {
          label: "Queued",
          detail: "waiting for a runner and container",
          pillClass: live,
        };
  }
  switch (status.outcome.kind) {
    case "completed":
      return {
        label: "Completed",
        detail: `state ${status.outcome.record.status.state}`,
        pillClass: styles.pillOk ?? "",
      };
    case "canceled":
      return {
        label: "Canceled",
        detail: "stopped by an operator",
        pillClass: styles.pillFail ?? "",
      };
    case "failed":
      return {
        label: "Failed",
        detail: status.outcome.message,
        pillClass: styles.pillFail ?? "",
      };
  }
}

function toneClass(tone: FeedTone): string {
  switch (tone) {
    case "agent":
      return styles.toneAgent ?? "";
    case "tool":
      return styles.toneTool ?? "";
    case "ok":
      return styles.toneOk ?? "";
    case "fail":
      return styles.toneFail ?? "";
    case "warn":
      return styles.toneWarn ?? "";
    case "system":
      return "";
  }
}

// A compact read-out of a completed gg run's recorded capability set — its exact
// configuration: the preset it came from (when named), which capabilities were on,
// and the model bound to each slot.
function CapabilitySummary({ set }: { set: GgCapabilitySet }) {
  const enabled = set.capabilities.filter((c) => c.enabled).map((c) => c.id);
  const primary = set.slots.find((s) => s.slot === "primary") ?? set.slots[0];
  return (
    <div className={`${runExec.notice}`}>
      <div className={styles.capSummary}>
        {set.preset && (
          <span>
            <span className={styles.capSummaryKey}>preset</span>
            {set.preset}
          </span>
        )}
        <span>
          <span className={styles.capSummaryKey}>capabilities</span>
          {enabled.length ? enabled.join(", ") : "none"}
        </span>
        {primary && (
          <span>
            <span className={styles.capSummaryKey}>primary model</span>
            {primary.modelId}
            {primary.provider ? ` (${primary.provider})` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
