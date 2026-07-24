import { Link, useParams } from "react-router";
import { useWorkers } from "../../../../client/context";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { KillRunControl } from "../../../components/KillRunControl";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import runExec from "../RunExec.module.scss";
import styles from "./GgRunMonitorPage.module.scss";
import { useGgRunState, type GgMonitorStatus } from "./useGgRunState";
import { FsmStateStrip } from "./FsmStateStrip";
import { GgRunPanels } from "./GgRunPanels";

const numberFmt = new Intl.NumberFormat("en-US");
function formatTokens(n: number): string {
  return numberFmt.format(n);
}
function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

// The live gg run monitor (`/runs/gg/:jobId/live`, consoles only). gg is
// headless, so this is the only live window into a run. It reads the run's live
// state from `useGgRunState` (which owns the `GET /jobs/{id}/live` subscription and
// folds gg's first-party `GgTelemetryEvent` stream into typed state) and lays it
// out as a cockpit — run status, a running token/cost tally summed from the usage
// deltas, and the enforced FSM state — over the shared [GgRunPanels], which carry
// exactly the panels this run's capability set justifies. On a terminal state it
// links to the produced run, whose own gg tab renders these same panels from the
// recorded stream, so the rich view outlives the live one.
export function GgRunMonitorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { active: worker } = useWorkers();
  const state = useGgRunState(jobId);
  const {
    status,
    error,
    sawSession,
    sessionEndStatus,
    usage,
    fsm,
    capabilitySet,
  } = state;

  // Whether this run was captured for replay — the debug-only `replay` capability was
  // on. Only then does a stored replay record exist to step through, so the Replay
  // link on the terminal outcome is shown only in that case (it is debug tooling, not
  // a normal result surface).
  const replayCaptured =
    capabilitySet?.capabilities.some((c) => c.id === "replay" && c.enabled) ??
    false;

  // --- Status presentation --------------------------------------------------
  const phase = statusPhase(status, sawSession);

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

      {/* The enforced FSM process, when a machine drives the run: the current state
          shown prominently on the ordered machine path. Renders nothing when no FSM
          is configured. */}
      <FsmStateStrip fsm={fsm} />

      {/* Terminal outcome + a link to the produced run. */}
      {status.kind === "done" && status.outcome.kind === "completed" && (
        <p className={`${runExec.notice} ${runExec.ok}`}>
          Run complete — state {status.outcome.record.status.state}.{" "}
          <Link to={routes.runDetail(status.outcome.record.id)}>
            Open the run
          </Link>{" "}
          to review it,{" "}
          <Link to={routes.runGg(status.outcome.record.id)}>
            keep reading this view
          </Link>{" "}
          (it is rebuilt from the recorded telemetry, so it stays reachable), or{" "}
          <Link to={routes.runMetrics(status.outcome.record.id)}>
            see its metrics
          </Link>
          .
          {replayCaptured && (
            <>
              {" "}
              This run was captured for replay —{" "}
              <Link to={routes.ggReplay(status.outcome.record.id)}>
                step through what each agent saw and did
              </Link>{" "}
              (debug).
            </>
          )}
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
      {capabilitySet && <CapabilitySummary set={capabilitySet} />}

      {/* The panels this run's configuration justifies — gg announces its
          capability set on the stream, so the view is shaped to the run. */}
      <GgRunPanels
        state={state}
        capabilitySet={capabilitySet}
        live={status.kind === "running"}
      />
    </PageLayout>
  );
}

// The status pill's label, detail, and cue for the current phase. Queued (no gg
// session yet) and running are the two live phases; a terminal state reflects the
// transport outcome — and, where gg reported it, the session's own end status.
function statusPhase(
  status: GgMonitorStatus,
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
