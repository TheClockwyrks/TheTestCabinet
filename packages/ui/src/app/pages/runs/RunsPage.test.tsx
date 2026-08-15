import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import type { RunQuery, RunQueryResult } from "../../data/runQuery";
import { runSummaryPage } from "../../data/runQuery";
import type { TestCaseSummary } from "../../data/testCases";
import { RunsPage } from "./RunsPage";

// A run summary carrying only the fields the run log and the query read.
function summary(
  id: string,
  slug: string,
  opts: { published?: boolean; startedAt?: string; version?: string } = {},
): RunSummary {
  const {
    published = true,
    startedAt = "2026-01-01T00:00:00Z",
    version = "v1.0.0",
  } = opts;
  return {
    id,
    publishedAt: published ? "2026-01-02T00:00:00Z" : "",
    startedAt,
    finishedAt: startedAt,
    subject: {
      testCaseSlug: slug,
      testCaseVersion: version,
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: "anthropic/claude",
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

const TEST_CASES = [
  // Alpha is the only multi-version case, so its versions are what the version
  // facet must offer once Alpha is selected.
  {
    slug: "alpha",
    name: "Alpha",
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
  },
  { slug: "beta", name: "Beta", versions: ["v1.0.0"], latestVersion: "v1.0.0" },
  {
    slug: "gamma",
    name: "Gamma",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
  },
] as unknown as TestCaseSummary[];

// The cabinet this fake host holds: two published runs and — newest — one still
// unpublished, i.e. one nobody has reviewed yet. Deliberately neither in
// alphabetical order nor grouped by publish state.
const PUBLISHED_NEW = summary("r-gamma", "gamma", {
  startedAt: "2026-01-03T00:00:00Z",
});
const UNPUBLISHED = summary("r-alpha", "alpha", {
  published: false,
  startedAt: "2026-01-02T00:00:00Z",
  version: "v2.0.0",
});
// Alpha's superseded v1: in the cabinet, but out of scope by default.
const PUBLISHED_STALE = summary("r-alpha-old", "alpha", {
  startedAt: "2026-01-04T00:00:00Z",
  version: "v1.0.0",
});
const PUBLISHED_OLD = summary("r-beta", "beta", {
  startedAt: "2026-01-01T00:00:00Z",
});
const ALL_RUNS = [PUBLISHED_NEW, UNPUBLISHED, PUBLISHED_OLD, PUBLISHED_STALE];

// A host that answers a summary query the way the backend does: the `any` slice
// sees every run, `published` only the published ones. Records each query so a
// test can assert what the page asked the server for.
function galleryValue(queries: RunQuery[]): GalleryDataInput {
  return {
    // The produced worklist the console holds locally. A listing must NOT merge
    // this in — the queried slice already carries the run.
    producedSummaries: [UNPUBLISHED],
    localIds: new Set([UNPUBLISHED.id]),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery): Promise<RunQueryResult> => {
      queries.push(query);
      const rows =
        query.state === "any"
          ? ALL_RUNS
          : ALL_RUNS.filter((run) => run.publishedAt);
      return runSummaryPage(rows, { ...query, state: "published" });
    },
    testCases: TEST_CASES,
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function renderPage(queries: RunQuery[]) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue(queries)}>
        <RunsPage />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// The rendered run rows, in DOM order, as their leading test-case name.
function rowNames(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .flatMap((text) =>
      ["Alpha", "Beta", "Gamma"].filter((n) => text.includes(n)),
    );
}

describe("RunsPage", () => {
  beforeEach(() => localStorage.clear());

  it("draws from the union slice so unreviewed runs are not pinned first", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);

    // Date-descending by default: the unpublished (unreviewed) run sits in the
    // middle by its own date, not hoisted to the top of the page.
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
    expect(queries[0]).toMatchObject({
      state: "any",
      offset: 0,
      limit: 20,
      sort: "date",
      dir: "desc",
    });
  });

  it("re-queries the server on a header sort instead of sorting the page", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Sort by TEST" }));

    // The sort travels as the column's server key, still over the union slice and
    // back at the first page — and the unreviewed run sorts by name like any other.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        state: "any",
        sort: "testCase",
        dir: "asc",
        offset: 0,
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma"]));
  });

  it("sends the search to the server rather than filtering the page", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), {
      target: { value: "alpha" },
    });

    // Debounced, then queried server-side: the page holds only the matching row,
    // and the produced worklist is not searched client-side beside it.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ state: "any", q: "alpha" }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha"]));
  });

  it("scopes to each case's current version by default, and can be widened", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);

    // Alpha is on v2, so its superseded v1 run is out of scope even though it is
    // the newest run in the cabinet — a run against a different spec is not
    // comparable with the current one's.
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
    expect(queries[0]).toMatchObject({ latestVersions: true });

    fireEvent.click(
      screen.getByRole("checkbox", { name: /current versions only/i }),
    );

    // Widened: the stale v1 run reappears, newest-first.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ latestVersions: false }),
    );
    await waitFor(() =>
      expect(rowNames()).toEqual(["Alpha", "Gamma", "Alpha", "Beta"]),
    );
  });

  it("filters by an exact version once a case narrows the choice", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    // A version only means something within a case, so the facet waits for one.
    expect(screen.getByRole("combobox", { name: "Version" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Test case" }), {
      target: { value: "alpha" },
    });
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ testCase: "alpha" }),
    );

    const version = screen.getByRole("combobox", { name: "Version" });
    expect(version).toBeEnabled();
    fireEvent.change(version, { target: { value: "v1.0.0" } });

    // The exact version overrides the current-version toggle — asking for an older
    // version must show it, not silently empty the listing.
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        testCase: "alpha",
        version: "v1.0.0",
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Alpha"]));
  });

  it("clears every filter back to the default view", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fireEvent.change(screen.getByRole("combobox", { name: "Harness" }), {
      target: { value: "codex" },
    });
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ harness: "codex" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        harness: undefined,
        latestVersions: true,
      }),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]));
  });
});
