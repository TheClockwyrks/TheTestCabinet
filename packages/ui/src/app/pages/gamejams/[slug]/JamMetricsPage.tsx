import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import { MetricsContent } from "../../testcases/[slug]/TestCaseMetricsPage";

// The Metrics tab (`/game-jams/:slug/metrics`): token and cost distributions for
// the selected variant, grouped by model — the same shared body the test-case
// Metrics tab renders (run metrics are review-model-independent).
export function JamMetricsPage() {
  return (
    <JamDetailLayout tab="metrics">
      {({ testCase, variant }) => (
        <MetricsContent testCase={testCase} variant={variant} />
      )}
    </JamDetailLayout>
  );
}
