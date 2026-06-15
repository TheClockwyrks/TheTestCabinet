import { PageLayout } from "../../components/PageLayout";
import { Markdown } from "../../components/Markdown";
import { Panel } from "../../components/Panel";
// The About page is just one Markdown file on disk — edit `about.md` and the
// page follows. We pull it in raw (same approach as data/writeups.ts) and hand
// it to the shared <Markdown> renderer for GFM + neon-themed prose. The page is
// pure prose over the backdrop, so it goes in a <Panel> to stay legible against
// the grid.
import about from "./about.md?raw";

export function AboutPage() {
  return (
    <PageLayout>
      <Panel>
        <Markdown>{about}</Markdown>
      </Panel>
    </PageLayout>
  );
}
