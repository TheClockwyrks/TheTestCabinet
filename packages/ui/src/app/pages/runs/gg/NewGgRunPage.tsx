import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";

// The gg run-configuration page (`/runs/gg/new`, consoles only). gg is headless,
// so this is the only surface that assembles a capability set — which capabilities
// are on, their implementations/params, and the model-slot bindings — and launches
// a run (`WorkerClient.launchGgRun` -> `POST /gg/runs`). This is a Stage-U1
// scaffold; the real capability-set builder + launch flow lands in U2.
export function NewGgRunPage() {
  return (
    <PageLayout>
      <PromptHeader
        command="--gg new"
        comment="// assemble a capability set and launch a gg run"
        blink
      />
      <p>The gg run configuration form is coming soon.</p>
    </PageLayout>
  );
}
