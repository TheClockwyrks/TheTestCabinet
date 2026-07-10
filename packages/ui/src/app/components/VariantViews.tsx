import { Markdown, SpecAccordion, type AccordionEntry } from "@test-cabinet/ui";
import type { SeededInput, VariantSummary } from "../data/testCases";
import { MediaView } from "./MediaView";

// Shared renderer for a variant's inputs: everything a run of the variant is
// given. The prompt the harness hands the model, the exact files it is seeded
// with, and the reference media it is judged against — gathered into one
// accordion. Both the test-case detail Inputs tab (where the variant comes from
// the URL slug) and the run detail Inputs tab (where it is resolved from the
// run's subject against the catalog) render this, so the two surfaces stay
// byte-for-byte identical and there is a single place that decides how a prompt,
// spec file, or reference reads.

/**
 * The kind of input an entry represents. It is shown as the entry's tag (in place
 * of the media type) so one scannable list still tells prompt from spec from
 * script from package from reference. `asset` is reserved for a future input kind
 * and is not yet produced.
 */
export type InputKind =
  | "prompt"
  | "spec"
  | "script"
  | "package"
  | "reference"
  | "asset";

/** The tag text shown for each input kind. */
const INPUT_KIND_LABELS: Record<InputKind, string> = {
  prompt: "Prompt",
  spec: "Spec",
  script: "Script",
  package: "Package",
  reference: "Reference",
  asset: "Asset",
};

// The inputs lead with the prompt (the first thing the model sees, naming the
// specs that follow), then the seeded spec files, then the reference media. Each
// entry is tagged with its input kind rather than its media type. The `key`
// collapses every panel again when the variant changes.
export function VariantInputsView({ variant }: { variant: VariantSummary }) {
  const entries: AccordionEntry[] = [
    // The prompt is always carried (every host provides it), but guard against an
    // empty one anyway.
    ...(variant.prompt
      ? [
          {
            path: "prompt",
            kind: INPUT_KIND_LABELS.prompt,
            body: <Markdown>{variant.prompt}</Markdown>,
          },
        ]
      : []),
    // The exact files a run of the variant is seeded with — the same set
    // `tcab seed --variant <slug>` materializes. The public snapshot inlines these
    // spec bodies, so they show on the static site too. Each is tagged by its role
    // (a prose "Spec" or an executable "Script" the model edits and runs).
    ...variant.seededInputs.map((input) => ({
      path: input.path,
      kind:
        input.role === "script"
          ? INPUT_KIND_LABELS.script
          : INPUT_KIND_LABELS.spec,
      body: <SeededBody input={input} />,
    })),
    // The Test Cabinet runtime packages the build is given — baked into the run
    // image and depended on by the seeded `package.json`, so the build imports them
    // to play a produced asset (e.g. a particle system). The body is the package's
    // UI-only description; unlike a spec it carries no seeded file, so it names what
    // the build uses the library for.
    ...variant.packages.map((pkg) => ({
      path: pkg.name,
      kind: INPUT_KIND_LABELS.package,
      body: <Markdown>{pkg.description}</Markdown>,
    })),
    // The reference media that are the variant's visual targets: rendered mockups
    // and static images, plus any reference video clips. They are validation
    // material, not seeded into a run. A video renders with native controls; an
    // image renders inline.
    ...variant.referenceScreenshots.map((shot) => {
      const ext = shot.kind === "video" ? "mp4" : "png";
      return {
        path: `reference/${shot.view}.${ext}`,
        kind: INPUT_KIND_LABELS.reference,
        body: (
          <MediaView
            kind={shot.kind}
            url={shot.url}
            alt={`${variant.name} ${shot.view}`}
          />
        ),
      };
    }),
  ];
  return (
    <SpecAccordion
      key={variant.slug}
      entries={entries}
      emptyLabel="This variant has no inputs."
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
