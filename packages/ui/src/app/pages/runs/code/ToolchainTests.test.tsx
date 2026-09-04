// The executed test widget, rendered.
//
// Three properties are load-bearing and none is visible in a count, so all three are
// asserted off the drawn output rather than off the data behind it:
//
// - **A suite that ran nothing is not a suite that passed.** The runner reports
//   `success: true, total: 0` for a build that shipped no tests, and a widget that only
//   said "passed" would turn the single most damning result on the page into a green one.
// - **`total` counts a skipped test, so it cannot be the number after the word "passed".**
//   A build whose tests are all `it.skip` exits 0 with a `total` in the dozens, and one
//   that skips half of itself exits 0 with `passed` well under `total`. Both are asserted
//   here because the counters are right in the record and the sentence is the only place
//   left where they can be misread — which is exactly what `ToolchainTestFile::skipped`
//   exists to prevent.
// - **A red invocation with no failing test is a real state.** A test file that cannot be
//   loaded fails the run while failing no assertion, so "0 failed" and "failed" appear
//   together and the widget has to explain that rather than look broken.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolchainTests as ToolchainTestsRecord } from "@test-cabinet/run-record";
import { ToolchainTests } from "./ToolchainTests";

function tests(over: Partial<ToolchainTestsRecord> = {}): ToolchainTestsRecord {
  return {
    total: 12,
    passed: 12,
    failed: 0,
    skipped: 0,
    filesRun: 2,
    filesFailed: 0,
    succeeded: true,
    files: [
      { path: "src/game.test.ts", passed: 8, failed: 0, skipped: 0 },
      { path: "src/hud.test.ts", passed: 4, failed: 0, skipped: 0 },
    ],
    filesTruncated: false,
    failures: [],
    failuresTruncated: false,
    ...over,
  };
}

describe("ToolchainTests", () => {
  it("states the totals and every test file the runner loaded", () => {
    render(<ToolchainTests tests={tests()} />);
    expect(screen.getByText(/The suite passed — 12 tests/)).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    const row = screen.getByText("src/game.test.ts").closest("tr")!;
    expect(within(row).getByText("8")).toBeInTheDocument();
  });

  // The result a summary is most likely to flatter: the runner succeeded because there
  // was nothing to fail.
  it("does not call an empty suite a passing one", () => {
    render(
      <ToolchainTests
        tests={tests({
          total: 0,
          passed: 0,
          filesRun: 0,
          files: [],
        })}
      />,
    );
    expect(screen.getByText(/found no tests/i)).toBeInTheDocument();
    expect(screen.queryByText(/suite passed/i)).toBeNull();
    // Still a reported figure, so it renders as a zero rather than as an em dash.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  // Vitest exits 0 on a suite that declined every one of its tests, so `succeeded` and a
  // healthy `total` say nothing about whether an assertion was evaluated.
  it("does not call an all-skipped suite a passing one", () => {
    render(
      <ToolchainTests
        tests={tests({
          passed: 0,
          skipped: 12,
          files: [
            { path: "src/game.test.ts", passed: 0, failed: 0, skipped: 8 },
            { path: "src/hud.test.ts", passed: 0, failed: 0, skipped: 4 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/No test ran — 12 of 12 skipped/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/suite passed/i)).toBeNull();
  });

  // The half-skipped suite the record's own contract names: it must not read as a suite
  // that passed all of itself.
  it("states how much of a partly skipped suite actually passed", () => {
    render(
      <ToolchainTests
        tests={tests({
          passed: 6,
          skipped: 6,
          files: [
            { path: "src/game.test.ts", passed: 6, failed: 0, skipped: 2 },
            { path: "src/hud.test.ts", passed: 0, failed: 0, skipped: 4 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/The suite passed — 6 of 12 tests/),
    ).toBeInTheDocument();
    expect(screen.getByText(/6 skipped/)).toBeInTheDocument();
    expect(screen.queryByText(/passed — 12 tests/)).toBeNull();
  });

  it("names the failures, with the assertion that explains each", () => {
    render(
      <ToolchainTests
        tests={tests({
          passed: 10,
          failed: 2,
          filesFailed: 1,
          succeeded: false,
          files: [
            { path: "src/game.test.ts", passed: 6, failed: 2, skipped: 0 },
            { path: "src/hud.test.ts", passed: 4, failed: 0, skipped: 0 },
          ],
          failures: [
            {
              file: "src/game.test.ts",
              name: "engine > advances the clock",
              message: "expected 3 to be 4",
            },
            { file: "src/game.test.ts", name: "engine > resets" },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/The suite failed — 2 of 12 tests/),
    ).toBeInTheDocument();
    expect(screen.getByText("engine > advances the clock")).toBeInTheDocument();
    expect(screen.getByText("expected 3 to be 4")).toBeInTheDocument();
    // A failure the reporter gave no message for still gets its row.
    expect(screen.getByText("engine > resets")).toBeInTheDocument();
  });

  // A file that could not be loaded fails the invocation without failing an assertion.
  it("explains a failed run that carries no failing test", () => {
    render(
      <ToolchainTests
        tests={tests({
          total: 0,
          passed: 0,
          filesRun: 1,
          filesFailed: 1,
          succeeded: false,
          files: [
            {
              path: "src/game.test.ts",
              passed: 0,
              failed: 0,
              skipped: 0,
              message: "Cannot find module './engine'",
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(/failed with no failing test/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cannot find module './engine'"),
    ).toBeInTheDocument();
  });

  // The counts above a capped list are the whole suite's, so the page has to say the list
  // is not.
  it("says when a list was capped", () => {
    render(
      <ToolchainTests
        tests={tests({
          failed: 40,
          succeeded: false,
          filesTruncated: true,
          failuresTruncated: true,
          failures: [{ file: "src/game.test.ts", name: "first" }],
        })}
      />,
    );
    expect(screen.getByText(/per-file list was capped/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Showing the first 1 of 40 failures/),
    ).toBeInTheDocument();
  });
});
