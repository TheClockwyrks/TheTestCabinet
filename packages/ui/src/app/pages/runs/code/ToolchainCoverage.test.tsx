// The executed coverage widget, rendered.
//
// The ranking's order is read off the drawn y-axis rather than off the array behind it,
// for the reason `CodeOutliers.test.tsx` gives: a component that built the right array and
// handed it to a chart that sorted it the other way would satisfy any assertion made
// against the array and fail this one. The rest is the tab's standing honesty rules —
// four metrics rather than one number, counts beside every percentage, and an em dash for
// a metric with nothing to measure.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  CoverageFile,
  ToolchainCoverage as ToolchainCoverageRecord,
} from "@test-cabinet/run-record";
import { ToolchainCoverage } from "./ToolchainCoverage";

function file(path: string, lines: [number, number]): CoverageFile {
  return {
    path,
    lines: { covered: lines[0], total: lines[1] },
    statements: { covered: lines[0], total: lines[1] },
    functions: { covered: 1, total: 2 },
    branches: { covered: 0, total: 0 },
  };
}

function coverage(
  over: Partial<ToolchainCoverageRecord> = {},
): ToolchainCoverageRecord {
  return {
    totals: {
      lines: { covered: 62, total: 100, pct: 62 },
      statements: { covered: 70, total: 100, pct: 70 },
      functions: { covered: 8, total: 10, pct: 80 },
      branches: { covered: 0, total: 0 },
    },
    files: [file("src/game.ts", [50, 80]), file("src/hud.ts", [12, 20])],
    filesMeasured: 2,
    filesTruncated: false,
    ...over,
  };
}

/** The category labels of the drawn ranking, in the order the band scale draws them. */
function bandLabels(container: HTMLElement): string[] {
  const axis = container.querySelector('[aria-label="y-axis tick label"]');
  return [...(axis?.querySelectorAll("text") ?? [])].map(
    (text) => text.textContent ?? "",
  );
}

describe("ToolchainCoverage", () => {
  // Four metrics, not one headline number: a suite that calls every function once and
  // takes no `else` reads well on lines and badly on branches, and one figure would report
  // only whichever the reader happened to be shown.
  it("shows all four istanbul metrics with the counts behind them", () => {
    render(<ToolchainCoverage coverage={coverage()} />);
    for (const label of ["Lines", "Statements", "Functions", "Branches"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("62.0%")).toBeInTheDocument();
    expect(screen.getByText(/62 of 100 executable lines/)).toBeInTheDocument();
  });

  // A metric with a zero total is not a zero-percent metric. The tab's standing rule, and
  // the one a reviewer would misread as "this build tested none of its branches".
  it("renders a metric with nothing to measure as an em dash, never as zero", () => {
    render(<ToolchainCoverage coverage={coverage()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/0 of 0 each arm of an if/)).toBeInTheDocument();
  });

  it("ranks the least covered file first, off the drawn axis", () => {
    const { container } = render(
      <ToolchainCoverage
        coverage={coverage({
          files: [
            file("src/well-tested.ts", [95, 100]),
            file("src/barely.ts", [5, 100]),
            file("src/middling.ts", [50, 100]),
            // No executable lines at all: unmeasurable, so it is not a zero-percent
            // file and must not head the ranking.
            file("src/empty.ts", [0, 0]),
          ],
          filesMeasured: 4,
        })}
      />,
    );
    expect(bandLabels(container)).toEqual([
      "src/barely.ts",
      "src/middling.ts",
      "src/well-tested.ts",
    ]);
  });

  // The chart's table-view twin: every file the ranking encodes as a bar is also a row of
  // numbers, including the one the ranking had to drop.
  it("lists every measured file with its four figures", () => {
    render(<ToolchainCoverage coverage={coverage()} />);
    // Scoped to the table: the path is also a category label on the chart above it,
    // which is the point of the twin.
    const row = screen
      .getByRole("rowheader", { name: "src/hud.ts" })
      .closest("tr")!;
    expect(within(row).getAllByText("60.0%").length).toBe(2);
    expect(within(row).getByText("50.0%")).toBeInTheDocument();
    expect(within(row).getAllByText("12/20").length).toBeGreaterThan(0);
  });

  it("says when the per-file list was capped", () => {
    render(
      <ToolchainCoverage
        coverage={coverage({ filesMeasured: 140, filesTruncated: true })}
      />,
    );
    expect(
      screen.getByText(/per-file list was capped at 2 of 140/),
    ).toBeInTheDocument();
  });
});
