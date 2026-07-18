import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../data/galleryContext";
import type { TestCaseSummary } from "../data/testCases";
import { RunLog, sortStateToQuery, useRunTable } from "./RunLog";

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
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: TEST_CASES,
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: false,
  } as unknown as GalleryDataInput;
}

function Harness({ externalOrder = false }: { externalOrder?: boolean }) {
  const table = useRunTable({
    runs: RUNS,
    localIds: new Set(),
    localWriteups: {},
    externalOrder,
  });
  return <RunLog rows={table.rows} controls={table.controls} />;
}

function renderLog(externalOrder = false) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <Harness externalOrder={externalOrder} />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

function SelectHarness({ runs = RUNS }: { runs?: RunSummary[] }) {
  const table = useRunTable({
    runs,
    localIds: new Set(),
    localWriteups: {},
    externalOrder: true,
  });
  return <RunLog rows={table.rows} controls={table.controls} selectable />;
}

function renderSelectable(runs: RunSummary[] = RUNS) {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <SelectHarness runs={runs} />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

// The rendered run rows, in DOM order, as their leading test-case name.
function rowNames(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .map(
      (text) => ["Alpha", "Beta", "Gamma"].find((n) => text.includes(n)) ?? "",
    );
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

  it("renders rows in the given order and does not reorder on sort in externalOrder mode", () => {
    renderLog(true);
    // The given order is preserved (no client sort applied).
    expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]);

    // Clicking a header still activates the sort control (so a page can read it and
    // re-query) but the already-ordered rows are left as given.
    const test = screen.getByRole("button", { name: "Sort by TEST" });
    fireEvent.click(test);
    expect(test).toHaveAttribute("data-active");
    expect(rowNames()).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("opens a per-run menu on a row right-click", () => {
    renderLog();
    // No menu until a row is right-clicked.
    expect(screen.queryByRole("menu", { name: "Run actions" })).toBeNull();

    fireEvent.contextMenu(screen.getAllByRole("link")[0]!);

    const menu = screen.getByRole("menu", { name: "Run actions" });
    expect(menu).toBeInTheDocument();
    for (const label of [
      "Open",
      "Open in new tab",
      "Open test case",
      "Open model",
      "Copy link",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("disables Open model when the run's model isn't in the catalog", () => {
    // The gallery has no models, so the row's model can't resolve to a page.
    renderLog();
    fireEvent.contextMenu(screen.getAllByRole("link")[0]!);
    expect(screen.getByRole("menuitem", { name: "Open model" })).toBeDisabled();
  });

  it("omits Delete run where deletion isn't allowed (the static site)", () => {
    // canExecute is false in this harness (the read-only static gallery), so the
    // destructive item never appears.
    renderLog();
    fireEvent.contextMenu(screen.getAllByRole("link")[0]!);
    expect(screen.queryByRole("menuitem", { name: "Delete run" })).toBeNull();
  });

  it("renders per-row and select-all checkboxes when selectable", () => {
    renderSelectable();
    expect(
      screen.getByRole("checkbox", { name: "Select all runs" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("checkbox", { name: "Select run" }),
    ).toHaveLength(3);
    // A non-selectable log renders no checkboxes at all.
    renderLog();
    expect(
      screen.getAllByRole("checkbox", { name: "Select run" }),
    ).toHaveLength(3);
  });

  it("select-all checks every row and toggling back clears them", () => {
    renderSelectable();
    const all = screen.getByRole("checkbox", { name: "Select all runs" });

    fireEvent.click(all);
    expect(
      screen.getAllByRole("checkbox", { name: "Deselect run" }),
    ).toHaveLength(3);
    // The select-all now reads as fully checked (its label flips to deselect).
    expect(
      screen.getByRole("checkbox", { name: "Deselect all runs" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Deselect all runs" }),
    );
    expect(screen.queryByRole("checkbox", { name: "Deselect run" })).toBeNull();
  });

  it("switches a right-click to the batch menu once rows are checked", () => {
    // Two of the three runs share a test case, so the de-duped "open test cases"
    // action collapses them to one while the runs stay two.
    const dupRuns = [
      summary("dup-1", "alpha"),
      summary("dup-2", "alpha"),
      summary("dup-3", "beta"),
    ];
    renderSelectable(dupRuns);

    const boxes = screen.getAllByRole("checkbox", { name: "Select run" });
    fireEvent.click(boxes[0]!); // dup-1 (alpha)
    fireEvent.click(boxes[1]!); // dup-2 (alpha)

    // Both picked rows now read as selected.
    expect(
      screen.getAllByRole("checkbox", { name: "Deselect run" }),
    ).toHaveLength(2);

    // Right-clicking any row now opens the batch menu over the selection.
    fireEvent.contextMenu(screen.getAllByRole("link")[2]!);
    const menu = screen.getByRole("menu", { name: "Run actions" });
    expect(menu).toBeInTheDocument();

    expect(
      screen.getByRole("menuitem", { name: "Open 2 runs in new tabs" }),
    ).toBeInTheDocument();
    // Both selected runs are the same test case: de-duped to a single "Open test
    // case" action.
    expect(
      screen.getByRole("menuitem", { name: "Open test case" }),
    ).toBeInTheDocument();
    // No catalog models resolve here, so the models action is present but disabled.
    expect(screen.getByRole("menuitem", { name: "Open model" })).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: "Copy links" }),
    ).toBeInTheDocument();
    // canExecute is false in this harness, so neither destructive batch action
    // appears.
    expect(screen.queryByRole("menuitem", { name: /^Kill/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Delete/ })).toBeNull();

    // The single-run menu is gone: the checked selection drives the menu instead.
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
  });

  it("keeps the single-run menu when nothing is checked", () => {
    renderSelectable();
    fireEvent.contextMenu(screen.getAllByRole("link")[0]!);
    // With an empty selection a right-click is still the per-run menu.
    expect(
      screen.getByRole("menuitem", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copy links" })).toBeNull();
  });

  it("locks the last visible column so the table can't be emptied", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));

    // Hide every default-visible column but one; the survivor's box then locks.
    for (const label of [
      "TEST",
      "HARNESS",
      "VARIANT",
      "MODEL",
      "TOKENS",
      "COST",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    const survivor = screen.getByRole("checkbox", { name: "RATING" });
    expect(survivor).toBeDisabled();

    // A hidden column can still be re-shown, which unlocks the survivor again.
    fireEvent.click(screen.getByRole("checkbox", { name: "COST" }));
    expect(screen.getByRole("checkbox", { name: "RATING" })).not.toBeDisabled();
  });
});

describe("sortStateToQuery", () => {
  it("defaults to date/desc for no sort", () => {
    expect(sortStateToQuery(null)).toEqual({ sort: "date", dir: "desc" });
  });

  it("maps run columns to their server sort keys, carrying direction", () => {
    expect(sortStateToQuery({ columnId: "test", direction: "asc" })).toEqual({
      sort: "testCase",
      dir: "asc",
    });
    expect(
      sortStateToQuery({ columnId: "timestamp", direction: "desc" }),
    ).toEqual({ sort: "date", dir: "desc" });
    expect(
      sortStateToQuery({ columnId: "duration", direction: "asc" }),
    ).toEqual({
      sort: "runtime",
      dir: "asc",
    });
    expect(
      sortStateToQuery({ columnId: "category", direction: "desc" }),
    ).toEqual({ sort: "testType", dir: "desc" });
  });

  it("falls back to date/desc for a column with no server key", () => {
    // VERSION has no server-side sort; the header still highlights, the query
    // falls back to the default order.
    expect(sortStateToQuery({ columnId: "version", direction: "asc" })).toEqual(
      {
        sort: "date",
        dir: "desc",
      },
    );
  });
});
