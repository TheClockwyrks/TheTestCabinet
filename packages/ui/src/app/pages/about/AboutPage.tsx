import { Markdown, Panel } from "@test-cabinet/ui";
import { AboutLayout } from "../../layouts/about/AboutLayout";
// The About tab (`/about`): the section's top-level description. We pull the
// Markdown in raw (same approach as data/writeups.ts) and hand it to the shared
// <Markdown> renderer; the <Panel> keeps the prose legible over the backdrop.
import about from "./about.md?raw";

export function AboutPage() {
  return (
    <AboutLayout tab="about">
      <Panel>
        <Markdown>{about}</Markdown>
      </Panel>
    </AboutLayout>
  );
}
