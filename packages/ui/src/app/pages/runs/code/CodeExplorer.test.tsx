import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolchainCoverage } from "@clockwyrks/run-record";
import type {
  CodeAnalysisDocument,
  CodeFileEntry,
  CodeSymbolEntry,
} from "@clockwyrks/run-record/code-analysis";
import { CodeExplorer } from "./CodeExplorer";
import { CodeCyclesCallout } from "./CodeCyclesCallout";

function file(path: string, over: Partial<CodeFileEntry> = {}): CodeFileEntry {
  return {
    path,
    language: "typeScript",
    bytes: 1000,
    codeLines: 100,
    commentLines: 5,
    blankLines: 5,
    functions: 4,
    cyclomatic: 12,
    cognitive: 8,
    fanOut: 1,
    fanIn: 1,
    isTest: false,
    ...over,
  };
}

function symbol(over: Partial<CodeSymbolEntry> = {}): CodeSymbolEntry {
  return {
    file: 0,
    name: "step",
    line: 10,
    lines: 20,
    cyclomatic: 5,
    cognitive: 4,
    maxNesting: 2,
    parameters: 1,
    exits: 1,
    exported: false,
    ...over,
  };
}

const FILES = [
  file("src/game/loop.ts", { codeLines: 300, functions: 6 }),
  file("src/game/draw.ts", { codeLines: 90 }),
  file("src/main.ts", { codeLines: 40 }),
  file("assets/data.json", {
    language: undefined,
    codeLines: 5,
    functions: 0,
    cyclomatic: 0,
    sizeOnlyReason: "over-parse-cap",
  }),
];

const DOCUMENT = {
  analyzerVersion: 1,
  summary: {} as CodeAnalysisDocument["summary"],
  files: FILES,
  symbols: [
    symbol({ file: 0, name: "resolveCollision", cyclomatic: 41, line: 12 }),
    symbol({
      file: 0,
      name: "render",
      cyclomatic: 9,
      line: 80,
      exported: true,
      references: 3,
    }),
    symbol({ file: 1, name: "draw", cyclomatic: 6, line: 4 }),
    symbol({ file: 2, name: "boot", cyclomatic: 2, line: 1 }),
  ],
  imports: [],
  cycles: [],
  clones: [],
} as unknown as CodeAnalysisDocument;

describe("CodeExplorer", () => {
  it("opens on the produced tree and lists its children with rolled-up figures", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    expect(
      screen.getByText("Everything in the produced tree"),
    ).toBeInTheDocument();
    const src = screen.getByRole("button", { name: "src/" });
    const row = src.closest("tr")!;
    // src holds three files and 430 code lines between them.
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("430")).toBeInTheDocument();
  });

  // The map is the explorer: the point of drawing a directory as a rectangle is that
  // the rectangle is the way into it.
  it("drills into a directory from the map and back from the breadcrumb", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    fireEvent.click(screen.getByRole("button", { name: /^src: directory/ }));
    expect(screen.getByText("Inside src")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Produced tree" }));
    expect(
      screen.getByText("Everything in the produced tree"),
    ).toBeInTheDocument();
  });

  it("drills in from the child table too", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "src/" }));
    // `src/game` is the collapsed run of the single-child chain below it.
    expect(screen.getByRole("button", { name: "game/" })).toBeInTheDocument();
  });

  // A file the analyzer counted but never parsed contributes size and nothing else,
  // which is a fact about the measurement rather than about the file's size.
  it("marks a file that was counted but never parsed", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    fireEvent.click(screen.getByRole("button", { name: "assets/" }));
    expect(screen.getByText("size only")).toBeInTheDocument();
  });

  it("scopes the symbol table to the selection", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    expect(
      screen.getByText("4 functions in the produced tree"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "src/" }));
    fireEvent.click(screen.getByRole("button", { name: "game/" }));
    expect(screen.getByText("3 functions in src/game")).toBeInTheDocument();
    expect(screen.queryByText("boot")).toBeNull();
  });

  // R11, on the surface it matters most: the per-symbol reference count is the least
  // reliable figure the analyzer produces, and the header says so — reading the flag
  // from the catalog rather than asserting it here.
  it("marks the reference column as approximate and explains the marker", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    const header = screen.getByRole("button", { name: /Refs/ });
    expect(header).toHaveTextContent("~");
    expect(
      screen.getByText(/dynamic imports, path aliases and bundler rewrites/i),
    ).toBeInTheDocument();
  });

  // "Not measured" is not "zero": a non-exported function's references are not
  // attributed across files at all.
  it("shows an absent reference count as absent, never as zero", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    const row = screen.getByText("resolveCollision").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    const exported = screen.getByText("render").closest("tr")!;
    expect(within(exported).getByText("3")).toBeInTheDocument();
  });

  it("sorts the symbol table by the column that was clicked", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("th")?.textContent ?? "");
    // Worst-first by cyclomatic complexity, by default.
    expect(names().some((n) => n.startsWith("resolveCollision"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Cyclomatic/ }));
    // A second click on the active column flips it: the least complex function first.
    const flipped = names().filter((n) => n.length > 0);
    expect(flipped[flipped.length - 1]!.startsWith("resolveCollision")).toBe(
      true,
    );
  });
});

// Executed coverage, joined onto the same per-file spine the table already walks. The
// join is by repo-relative path — which is exactly why the record stores it that way —
// and the two asymmetries it has to survive are both real: a file with no coverage row
// (`coverage.include` names `src/**/*.ts`, so assets and tests are legitimately absent)
// and a coverage row for a file the analysis never listed.
describe("CodeExplorer, joined to executed coverage", () => {
  const COVERAGE = {
    totals: {} as ToolchainCoverage["totals"],
    files: [
      {
        path: "src/game/loop.ts",
        lines: { covered: 30, total: 100 },
        statements: { covered: 30, total: 100 },
        functions: { covered: 2, total: 6 },
        branches: { covered: 1, total: 4 },
      },
      {
        path: "src/game/draw.ts",
        lines: { covered: 10, total: 20 },
        statements: { covered: 10, total: 20 },
        functions: { covered: 1, total: 4 },
        branches: { covered: 0, total: 0 },
      },
    ],
    filesMeasured: 2,
    filesTruncated: false,
  } satisfies ToolchainCoverage;

  // Every run recorded before the report-file contract carries none, and the table on
  // those runs must be exactly what it always was — not a column of em dashes.
  it("draws no coverage column at all when the run measured none", () => {
    render(<CodeExplorer document={DOCUMENT} />);
    expect(screen.queryByRole("columnheader", { name: "Line cov" })).toBeNull();
  });

  // Counts add; percentages do not. `src` holds 40 of 120 covered lines across two
  // measured files — 33.3% — while the mean of its files' percentages is 40%.
  it("sums a directory's coverage rather than averaging its files'", () => {
    render(<CodeExplorer document={DOCUMENT} coverage={COVERAGE} />);
    const src = screen.getByRole("button", { name: "src/" }).closest("tr")!;
    expect(within(src).getByText("33.3%")).toBeInTheDocument();
  });

  // Unmeasured is not uncovered. `assets/` holds one JSON file the reporter never
  // instrumented, and reporting it at 0% would read as a directory whose tests reached
  // nothing.
  it("shows a directory the reporter never measured as an em dash", () => {
    render(<CodeExplorer document={DOCUMENT} coverage={COVERAGE} />);
    const assets = screen
      .getByRole("button", { name: "assets/" })
      .closest("tr")!;
    // The last cell is the coverage one. The row carries other em dashes (a directory
    // has no import figures of its own), so it is identified by position rather than by
    // the glyph.
    const cells = within(assets).getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent("—");
  });

  // Drilling to a single file gives up the table for the file facts, which is where the
  // other three metrics live — the ones a line percentage alone would hide.
  it("gives one file all four metrics", () => {
    render(<CodeExplorer document={DOCUMENT} coverage={COVERAGE} />);
    fireEvent.click(screen.getByRole("button", { name: "src/" }));
    fireEvent.click(screen.getByRole("button", { name: "game/" }));
    fireEvent.click(screen.getByRole("button", { name: "loop.ts" }));
    const fact = screen.getByText(/Reached by the model/).closest("div")!;
    expect(fact).toHaveTextContent(
      "lines 30.0% · statements 30.0% · functions 33.3% · branches 25.0%",
    );
  });

  // The authorship counterpart of the coverage column: aggregated per directory by
  // `codeTree` since it shipped, and rendered nowhere until now.
  it("counts the test files under each entry", () => {
    render(
      <CodeExplorer
        document={
          {
            ...DOCUMENT,
            files: [...FILES, file("src/game/loop.test.ts", { isTest: true })],
          } as unknown as CodeAnalysisDocument
        }
      />,
    );
    const src = screen.getByRole("button", { name: "src/" }).closest("tr")!;
    const cells = within(src).getAllByRole("cell");
    // Files, then test files: four under `src`, one of them a test.
    expect(cells[0]).toHaveTextContent("4");
    expect(cells[1]).toHaveTextContent("1");
  });
});

describe("CodeCyclesCallout", () => {
  it("says so when there are none — a finding in its own right", () => {
    render(<CodeCyclesCallout document={DOCUMENT} />);
    expect(screen.getByText(/No import cycles/i)).toBeInTheDocument();
  });

  it("names the members of each cycle", () => {
    const withCycles = {
      ...DOCUMENT,
      cycles: [[0, 1]],
    } as unknown as CodeAnalysisDocument;
    render(<CodeCyclesCallout document={withCycles} />);
    expect(screen.getByText("1 import cycle")).toBeInTheDocument();
    expect(
      screen.getByText("src/game/loop.ts → src/game/draw.ts"),
    ).toBeInTheDocument();
  });
});
