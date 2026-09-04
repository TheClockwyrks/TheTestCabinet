import { describe, expect, it } from "vitest";
import type { CoverageFile, ToolchainCoverage } from "@test-cabinet/run-record";
import type { CodeFileEntry } from "@test-cabinet/run-record/code-analysis";
import {
  coveragePercent,
  formatCoveragePercent,
  indexCoverage,
  rollUpCoverage,
} from "./coverageJoin";

function covered(path: string, lines: [number, number]): CoverageFile {
  const metric = { covered: lines[0], total: lines[1] };
  return {
    path,
    lines: metric,
    statements: metric,
    functions: metric,
    branches: metric,
  };
}

function analysed(path: string): CodeFileEntry {
  return {
    path,
    language: "typeScript",
    bytes: 100,
    codeLines: 10,
    commentLines: 0,
    blankLines: 0,
    functions: 1,
    cyclomatic: 1,
    cognitive: 1,
    fanOut: 0,
    fanIn: 0,
    isTest: false,
  };
}

describe("coveragePercent", () => {
  // The rule the whole tab hangs on: a zero total is an absence, not a zero percent. A
  // file with no branches has not failed to cover its branches.
  it("reports nothing to measure as nothing, never as zero", () => {
    expect(coveragePercent({ covered: 0, total: 0 })).toBeNull();
    expect(coveragePercent({ covered: 0, total: 0, pct: 0 })).toBeNull();
  });

  // Istanbul's own figure wins, so a stored percentage and the report it came from cannot
  // disagree by a rounding rule.
  it("prefers the figure istanbul reported", () => {
    expect(coveragePercent({ covered: 1, total: 3, pct: 33.33 })).toBe(33.33);
  });

  // The record leaves `pct` absent where istanbul declined to state one (it writes the
  // string "Unknown"), and a rollup has no `pct` at all because it was summed rather than
  // reported. Both fall through to the same arithmetic istanbul does.
  it("derives the percentage when the report stated none", () => {
    expect(coveragePercent({ covered: 3, total: 4 })).toBe(75);
  });

  it("renders an unmeasured metric as an em dash", () => {
    expect(formatCoveragePercent(null)).toBe("—");
    expect(formatCoveragePercent(62.14)).toBe("62.1%");
  });
});

describe("rollUpCoverage", () => {
  const files = [
    analysed("src/game.ts"),
    analysed("src/hud.ts"),
    analysed("assets/data.json"),
  ];
  const index = indexCoverage({
    totals: {} as ToolchainCoverage["totals"],
    files: [covered("src/game.ts", [30, 100]), covered("src/hud.ts", [10, 20])],
    filesMeasured: 2,
    filesTruncated: false,
  });

  // Counts add; percentages do not. Averaging 30% and 50% would report 40% for a
  // directory whose tests actually reached 40 of its 120 lines — a coincidence here, so
  // the fixture is chosen to make the two answers differ: 40/120 is 33.3%, the mean is
  // 40%.
  it("sums the counts rather than averaging the percentages", () => {
    const rollup = rollUpCoverage([0, 1], files, index);
    expect(rollup.lines).toEqual({ covered: 40, total: 120 });
    expect(coveragePercent(rollup.lines)).toBeCloseTo(33.33, 1);
    expect(rollup.measuredFiles).toBe(2);
  });

  // `coverage.include` names `src/**/*.ts`, so every asset, config and test file in the
  // tree is legitimately absent from the report. Unmeasured is not uncovered.
  it("skips a file the reporter never measured, and says how many it did", () => {
    const rollup = rollUpCoverage([2], files, index);
    expect(rollup.measuredFiles).toBe(0);
    expect(coveragePercent(rollup.lines)).toBeNull();
  });

  it("reports nothing for a run that measured nothing", () => {
    const empty = indexCoverage(null);
    expect(empty.size).toBe(0);
    expect(rollUpCoverage([0, 1, 2], files, empty).measuredFiles).toBe(0);
  });
});
