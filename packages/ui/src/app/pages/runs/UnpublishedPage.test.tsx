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
import { UnpublishedPage } from "./UnpublishedPage";

// A run summary carrying only the fields the run log and the query read.
function summary(id: string, slug: string): RunSummary {
  return {
    id,
    // Every run in this slice is unpublished by construction.
    publishedAt: "",
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:00Z",
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "v1.0.0",
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
    rating: "great",
    reviewCount: 1,
  } as unknown as RunSummary;
}

const TEST_CASES = [
  {
    slug: "alpha",
    name: "Alpha",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
  },
  { slug: "beta", name: "Beta", versions: ["v1.0.0"], latestVersion: "v1.0.0" },
] as unknown as TestCaseSummary[];

const WAITING = [summary("r-alpha", "alpha"), summary("r-beta", "beta")];

// A host whose `publishable` slice holds the two waiting runs and whose every
// other slice is empty — so a page asking for the wrong slice renders nothing.
function galleryValue(queries: RunQuery[]): GalleryDataInput {
  return {
    producedSummaries: WAITING,
    localIds: new Set(WAITING.map((run) => run.id)),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async (query: RunQuery): Promise<RunQueryResult> => {
      queries.push(query);
      const rows = query.state === "publishable" ? WAITING : [];
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
        <UnpublishedPage />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// The rendered run rows, in DOM order, as their leading test-case name.
function rowNames(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .flatMap((text) => ["Alpha", "Beta"].filter((n) => text.includes(n)));
}

describe("UnpublishedPage", () => {
  beforeEach(() => localStorage.clear());

  it("draws from the publish-gate slice, not everything unpublished", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);

    await waitFor(() => expect(rowNames().sort()).toEqual(["Alpha", "Beta"]));
    expect(queries[0]).toMatchObject({
      state: "publishable",
      offset: 0,
      limit: 20,
      sort: "date",
      dir: "desc",
    });
  });

  it("makes its rows selectable, which is how a batch is published", async () => {
    renderPage([]);
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    // A per-row checkbox plus the header's select-all — the affordance the whole
    // tab exists for. Every other worklist renders the log without it.
    expect(
      screen.getAllByRole("checkbox", { name: "Select run" }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Select all runs" }),
    ).toBeTruthy();
  });

  it("narrows the slice server-side rather than filtering the page", async () => {
    const queries: RunQuery[] = [];
    renderPage(queries);
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search unpublished runs" }),
      { target: { value: "alpha" } },
    );

    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        state: "publishable",
        q: "alpha",
      }),
    );
  });
});
