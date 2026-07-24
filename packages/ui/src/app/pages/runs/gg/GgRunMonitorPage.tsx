import { useParams } from "react-router";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";

// The live gg run monitor (`/runs/gg/:jobId/live`, consoles only). It watches an
// enqueued gg run through the launch ack's `jobId`, riding the existing
// `GET /jobs/{id}/live` NDJSON relay (gg needs no new live route) and rendering
// gg's native `GgTelemetryEvent` stream. This is a Stage-U1 scaffold; the real
// telemetry feed (turns, tool calls, running token/cost totals, session end) lands
// in U3.
export function GgRunMonitorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  return (
    <PageLayout fill>
      <PromptHeader
        command="--gg watch"
        comment="// live telemetry for a running gg run"
        arg={jobId ?? ""}
        blink
      />
      <p>The live gg run monitor is coming soon.</p>
    </PageLayout>
  );
}
