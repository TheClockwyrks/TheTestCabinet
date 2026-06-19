import { Markdown, SpecAccordion, type AccordionEntry } from "@test-cabinet/ui";
import type { SeededInput, VariantSummary } from "../data/testCases";

// Shared renderers for a variant's specifications and reference images. Both the
// test-case detail tabs (where the variant comes from the URL slug) and the run
// detail tabs (where it is resolved from the run's subject against the catalog)
// render these, so the two surfaces stay byte-for-byte identical and there is a
// single place that decides how a prompt, seeded file, or reference reads.

// The specifications for a variant: the prompt the harness hands the model,
// followed by the exact files a run of the variant is seeded with — the same set
// `tcab seed --variant <slug>` materializes. The prompt leads because it is the
// first thing the model sees and names the specs that follow. The `key` collapses
// every panel again when the variant changes.
export function VariantSpecsView({ variant }: { variant: VariantSummary }) {
  const entries: AccordionEntry[] = [
    // The prompt is only carried for locally-previewed cases; the public
    // snapshot omits seeded inputs (but not the prompt), so skip the panel when
    // empty.
    ...(variant.prompt
      ? [
          {
            path: "prompt",
            kind: "text" as const,
            body: <Markdown>{variant.prompt}</Markdown>,
          },
        ]
      : []),
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
}

// The rendered reference screenshots that are the visual targets for a variant.
// They are validation material, not seeded into a run, so they read on their own
// apart from the specification files but share the same full-width accordion.
export function VariantReferencesView({
  variant,
}: {
  variant: VariantSummary;
}) {
  const entries: AccordionEntry[] = variant.referenceScreenshots.map((shot) => ({
    path: `reference/${shot.view}.png`,
    kind: "image",
    body: <img src={shot.url} alt={`${variant.name} ${shot.view}`} />,
  }));
  return (
    <SpecAccordion
      key={variant.slug}
      entries={entries}
      emptyLabel="This variant has no reference images."
    />
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
