import { Markdown } from "../../../components/Markdown";
import {
  SpecAccordion,
  type AccordionEntry,
} from "../../../components/SpecAccordion";
import type { SeededInput } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Specifications tab (`/test-cases/:slug/specs`): the prompt the harness
// hands the model, followed by the exact files a run of the selected variant is
// seeded with — the same set `tcab seed --variant <slug>` materializes. The
// prompt leads because it is the first thing the model sees and names the specs
// that follow. Each entry is a full-width accordion panel keyed by its path, so
// it reads at the full content width instead of beside a tree. Reference images
// live on their own tab now, so this lists only the prompt and seeded inputs.
// The `key` collapses every panel again when the variant changes.
export function TestCaseSpecsPage() {
  return (
    <TestCaseDetailLayout tab="specs">
      {({ variant }) => {
        const entries: AccordionEntry[] = [
          {
            path: "prompt",
            kind: "text",
            body: <Markdown>{variant.prompt}</Markdown>,
          },
          ...variant.seededInputs.map((input) => ({
            path: input.path,
            kind: input.kind,
            body: <SeededBody input={input} />,
          })),
        ];
        return (
          <SpecAccordion
            key={variant.slug}
            entries={entries}
            emptyLabel="This variant seeds no files."
          />
        );
      }}
    </TestCaseDetailLayout>
  );
}

// A seeded file's body: prose for Markdown, a fenced code block for other text,
// the rendered image for a binary asset.
function SeededBody({ input }: { input: SeededInput }) {
  if (input.kind === "text" && input.text !== undefined) {
    return <Markdown>{fence(input.path, input.text)}</Markdown>;
  }
  if (input.url) {
    return <img src={input.url} alt={input.path} />;
  }
  return null;
}

// Markdown source files render as prose; every other text file renders as a
// fenced code block so it is shown verbatim, tagged with its extension as the
// language hint.
function fence(path: string, text: string): string {
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return text;
  }
  const lang = path.split(".").pop() ?? "";
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}
