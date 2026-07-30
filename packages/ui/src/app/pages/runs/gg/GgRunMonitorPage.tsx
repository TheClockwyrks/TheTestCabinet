import { Link, useParams } from "react-router";
import { useWorkers } from "../../../../client/context";
import { KillRunControl } from "../../../components/KillRunControl";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { useCaseMaxRuntime } from "../../../data/useCaseMaxRuntime";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { routes } from "../../../routes";
import runExec from "../RunExec.module.scss";
import { useGgRuntime } from "./ggRuntime";
import { useGgRunState, type GgMonitorStatus } from "./useGgRunState";
import { GgDashboard, type GgDashboardStatus } from "./GgDashboard";
import { GgRunPanels } from "./GgRunPanels";

// The live gg run monitor (`/runs/gg/:jobId/live`, consoles only). gg is
// headless, so this is the only live window into a run. It reads the run's live
// state from `useGgRunState` (which owns the `GET /jobs/{id}/live` subscription and
// folds gg's first-party `GgTelemetryEvent` stream into typed state) and lays it out
// as the shared [GgRunPanels] — the panel selector leads the page, and the run-level
// read-out (status, the running token/cost tally, the configuration, the enforced FSM
// state) is its first panel, the Dashboard, rather than a header the panels hang
// beneath. Every other panel is offered only where this run's capability set
// justifies it. On a terminal state the Dashboard links to the produced run, whose
// own gg tab renders these same panels from the recorded stream, so the rich view
// outlives the live one.
export function GgRunMonitorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { active: worker } = useWorkers();
  const runs = useRunsRuntime();
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
  const live = status.kind === "running";

  // The run's two clocks. The wall clock ticks while the stream is live and settles on the
  // last event once it is not, so the read-out is a clock during the run and a record after
  // it (see `ggRuntime`).
  const runtime = useGgRuntime(
    state.agentForest,
    state.executionStartedAt,
    state.lastTimestamp,
    live,
  );
  // The ceiling the host will stop this run at. A live run has no RunRecord yet, so the
  // case it is exercising is read off the launch this session is tracking; null once the run
  // has dropped out of that list (or on a monitor reached by URL alone), where the card
  // simply states no limit rather than guessing one.
  const launched = runs.inProgress.find((run) => run.runId === jobId);
  const timeoutSeconds = useCaseMaxRuntime(
    launched?.testCaseSlug ?? null,
    launched?.testCaseVersion ?? null,
  );

  // Whether this run was captured for replay — the debug-only `replay` capability was
  // on. Only then does a stored replay record exist to step through, so the Replay
  // link on the terminal outcome is shown only in that case (it is debug tooling, not
  // a normal result surface).
  const replayCaptured =
    capabilitySet?.agents?.[0]?.capabilities.some(
      (c) => c.id === "replay" && c.enabled,
    ) ?? false;

  const dashboardStatus: GgDashboardStatus = {
    ...statusPhase(status, sawSession),
    note:
      sessionEndStatus && status.kind === "running"
        ? `gg session ended: ${sessionEndStatus} — finalizing…`
        : null,
    action:
      status.kind === "running" && jobId ? (
        <KillRunControl runId={jobId} />
      ) : undefined,
  };

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

      {/* The panels this run's configuration justifies — gg announces its
          capability set on the stream, so the view is shaped to the run — led by
          the Dashboard, which carries the run as a whole. */}
      <GgRunPanels
        state={state}
        capabilitySet={capabilitySet}
        live={live}
        dashboard={
          <GgDashboard
            status={dashboardStatus}
            usage={usage}
            slotUsage={state.slotUsage}
            perAgent={state.perAgent}
            agentForest={state.agentForest}
            fsm={fsm}
            capabilitySet={capabilitySet}
            runtime={runtime}
            timeoutSeconds={timeoutSeconds}
          >
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
                (it is rebuilt from the recorded telemetry, so it stays
                reachable), or{" "}
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
                {status.outcome.message
                  ? `: ${status.outcome.message}`
                  : ""}.{" "}
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
            {error && (
              <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>
            )}
          </GgDashboard>
        }
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
): Pick<GgDashboardStatus, "label" | "detail" | "tone"> {
  if (status.kind === "running") {
    return sawSession
      ? // No detail: the pill already says the run is live, and a run has as many agents
        // working as it has dispatched, so there is nothing true to add in one phrase.
        { label: "Running", detail: null, tone: "live" }
      : {
          label: "Queued",
          detail: "waiting for a runner and container",
          tone: "live",
        };
  }
  switch (status.outcome.kind) {
    case "completed":
      return {
        label: "Completed",
        detail: `state ${status.outcome.record.status.state}`,
        tone: "ok",
      };
    case "canceled":
      return {
        label: "Canceled",
        detail: "stopped by an operator",
        tone: "fail",
      };
    case "failed":
      return { label: "Failed", detail: status.outcome.message, tone: "fail" };
  }
}
