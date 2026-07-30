import { useMemo } from "react";
import { Link } from "react-router";
import { ProgressBar } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { useRunEvents } from "../../../data/useRunEvents";
import { useCaseMaxRuntime } from "../../../data/useCaseMaxRuntime";
import { routes } from "../../../routes";
import { GgDashboard } from "../gg/GgDashboard";
import { GgRunPanels } from "../gg/GgRunPanels";
import { useGgRuntime } from "../gg/ggRuntime";
import { reduceGgEvents, reduceGgEventsPerAgent } from "../gg/useGgRunState";
import styles from "./RunEventsPage.module.scss";

// The gg tab (`/runs/:runId/gg`): a finished gg run read through the very same
// capability-shaped panels its live monitor rendered — the activity feed, the agent
// tree, the context-fill graph, the plan, the board, the task DAG, and the model's
// skills and memories.
//
// gg's telemetry is recorded with the run, so nothing about the rich view is
// inherently live: rebuilding it from the stored stream is what makes the view
// reachable again after the fact, instead of stranding it behind a live monitor URL
// that only the launching session ever held. The tab is offered only on a gg run
// (see `RunDetailLayout`).
export function RunGgPage() {
  return (
    <RunDetailLayout tab="gg" fill>
      {({ run }) => <RunGgBody run={run} />}
    </RunDetailLayout>
  );
}

function RunGgBody({ run }: { run: RunRecord }) {
  const state = useRunEvents(run.id);
  const events = state.status === "ready" ? state.data.events : null;
  // Fold the recorded stream into the same typed state the live monitor derives, so
  // both views are the same reduction of the same events — globally, and once per
  // agent for the Instances explorer's per-agent files.
  const derived = useMemo(() => reduceGgEvents(events ?? []), [events]);
  const perAgent = useMemo(
    () => reduceGgEventsPerAgent(events ?? []),
    [events],
  );
  // Prefer the configuration gg announced on the stream; fall back to the one the
  // record stores (the run's recorded independent variable) when the stream predates
  // that announcement or could not be read at all.
  const capabilitySet =
    derived.announcedCapabilitySet ?? run.subject.ggCapabilitySet ?? null;
  // The run's two clocks, read off the recorded stream — the same reduction the live
  // monitor derives, with the run's own last event standing in for the present since
  // nothing is still arriving.
  const runtime = useGgRuntime(
    derived.agentForest,
    derived.firstTimestamp,
    derived.lastTimestamp,
    false,
  );
  // And the ceiling it was bounded by, resolved from the case version the record names.
  const timeoutSeconds = useCaseMaxRuntime(
    run.subject.testCaseSlug,
    run.subject.testCaseVersion,
  );

  if (state.status === "loading") {
    const { progress } = state;
    const value =
      progress && progress.total ? progress.received / progress.total : null;
    return (
      <div className={styles.loading}>
        <p className={styles.notice}>Loading gg telemetry…</p>
        <ProgressBar value={value} ariaLabel="Loading recorded gg telemetry" />
      </div>
    );
  }
  if (state.status === "unsupported") {
    return (
      <p className={styles.notice}>
        This run&rsquo;s recorded telemetry isn&rsquo;t available here.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        Couldn&rsquo;t load the gg telemetry: {state.message}
      </p>
    );
  }

  // Whether the run was captured for replay — the debug-only `replay` capability was
  // on, so a stored replay record exists to step through.
  const replayCaptured =
    capabilitySet?.agents?.[0]?.capabilities.some(
      (c) => c.id === "replay" && c.enabled,
    ) ?? false;

  return (
    <section className={`${styles.section} ${styles.sectionFill}`}>
      <GgRunPanels
        state={{ ...derived, perAgent }}
        capabilitySet={capabilitySet}
        live={false}
        // The same Dashboard the live monitor leads with, minus the status card:
        // the run's state is already the detail page's own header, so restating it
        // here would only repeat it. What is *not* elsewhere on the page — what the
        // run cost, the configuration it ran under, the enforced process — reads
        // exactly as it did live.
        dashboard={
          <GgDashboard
            usage={derived.usage}
            slotUsage={derived.slotUsage}
            perAgent={perAgent}
            agentForest={derived.agentForest}
            fsm={derived.fsm}
            capabilitySet={capabilitySet}
            runtime={runtime}
            timeoutSeconds={timeoutSeconds}
          >
            {replayCaptured && (
              <p className={styles.notice}>
                This run was captured for replay —{" "}
                <Link to={routes.ggReplay(run.id)}>
                  step through what each agent saw and did
                </Link>{" "}
                (debug).
              </p>
            )}
          </GgDashboard>
        }
      />
    </section>
  );
}
