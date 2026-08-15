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
  opts: { published?: boolean; startedAt?: string } = {},
): RunSummary {
  const { published = true, startedAt = "2026-01-01T00:00:00Z" } = opts;
  return {
    id,
    publishedAt: published ? "2026-01-02T00:00:00Z" : "",
    startedAt,
    finishedAt: startedAt,
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "1.0.0",
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
  { slug: "alpha", name: "Alpha" },
  { slug: "beta", name: "Beta" },
  { slug: "gamma", name: "Gamma" },
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
});
const PUBLISHED_OLD = summary("r-beta", "beta", {
  startedAt: "2026-01-01T00:00:00Z",
});
const ALL_RUNS = [PUBLISHED_NEW, UNPUBLISHED, PUBLISHED_OLD];

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
});
