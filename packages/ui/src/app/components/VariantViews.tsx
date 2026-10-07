import { Markdown } from "@clockwyrks/ui";
import type {
  SeededInput,
  VariantSummary,
  WorkspaceFileRef,
} from "../data/testCases";
import {
  InputBrowser,
  InputViewerNote,
  type InputBrowserGroup,
  type InputBrowserItem,
} from "./InputBrowser";
import { createAssetCache, useCachedAsset } from "../data/assetCache";
import { LoadingState } from "./LoadingState";
import { MediaView } from "./MediaView";
import { SourceView } from "./SourceView";

// Shared renderer for a variant's inputs: everything a run of the variant is
// given. The prompt the harness hands the model, the exact files it is seeded
// with, the starter workspace those files land in, and the reference media it is
// judged against — gathered into one grouped file tree beside a persistent
// viewer (see InputBrowser). Both the test-case detail Inputs tab (where the
// variant comes from the URL slug) and the run detail Inputs tab (where it is
// resolved from the run's subject against the catalog) render this, so the two
// surfaces stay byte-for-byte identical and there is a single place that decides
// how a prompt, spec file, or reference reads.

/**
 * A text file seeded into one particular run rather than authored on its variant —
 * today, the `previous-entries/` READMEs a repeated game-jam run is briefed with.
 * It is still an input the model was handed, so it reads as one: same tree,
 * same body rendering.
 */
export interface RunSeededInput {
  /** Path of the file inside the seeded repository, as the model saw it. */
  path: string;
  /** The file's contents, rendered inline. */
  text: string;
}

// The tree leads with the prompt (the first thing the model sees, naming the
// specs that follow), then the seeded spec files, the starter workspace, the
// shipped packages, the reference media, and finally any files seeded for this
// run alone. Empty groups are omitted; the prompt starts selected. The `key`
// resets the selection when the variant changes.
export function VariantInputsView({
  variant,
  runSeededInputs = [],
}: {
  variant: VariantSummary;
  /** Files seeded into a single run, shown alongside the variant's own inputs. */
  runSeededInputs?: RunSeededInput[];
}) {
  const groups: InputBrowserGroup[] = [
    {
      label: "Prompt",
      // The prompt is always carried (every host provides it), but guard against
      // an empty one anyway.
      items: variant.prompt
        ? [
            {
              id: "prompt",
              label: "prompt",
              render: () => <Markdown>{variant.prompt}</Markdown>,
            },
          ]
        : [],
    },
    {
      label: "Specs",
      // The exact files a run of the variant is seeded with — the same set
      // `tcab seed --variant <slug>` materializes. The public snapshot inlines
      // these spec bodies, so they show on the static site too.
      items: variant.seededInputs.map(
        (input): InputBrowserItem => ({
          id: `spec:${input.path}`,
          label: input.path,
          render: () => <SeededBody input={input} />,
        }),
      ),
    },
    {
      label: "Workspace",
      // The starter project a run is seeded into, newly surfaced here. Only the
      // paths travel with the catalog; a file's contents are fetched by its URL
      // when it is selected (the browser renders only the selected body, so the
      // fetch is naturally lazy).
      items: (variant.workspace ?? []).map(
        (file): InputBrowserItem => ({
          id: `workspace:${file.path}`,
          label: file.path,
          render: () => <WorkspaceFileBody file={file} />,
        }),
      ),
    },
    {
      label: "Packages",
      // The Test Cabinet runtime packages the build is given — baked into the run
      // image and depended on by the seeded `package.json`, so the build imports
      // them to play a produced asset (e.g. a particle system). The body is the
      // package's UI-only description; unlike a spec it carries no seeded file,
      // so it names what the build uses the library for.
      items: variant.packages.map(
        (pkg): InputBrowserItem => ({
          id: `package:${pkg.name}`,
          label: pkg.name,
          render: () => <Markdown>{pkg.description}</Markdown>,
        }),
      ),
    },
    {
      label: "Reference",
      // The reference media that are the variant's visual targets: rendered
      // mockups and static images, plus any reference video clips or engine
      // replays. They are validation material, not seeded into a run. A video
      // renders with native controls; an image renders inline; a replay is
      // re-drawn onto a canvas with its own transport.
      items: variant.referenceScreenshots.map((shot): InputBrowserItem => {
        const ext =
          shot.kind === "video"
            ? "mp4"
            : shot.kind === "replay"
              ? "json"
              : "png";
        return {
          id: `reference:${shot.view}`,
          label: `reference/${shot.view}.${ext}`,
          render: () => (
            <MediaView
              kind={shot.kind}
              url={shot.url}
              alt={`${variant.name} ${shot.view}`}
            />
          ),
        };
      }),
    },
    {
      label: "Previous entries",
      // The files this run alone was seeded with, read the same way as the
      // variant's own: by their path in the workspace, body inline.
      items: runSeededInputs.map(
        (input): InputBrowserItem => ({
          id: `run:${input.path}`,
          label: input.path,
          render: () => <TextFileBody path={input.path} text={input.text} />,
        }),
      ),
    },
  ];
  return (
    <InputBrowser
      key={variant.slug}
      groups={groups}
      initialSelectedId="prompt"
      emptyLabel="This variant has no inputs."
    />
  );
}

// A seeded file's body: prose for Markdown, the source inline for other text,
// the rendered image for a binary asset.
function SeededBody({ input }: { input: SeededInput }) {
  if (input.kind === "text" && input.text !== undefined) {
    return <TextFileBody path={input.path} text={input.text} />;
  }
  if (input.url) {
    return <img src={input.url} alt={input.path} />;
  }
  return null;
}

// The starter-workspace file bodies, by URL.
//
// Selecting a file mounts a fresh `WorkspaceFileBody`, so without this every
// re-selection refetched the same content-addressed (and therefore immutable)
// bytes — and re-selecting a file just read put a spinner over text the session
// already held. Bounded at 256 files / 8 MB: a starter workspace is source text,
// which is kilobytes a file, and 256 is more files than any workspace ships.
const workspaceFiles = createAssetCache<string>({
  name: "workspace file",
  maxEntries: 256,
  maxBytes: 8 * 1024 * 1024,
  weigh: (text) => text.length * 2,
  load: async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `workspace file fetch failed: HTTP ${response.status} (${url})`,
      );
    }
    return response.text();
  },
});

// A starter-workspace file's body: fetched by URL when the entry is selected
// (this component mounts only then), rendered like any other seeded text file —
// prose for Markdown, the source inline otherwise. A file already read this session
// renders on the first frame with no loading state. A host that cannot serve the
// bytes (`url: null`) says so instead, the same degrade the showcase media use.
function WorkspaceFileBody({ file }: { file: WorkspaceFileRef }) {
  const { path, url } = file;
  const { data, loading, error } = useCachedAsset(workspaceFiles, url ?? null);
  if (!url) {
    return <InputViewerNote>This file is not available here.</InputViewerNote>;
  }
  if (loading) {
    return <LoadingState size="section" label="Loading file…" />;
  }
  if (error !== null || data === null) {
    return <InputViewerNote>This file could not be loaded.</InputViewerNote>;
  }
  return <TextFileBody path={path} text={data} />;
}

// Markdown source files render as prose; every other text file renders inline as
// source, syntax-highlighted when the extension names a language the console
// recognizes.
function TextFileBody({ path, text }: { path: string; text: string }) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return <Markdown>{text}</Markdown>;
  }
  return <SourceView path={path} text={text} />;
}
