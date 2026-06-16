import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
import { AboutLayout } from "../../layouts/about/AboutLayout";
// The Testing tab (`/about/testing`): how a run works — test cases, models, and
// runs. Pulled in raw and handed to the shared <Markdown> renderer.
import testing from "./testing.md?raw";

export function AboutTestingPage() {
  return (
    <AboutLayout tab="testing">
      <Panel>
        <Markdown>{testing}</Markdown>
      </Panel>
    </AboutLayout>
  );
}
