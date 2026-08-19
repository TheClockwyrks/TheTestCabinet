import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../../data/galleryContext";
import type { RunQuery } from "../../../data/runQuery";
import { runSummaryPage } from "../../../data/runQuery";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { RunsContent } from "./TestCaseRunsPage";

// A run summary carrying only the fields the run log and the query read.
function summary(
  id: string,
  opts: { variant: string; published?: boolean; startedAt?: string },
): RunSummary {
  const {
    variant,
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
      testCaseVersion: "1.0.0",
      testType: "end-to-end",
      variant,
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

const TEST_CASE = {
  slug: "alpha",
  name: "Alpha",
} as unknown as TestCaseSummary;
const VARIANT = { slug: "base", name: "Base" } as unknown as VariantSummary;

// One case, two variants; the base variant's newest run is still unpublished.
const RUNS = [
  summary("r-1", { variant: "base", startedAt: "2026-01-01T00:00:00Z" }),
  summary("r-2", {
    variant: "base",
    published: false,
    startedAt: "2026-01-03T00:00:00Z",
  }),
  summary("r-3", { variant: "gyre", startedAt: "2026-01-02T00:00:00Z" }),
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

function renderTab(queries: RunQuery[]) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue(queries)}>
        <RunsContent testCase={TEST_CASE} variant={VARIANT} />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("TestCaseRunsPage runs tab", () => {
  beforeEach(() => localStorage.clear());

  it("pages one server query scoped to the case and variant", async () => {
    const queries: RunQuery[] = [];
    renderTab(queries);

    // The other variant's run is filtered out server-side, and the case's
    // unpublished run leads by date rather than by being pinned.
    await waitFor(() =>
      expect(
        screen.getAllByRole("link").map((l) => l.getAttribute("href")),
      ).toEqual(["/runs/r-2", "/runs/r-1"]),
    );
    expect(queries[0]).toMatchObject({
      state: "any",
      testCase: "alpha",
      variant: "base",
      offset: 0,
      limit: 20,
      sort: "date",
      dir: "desc",
    });
  });
});
