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
  opts: {
    tokens?: number;
    model?: string;
    harness?: string;
    ggPreset?: string | null;
  } = {},
): RunSummary {
  const {
    tokens = 100,
    model = "anthropic/claude",
    harness = "claude",
    ggPreset = null,
  } = opts;
  return {
    id,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:00Z",
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: harness,
      harnessVersion: "1",
      modelId: model,
      ggPreset,
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
      "ENGINE",
      "MODEL / CONFIG",
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

// The MODEL / CONFIG cell carries whichever identity actually distinguishes a run:
// a third-party-harness run is its model, a gg run is the configuration it was
// launched from (its models are per-agent bindings, so no single harness model
// names it). One listing routinely holds both kinds of row.
describe("RunLog model/config cell", () => {
  beforeEach(() => localStorage.clear());

  function renderRuns(runs: RunSummary[]) {
    function MixedHarness() {
      const table = useRunTable({
        runs,
        localIds: new Set(),
        localWriteups: {},
        externalOrder: true,
      });
      return <RunLog rows={table.rows} controls={table.controls} />;
    }
    return render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue()}>
          <MixedHarness />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
  }

  // The rendered MODEL / CONFIG cells, in DOM order, as `<label>:<value>` — the
  // label is the caption the phone card shows, and it must name whichever of the
  // two identities the cell actually carries.
  function modelCells(container: HTMLElement): string[] {
    return [
      ...container.querySelectorAll(
        '[data-label="Model"],[data-label="Config"]',
      ),
    ].map((cell) => `${cell.getAttribute("data-label")}:${cell.textContent}`);
  }

  it("shows the configuration for a gg row and the model for every other row", () => {
    const { container } = renderRuns([
      summary("r-gg", "alpha", {
        harness: "gg",
        model: "sonnet-9",
        ggPreset: "planning-A",
      }),
      summary("r-claude", "beta", { model: "opus-5" }),
    ]);
    expect(modelCells(container)).toEqual([
      "Config:planning-A",
      "Model:opus-5",
    ]);
  });

  it("falls back to the model for a gg row with no recorded configuration", () => {
    // A hand-assembled set (or a run produced before the card carried the name)
    // has no configuration to show; the cell must not go blank.
    const { container } = renderRuns([
      summary("r-gg", "alpha", { harness: "gg", model: "sonnet-9" }),
    ]);
    expect(modelCells(container)).toEqual(["Model:sonnet-9"]);
  });

  it("labels the column for both identities", () => {
    renderRuns(RUNS);
    expect(
      screen.getByRole("button", { name: "Sort by MODEL / CONFIG" }),
    ).toBeInTheDocument();
  });
});

describe("RunLog code cell", () => {
  beforeEach(() => localStorage.clear());

  function renderWithCodeColumn(runs: RunSummary[]) {
    function CodeHarness() {
      const table = useRunTable({
        runs,
        localIds: new Set(),
        localWriteups: {},
        externalOrder: true,
      });
      return <RunLog rows={table.rows} controls={table.controls} />;
    }
    const rendered = render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue()}>
          <CodeHarness />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    // The column starts hidden: with an un-backfilled corpus a default-on CODE column
    // is a column of dashes, so it lives in the picker.
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CODE" }));
    return rendered;
  }

  function codeCell(container: HTMLElement): HTMLElement {
    const cell = container.querySelector('[data-label="Code"]');
    if (!(cell instanceof HTMLElement))
      throw new Error("no CODE cell rendered");
    return cell;
  }

  // The card's whole reason for existing: an ordering over the analysed corpus without
  // fetching a single run record.
  it("renders the code figure lifted onto the summary card", () => {
    const run = summary("r-code", "alpha");
    run.code = {
      analyzerVersion: 2,
      authoredBasis: "seedCommit",
      treeBasis: "preValidation",
      truncated: false,
      codeLines: 1250,
      giniCodeLines: 0.42,
      meanCognitive: 3.1,
    };
    const { container } = renderWithCodeColumn([run]);
    const cell = codeCell(container);
    expect(cell.textContent).toBe("1,250");
    expect(cell.getAttribute("title")).toContain("analyzer v2");
    expect(cell.getAttribute("title")).not.toContain("truncated");
  });

  // R5, and the reason this step exists at all. Analysis is deliberately not
  // backfilled, so most of the corpus has no figure — and a cell that read as a zero
  // would turn "we never measured this" into "this model wrote no code", which is a
  // different and false claim about the model.
  it("says an unanalysed run was not measured rather than showing a zero", () => {
    const { container } = renderWithCodeColumn([summary("r-none", "alpha")]);
    const cell = codeCell(container);
    expect(cell.textContent).toBe("—");
    expect(cell.getAttribute("title")).toMatch(/not measured/i);
    expect(cell.getAttribute("title")).toMatch(/not backfilled/i);
    expect(cell.getAttribute("title")).toMatch(/not a claim/i);
  });

  // Two analysed runs are not automatically comparable. A figure measured over the
  // whole tree counts code the run was *given*; one measured after validation counts
  // build output; a truncated one stopped short. The cell marks each rather than
  // presenting all of them as the same number.
  it("marks a figure whose basis makes it incomparable", () => {
    const run = summary("r-loose", "alpha");
    run.code = {
      analyzerVersion: 2,
      authoredBasis: "allFiles",
      treeBasis: "postValidation",
      truncated: true,
      codeLines: 90000,
      giniCodeLines: 0.9,
      meanCognitive: 12,
    };
    const { container } = renderWithCodeColumn([run]);
    const cell = codeCell(container);
    expect(cell.textContent).toBe("90,000*");
    const title = cell.getAttribute("title") ?? "";
    expect(title).toContain("seeded files included");
    expect(title).toContain("after validation");
    expect(title).toContain("truncated");
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
