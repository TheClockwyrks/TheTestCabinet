import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ProgressCallback, RunEventStreams } from "../../client/types";
import { type ParsedWriteup, parseWriteup } from "./ratings";
import type { TestCaseSummary } from "./testCases";

// The gallery's data source, injected by the host app. The same routed UI lives
// in `@test-cabinet/ui`, but its data differs per app: the static site builds
// this from the build-time public snapshot; the web/desktop consoles build it
// live from a backend (catalog + published runs) and a worker (in-progress and
// produced runs). Pages read it through the existing data hooks (`useRuns`,
// `useTestCases`, `findReview`), which now resolve to this context — so page
// logic is unchanged regardless of where the data comes from.

// A run currently executing on a worker. A run only gains a `RunRecord` at
// completion, so an in-progress run is represented by its launch identity and
// live state instead. It is shown ahead of the completed runs in the list. Live
// in-progress runs are tracked in the runs runtime (see runtime/runsRuntime),
// not in this data value, since they change as a session launches runs. The shape
// is the worker's active-run row, so it is defined once in the client layer.
export type { InProgressRun } from "../../client/types";

// The value each host builds and provides. `findReview` is derived by the
// provider from `writeups`, so hosts do not supply it.
export interface GalleryDataInput {
  /** Completed runs to display: local (unpublished) first, then published. */
  runs: RunRecord[];
  /** Ids of runs sourced locally (produced but not yet published). */
  localIds: ReadonlySet<string>;
  /**
   * Raw writeups keyed by run id — the `---\nrating: …\n---\n\n<body>` framing
   * `parseWriteup` reads. Holds both published reviews and local previews.
   */
  writeups: Readonly<Record<string, string>>;
  /** True while the run list is still loading. */
  runsLoading: boolean;
  /** The test-case catalog. */
  testCases: TestCaseSummary[];
  /** True when the test cases shown are design-preview samples, not the catalog. */
  testCasesUsingSamples: boolean;
  /**
   * Whether this UI can launch, monitor, review, and publish runs. False on the
   * static gallery site; true in the web and desktop consoles. Gates the
   * run-execution UI (new-run button, live monitor, editable review, the
   * connections drawer).
   */
  canExecute: boolean;
  /**
   * Fetch a finished run's recorded event streams for the run-detail Events tab.
   * Each host sources these its own way (the static site from a published asset,
   * the consoles from their worker/backend clients). Resolves `null` when the
   * host cannot provide events for the run at all (vs. an empty `events` array,
   * which means the run recorded none). Omitted by a host that supports no
   * events at all. `onProgress`, when supplied, reports transfer progress as a
   * (possibly large) stream downloads, for the tab's progress bar; a host that
   * can't observe the transfer simply never calls it.
   */
  fetchRunEvents?: (
    runId: string,
    onProgress?: ProgressCallback,
  ) => Promise<RunEventStreams | null>;
}

export interface GalleryData extends GalleryDataInput {
  /**
   * Resolve a run's review. A caller-supplied `override` map (a run's local
   * writeups) takes precedence over the provided `writeups`. Returns undefined
   * when the run has no writeup at all.
   */
  findReview(
    runId: string,
    override?: Readonly<Record<string, string>>,
  ): ParsedWriteup | undefined;
}

const GalleryDataContext = createContext<GalleryData | null>(null);

export function GalleryDataProvider({
  value,
  children,
}: {
  value: GalleryDataInput;
  children: ReactNode;
}) {
  const full = useMemo<GalleryData>(() => {
    const { writeups } = value;
    return {
      ...value,
      findReview(runId, override) {
        const raw = override?.[runId] ?? writeups[runId];
        return raw === undefined ? undefined : parseWriteup(raw);
      },
    };
  }, [value]);
  return (
    <GalleryDataContext.Provider value={full}>
      {children}
    </GalleryDataContext.Provider>
  );
}

export function useGalleryData(): GalleryData {
  const ctx = useContext(GalleryDataContext);
  if (!ctx) {
    throw new Error("useGalleryData must be used within a GalleryDataProvider");
  }
  return ctx;
}
