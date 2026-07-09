import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../data/galleryContext";
import type { TestCaseSummary } from "../data/testCases";
import { RunLog, useRunTable } from "./RunLog";

// A run summary carrying only the fields the run log reads.
function summary(
  id: string,
  slug: string,
  opts: { tokens?: number; model?: string } = {},
): RunSummary {
  const { tokens = 100, model = "anthropic/claude" } = opts;
  return {
    id,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:00Z",
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: model,
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: tokens,
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

// In recency order (as a caller would pass): Gamma, Alpha, Beta — deliberately
// not alphabetical, and with token totals that sort differently again.
const RUNS = [
  summary("r-gamma", "gamma", { tokens: 300 }),
  summary("r-alpha", "alpha", { tokens: 100 }),
  summary("r-beta", "beta", { tokens: 200 }),
];

function galleryValue(): GalleryDataInput {
  return {
    runSummaries: RUNS,
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    testCases: TEST_CASES,
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: false,
  } as unknown as GalleryDataInput;
}

function Harness() {
  const table = useRunTable({
    runs: RUNS,
    localIds: new Set(),
    localWriteups: {},
  });
  return <RunLog rows={table.rows} controls={table.controls} />;
}

function renderLog() {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <Harness />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// The rendered run rows, in DOM order, as their leading test-case name.
function rowNames(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .map((text) => ["Alpha", "Beta", "Gamma"].find((n) => text.includes(n)) ?? "");
}

describe("RunLog", () => {
  beforeEach(() => localStorage.clear());

  it("renders sortable headers and keeps recency order by default", () => {
    renderLog();
    expect(
      screen.getByRole("button", { name: "Sort by TEST" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sort by TOKENS" }),
    ).toBeInTheDocument();
    expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("sorts by a column, cycling ascending → descending → default", () => {
    renderLog();
    const test = screen.getByRole("button", { name: "Sort by TEST" });

    fireEvent.click(test);
    expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(test).toHaveAttribute("data-active");

    fireEvent.click(test);
    expect(rowNames()).toEqual(["Gamma", "Beta", "Alpha"]);

    fireEvent.click(test); // back to the default (recency) order
    expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("sorts by a numeric column", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "Sort by TOKENS" }));
    // Ascending token totals: Alpha(100) < Beta(200) < Gamma(300).
    expect(rowNames()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("shows an optional column from the picker", () => {
    const { container } = renderLog();
    expect(container.querySelector('[data-label="Started"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "STARTED" }));

    expect(
      container.querySelectorAll('[data-label="Started"]').length,
    ).toBeGreaterThan(0);
  });

  it("hides a column that was shown by default", () => {
    const { container } = renderLog();
    expect(
      container.querySelectorAll('[data-label="Tokens"]').length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    // A base column that starts visible is now listed and can be hidden.
    fireEvent.click(screen.getByRole("checkbox", { name: "TOKENS" }));

    expect(container.querySelector('[data-label="Tokens"]')).toBeNull();
  });

  it("locks the last visible column so the table can't be emptied", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));

    // Hide every default-visible column but one; the survivor's box then locks.
    for (const label of ["TEST", "HARNESS", "VARIANT", "MODEL", "TOKENS", "COST"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    const survivor = screen.getByRole("checkbox", { name: "RATING" });
    expect(survivor).toBeDisabled();

    // A hidden column can still be re-shown, which unlocks the survivor again.
    fireEvent.click(screen.getByRole("checkbox", { name: "COST" }));
    expect(screen.getByRole("checkbox", { name: "RATING" })).not.toBeDisabled();
  });
});
