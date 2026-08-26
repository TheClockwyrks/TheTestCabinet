import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  CodeAnalysisDocument,
  CodeFileEntry,
  CodeSymbolEntry,
} from "@test-cabinet/run-record/code-analysis";
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
