import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
import { AboutLayout } from "../../layouts/about/AboutLayout";
// The Metrics tab (`/about/metrics`): what the benchmark measures and what it
// deliberately doesn't. Pulled in raw and handed to the shared <Markdown>
// renderer.
import metrics from "./metrics.md?raw";

export function AboutMetricsPage() {
  return (
    <AboutLayout tab="metrics">
      <Panel>
        <Markdown>{metrics}</Markdown>
      </Panel>
    </AboutLayout>
  );
}
