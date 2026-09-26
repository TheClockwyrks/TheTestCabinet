import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { RunsPage } from "./RunsPage";
import { RunFailuresPage } from "./RunFailuresPage";
import { UnreviewedPage } from "./UnreviewedPage";
import { UnpublishedPage } from "./UnpublishedPage";
import { UnreadableRunsPage } from "./UnreadableRunsPage";
import { NewRunPage } from "./NewRunPage";
import { RunCodePage } from "./[runId]/RunCodePage";
import { RunEventsPage } from "./[runId]/RunEventsPage";
import { RunGgPage } from "./[runId]/RunGgPage";
import { RunMetadataPage } from "./[runId]/RunMetadataPage";
import { RunMetricsPage } from "./[runId]/RunMetricsPage";
import { RunMonitorPage } from "./[runId]/RunMonitorPage";
import { RunPlayPage, RunPlayRedirect } from "./[runId]/RunPlayPage";
import { RunProofPage } from "./[runId]/RunProofPage";
import { RunInputsPage } from "./[runId]/RunInputsPage";
import { RunVerdictPage } from "./[runId]/RunVerdictPage";
import { RunReviewPage } from "./[runId]/RunReviewPage";
import { ggRoutes } from "./gg";
import { ComparisonsIndexPage } from "../comparisons/ComparisonsIndexPage";
import { ComparisonDetailPage } from "../comparisons/ComparisonDetailPage";
import { ComparisonEditPage } from "../comparisons/ComparisonEditPage";

// Routes owned by the runs section: the all-runs index list and the per-run
// detail, whose Play / Verdict / Inputs / Proof / Metrics / Events / Metadata
// tabs are each their own URL so a tab is linkable. The Play tab is the default
// at the bare run URL (a run with no playable build redirects from there to its
// Verdict tab at `/verdict`; the old `/play` path only redirects to the bare
// URL). Validation no longer has its own tab — it lives on
// the Metadata tab. The
// run-execution routes (new run, live monitor) are included only when the host
// can execute runs —
// they call the backend/worker contexts the static site does not provide.
// (`/runs/new` is a static path, so it outranks the `/runs/:runId` dynamic route
// regardless of order.) Returned as a fragment so the app's single <Routes>
// stitches every section's routes together.
export function runsRoutes(canExecute: boolean) {
  return (
    <>
      <Route path={routePatterns.runs} element={<RunsPage />} />
      {/* The Comparisons tab (beside Tests) and a comparison's detail page render
          on BOTH hosts — a published comparison is public, read-only off the
          snapshot on the static site. `/runs/comparisons` is a static segment that
          outranks `/runs/:runId`. Create/edit mutate a per-account comparison, so
          they stay console-only below. */}
      <Route
        path={routePatterns.runsComparisons}
        element={<ComparisonsIndexPage />}
      />
      <Route
        path={routePatterns.comparisonDetail}
        element={<ComparisonDetailPage />}
      />
      {canExecute && (
        <Route
          path={routePatterns.comparisonNew}
          element={<ComparisonEditPage />}
        />
      )}
      {canExecute && (
        <Route
          path={routePatterns.comparisonEdit}
          element={<ComparisonEditPage />}
        />
      )}
      {/* The publishable-failures worklist is console-only — it lists locally
          produced failures and publishes them, which the static site cannot do.
          Its static path outranks the `/runs/:runId` dynamic route. */}
      {canExecute && (
        <Route path={routePatterns.runFailures} element={<RunFailuresPage />} />
      )}
      {/* Reviewer tooling — console-only (the static site has no backend). The
          coverage plans + groups moved to the account section; the unreviewed
          worklist stays here. Static path, so it outranks the `/runs/:runId`
          dynamic route. */}
      {canExecute && (
        <Route
          path={routePatterns.runUnreviewed}
          element={<UnreviewedPage />}
        />
      )}
      {/* The publish worklist — reviewed-but-unreleased runs, batch-published
          from here. Console-only for the same reason: the static site holds no
          unpublished runs at all. Static path, so it outranks the
          `/runs/:runId` dynamic route. */}
      {canExecute && (
        <Route
          path={routePatterns.runUnpublished}
          element={<UnpublishedPage />}
        />
      )}
      {/* The stored runs whose records the backend cannot decode. Console-only
          like the worklists above: they are reachable from no other listing, and
          the static site holds none by definition. Static path, so it outranks the
          `/runs/:runId` dynamic route. */}
      {canExecute && (
        <Route
          path={routePatterns.runUnreadable}
          element={<UnreadableRunsPage />}
        />
      )}
      {canExecute && (
        <Route path={routePatterns.runNew} element={<NewRunPage />} />
      )}
      {canExecute && (
        <Route path={routePatterns.runMonitor} element={<RunMonitorPage />} />
      )}
      {/* gg (The Test Cabinet's own headless harness): its config + live-monitor
          routes, console-only. Their `/runs/gg` prefix is more specific than the
          `/runs/:runId` dynamic route below. */}
      {ggRoutes(canExecute)}
      <Route path={routePatterns.runDetail} element={<RunPlayPage />} />
      <Route path={routePatterns.runVerdict} element={<RunVerdictPage />} />
      <Route path={routePatterns.runReview} element={<RunReviewPage />} />
      <Route path={routePatterns.runInputs} element={<RunInputsPage />} />
      <Route path={routePatterns.runProof} element={<RunProofPage />} />
      {/* Legacy Play deep links redirect to the bare run URL, where Play lives now. */}
      <Route path={routePatterns.runPlay} element={<RunPlayRedirect />} />
      <Route path={routePatterns.runMetrics} element={<RunMetricsPage />} />
      <Route path={routePatterns.runEvents} element={<RunEventsPage />} />
      {/* A finished gg run's rich view, rebuilt from its recorded telemetry — the
          same panels its live monitor showed. */}
      <Route path={routePatterns.runGg} element={<RunGgPage />} />
      {/* The static read of the code the run's model wrote — offered for any harness's
          run that carries one. */}
      <Route path={routePatterns.runCode} element={<RunCodePage />} />
      <Route path={routePatterns.runMetadata} element={<RunMetadataPage />} />
    </>
  );
}
