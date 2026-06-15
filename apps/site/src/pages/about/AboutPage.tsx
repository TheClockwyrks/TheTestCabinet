import { PageLayout } from "../../components/PageLayout";
import { Markdown } from "../../components/Markdown";
// The About page is just one Markdown file on disk — edit `about.md` and the
// page follows. We pull it in raw (same approach as data/writeups.ts) and hand
// it to the shared <Markdown> renderer for GFM + neon-themed prose.
import about from "./about.md?raw";

export function AboutPage() {
  return (
    <PageLayout>
      <Markdown>{about}</Markdown>
    </PageLayout>
  );
}
