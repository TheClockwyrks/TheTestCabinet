import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { RunQuery } from "../../../data/runQuery";
import { runSummaryPage } from "../../../data/runQuery";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { RunsContent } from "./TestCaseRunsPage";

// A run summary carrying only the fields the run log and the query read.
function summary(
  id: string,
  opts: {
    variant: string;
    version?: string;
    engine?: string;
    published?: boolean;
    startedAt?: string;
  },
): RunSummary {
  const {
    variant,
    version = "v1.1.1",
    engine = "none",
    published = true,
    startedAt = "2026-01-01T00:00:00Z",
  } = opts;
  return {
    id,
    publishedAt: published ? "2026-01-02T00:00:00Z" : "",
    startedAt,
    finishedAt: startedAt,
    subject: {
      testCaseSlug: "alpha",
      testCaseVersion: version,
      testType: "end-to-end",
      variant,
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: "anthropic/claude",
      engineSlug: engine,
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: 1 },
    },
    state: "completed",
    rating: null,
  } as unknown as RunSummary;
}

// Three published versions across two minors, two variants and two engines on
// the latest — enough frame for every scope control to appear.
const TEST_CASE = {
  slug: "alpha",
  name: "Alpha",
  versions: ["v1.1.1", "v1.1.0", "v1.0.0"],
  latestVersion: "v1.1.1",
  variantsByVersion: {
    "v1.1.1": [
      { slug: "base", name: "Base" },
      { slug: "gyre", name: "Gyre" },
    ],
    "v1.1.0": [
      { slug: "base", name: "Base" },
      { slug: "gyre", name: "Gyre" },
    ],
    "v1.0.0": [{ slug: "base", name: "Base" }],
  },
  enginesByVersion: {
    "v1.1.1": ["none", "simple-2d"],
    "v1.1.0": ["none"],
    "v1.0.0": ["none"],
  },
} as unknown as TestCaseDetail;
const VARIANT = { slug: "base", name: "Base" } as unknown as VariantSummary;

// Runs across the versions, variants, and engines the scopes tell apart: the
// anchored coordinate's newest run is still unpublished, `r-engine` ran under
// the other engine, `r-3` is the other variant, and `r-old` an older minor.
const RUNS = [
  summary("r-1", { variant: "base", startedAt: "2026-01-01T00:00:00Z" }),
  summary("r-2", {
    variant: "base",
    published: false,
    startedAt: "2026-01-05T00:00:00Z",
  }),
  summary("r-engine", {
    variant: "base",
    engine: "simple-2d",
    startedAt: "2026-01-04T00:00:00Z",
  }),
  summary("r-3", { variant: "gyre", startedAt: "2026-01-03T00:00:00Z" }),
  summary("r-old", {
    variant: "base",
    version: "v1.0.0",
    startedAt: "2026-01-02T00:00:00Z",
  }),
];

function galleryValue(queries: RunQuery[]): GalleryDataInput {
  return {
    producedSummaries: [RUNS[1]!],
    localIds: new Set(["r-2"]),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery) => {
      queries.push(query);
      const rows =
        query.state === "any" ? RUNS : RUNS.filter((run) => run.publishedAt);
      return runSummaryPage(rows, { ...query, state: "published" });
    },
    testCases: [TEST_CASE],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

// Render the shared Runs body anchored to (v1.1.1, base, none) — the context
// the detail layout would resolve for the default coordinate.
function renderTab(queries: RunQuery[], url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <GalleryDataProvider value={galleryValue(queries)}>
        <RunsContent
          testCase={TEST_CASE}
          version="v1.1.1"
          engine="none"
          isLatest
          variant={VARIANT}
        />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

function renderedRunLinks(): (string | null)[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"))
    .filter((href) => href?.startsWith("/runs/"));
}

describe("TestCaseRunsPage runs tab", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the anchored minor line, engine, and variant", async () => {
    const queries: RunQuery[] = [];
    renderTab(queries);

    // The other variant's, other engine's, and older-minor runs are filtered out
    // server-side; the unpublished run leads by date rather than by being pinned.
    await waitFor(() =>
      expect(renderedRunLinks()).toEqual(["/runs/r-2", "/runs/r-1"]),
    );
    expect(queries[0]).toMatchObject({
      state: "any",
      testCase: "alpha",
      versions: ["v1.1.1", "v1.1.0"],
      engine: "none",
      variant: "base",
      offset: 0,
      limit: 20,
      sort: "date",
      dir: "desc",
    });
    // The version scoping happens in the controls above, not in the filter bar:
    // no version facet, no current-versions toggle, and no latestVersions sent
    // (the explicit versions list silences it anyway).
    expect(queries[0]?.latestVersions).toBeUndefined();
    expect(queries[0]?.version).toBeUndefined();
    expect(screen.queryByRole("combobox", { name: "Version" })).toBeNull();
    expect(screen.queryByLabelText("Current versions only")).toBeNull();
    // The scope row offers every axis the anchor can widen.
    expect(
      screen.getByRole("radiogroup", { name: "Version scope" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Engine scope" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Variant scope" }),
    ).not.toBeNull();
  });

  it("widened to all sends no version/engine/variant filter at all", async () => {
    const queries: RunQuery[] = [];
    renderTab(queries, "/?scope=all&engines=all&variants=all");

    // Every recorded run of the case, whatever its version, engine, or variant.
    await waitFor(() =>
      expect(renderedRunLinks()).toEqual([
        "/runs/r-2",
        "/runs/r-engine",
        "/runs/r-3",
        "/runs/r-old",
        "/runs/r-1",
      ]),
    );
    expect(queries[0]).toMatchObject({
      state: "any",
      testCase: "alpha",
      // Explicitly off: "All versions" means the whole history, not the
      // current-minor default the cross-case listings apply.
      latestVersions: false,
    });
    expect(queries[0]?.versions).toBeUndefined();
    expect(queries[0]?.engine).toBeUndefined();
    expect(queries[0]?.variant).toBeUndefined();
  });

  it("narrowing to the exact anchored version sends just that version", async () => {
    const queries: RunQuery[] = [];
    renderTab(queries);
    await waitFor(() =>
      expect(renderedRunLinks()).toEqual(["/runs/r-2", "/runs/r-1"]),
    );

    fireEvent.click(screen.getByRole("radio", { name: "v1.1.1" }));

    await waitFor(() =>
      expect(queries[queries.length - 1]).toMatchObject({
        versions: ["v1.1.1"],
        engine: "none",
        variant: "base",
      }),
    );
  });
});
