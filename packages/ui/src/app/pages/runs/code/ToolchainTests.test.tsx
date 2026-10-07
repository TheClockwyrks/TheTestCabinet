// The executed test widget, rendered.
//
// Four properties are load-bearing and none is visible in a count, so all four are
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
// - **Most stored runs predate the per-test list.** A record with no `tests` array must
//   render as the counts and failures it does carry, never as a suite that ran nothing.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ToolchainTest,
  ToolchainTests as ToolchainTestsRecord,
} from "@clockwyrks/run-record";
import { ToolchainTests } from "./ToolchainTests";
import { VIRTUALIZE_ABOVE } from "./ToolchainTestList";

function test(over: Partial<ToolchainTest> = {}): ToolchainTest {
  return {
    file: "src/game.test.ts",
    name: "engine > advances the clock",
    status: "passed",
    durationMs: 4,
    ...over,
  };
}

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
    tests: [test(), test({ name: "hud > draws", file: "src/hud.test.ts" })],
    testsTruncated: false,
    ...over,
  };
}

/** A record from before the contract carried a per-test list, which is most of the
 * stored corpus: the field is simply absent, whatever the generated type promises. */
function legacy(
  over: Partial<ToolchainTestsRecord> = {},
): ToolchainTestsRecord {
  const record = tests(over) as Partial<ToolchainTestsRecord>;
  delete record.tests;
  delete record.testsTruncated;
  return record as ToolchainTestsRecord;
}

describe("ToolchainTests", () => {
  it("states the totals and the suite's verdict", () => {
    render(<ToolchainTests tests={tests()} />);
    expect(screen.getByText(/The suite passed — 12 tests/)).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Across 2 test files.")).toBeInTheDocument();
  });

  // The per-file table the list supersedes: the tests themselves say which file they came
  // from, so the counts-per-file grid is gone.
  it("no longer draws a table of every test file the runner loaded", () => {
    const { container } = render(<ToolchainTests tests={tests()} />);
    expect(screen.queryByText(/Every test file the runner loaded/)).toBeNull();
    expect(container.querySelector("table")).toBeNull();
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
          tests: [],
        })}
      />,
    );
    expect(screen.getByText(/ran no tests/i)).toBeInTheDocument();
    expect(screen.queryByText(/suite passed/i)).toBeNull();
    // Still a reported figure, so it renders as a zero rather than as an em dash.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // Zero tests is not a legacy record, and must not be described as one.
    expect(screen.queryByText(/Per-test detail was not recorded/i)).toBeNull();
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
          tests: [test({ status: "skipped", durationMs: undefined })],
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
          tests: [],
        })}
      />,
    );
    expect(
      screen.getByText(/failed with no failing test/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 of 1 test file failed to load/),
    ).toBeInTheDocument();
    // The file-level message is the only account the run has of itself, so it survives
    // the per-file table it used to live in.
    expect(
      screen.getByText("Cannot find module './engine'"),
    ).toBeInTheDocument();
  });

  // The three caps the record carries are independent of each other, and the per-file
  // one is the only one whose list this widget draws a card for conditionally: the card
  // exists only when a file failed to load. A green suite of four hundred files is
  // capped at two hundred rows and has no card — and the flag is precisely the statement
  // that a file which failed to load may be sitting past the cap, unlisted.
  it("says the per-file list was capped even when no listed file failed to load", () => {
    render(
      <ToolchainTests
        tests={tests({
          filesRun: 400,
          filesTruncated: true,
        })}
      />,
    );
    // No card, because no file the record kept carries a load error.
    expect(
      screen.queryByRole("heading", { name: /failed to load/ }),
    ).toBeNull();
    expect(
      screen.getByText(
        /per-file list was capped at 2 of 400 test files, so a file that failed to load may not be listed/,
      ),
    ).toBeInTheDocument();
  });

  it("says the per-file list was capped alongside the files that did fail to load", () => {
    render(
      <ToolchainTests
        tests={tests({
          total: 0,
          passed: 0,
          filesRun: 400,
          filesFailed: 200,
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
          filesTruncated: true,
          tests: [],
        })}
      />,
    );
    expect(screen.getByText(/1 test file failed to load/)).toBeInTheDocument();
    expect(
      screen.getByText(/per-file list was capped at 1 of 400 test files/),
    ).toBeInTheDocument();
  });

  it("leaves the per-file cap unsaid when the list was not capped", () => {
    render(<ToolchainTests tests={tests()} />);
    expect(screen.queryByText(/per-file list was capped/)).toBeNull();
  });
});

// The disclosure: the verdict is the summary, and the recorded tests are the body.
describe("ToolchainTests, the recorded tests", () => {
  const FAILING = tests({
    passed: 10,
    failed: 2,
    filesFailed: 1,
    succeeded: false,
    failures: [
      {
        file: "src/game.test.ts",
        name: "engine > advances the clock",
        message: "expected 3 to be 4",
      },
      { file: "src/game.test.ts", name: "engine > resets" },
    ],
    tests: [
      test({ status: "failed", durationMs: 1500 }),
      test({ name: "engine > resets", status: "failed" }),
      test({ name: "hud > draws", file: "src/hud.test.ts" }),
      test({
        name: "hud > hides",
        file: "src/hud.test.ts",
        status: "skipped",
        durationMs: undefined,
      }),
    ],
  });

  it("folds the tests away behind the verdict on a green suite", () => {
    render(<ToolchainTests tests={tests()} />);
    const toggle = screen.getByRole("button", { name: /The suite passed/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/2 recorded/)).toBeInTheDocument();
    expect(screen.queryByText("hud > draws")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("hud > draws")).toBeInTheDocument();
    expect(screen.getByText("src/hud.test.ts")).toBeInTheDocument();
    expect(screen.getAllByText("4 ms")).toHaveLength(2);
  });

  // The reason anyone opens this, so it opens itself — and on the failures.
  it("opens on the failing tests when the suite failed", () => {
    render(<ToolchainTests tests={FAILING} />);
    expect(
      screen.getByRole("button", { name: /The suite failed/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("engine > resets")).toBeInTheDocument();
    // The failing test's own recorded message, on its row.
    expect(screen.getByText("expected 3 to be 4")).toBeInTheDocument();
    expect(screen.getByText("1.5 s")).toBeInTheDocument();
    // Filtered to the failures, so the passing rows are not drawn.
    expect(screen.queryByText("hud > draws")).toBeNull();
  });

  it("shows every status when the filter is moved off the failures", () => {
    render(<ToolchainTests tests={FAILING} />);
    fireEvent.click(screen.getByRole("radio", { name: "All 4" }));
    expect(screen.getByText("hud > draws")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Skipped 1" }));
    expect(screen.getByText("hud > hides")).toBeInTheDocument();
    expect(screen.queryByText("hud > draws")).toBeNull();
  });

  // Absence of a duration is "not timed", never zero.
  it("renders an untimed test as untimed rather than as zero", () => {
    render(
      <ToolchainTests
        tests={tests({
          tests: [test({ name: "engine > never ran", durationMs: undefined })],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /suite passed/ }));
    const row = screen
      .getByText("engine > never ran")
      .closest("[role='listitem']") as HTMLElement;
    expect(within(row).getByLabelText("Not timed")).toBeInTheDocument();
    expect(within(row).queryByText(/0 ms/)).toBeNull();
  });

  // A capped list must not imply a smaller suite than the counts above it describe.
  it("says the list was capped and that the counts are the whole suite's", () => {
    render(
      <ToolchainTests
        tests={tests({
          total: 2400,
          passed: 2400,
          tests: [test(), test({ name: "second" })],
          testsTruncated: true,
        })}
      />,
    );
    expect(screen.getByText(/2 of 2,400 recorded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /suite passed/ }));
    expect(
      screen.getByText(/List capped at 2 of 2,400 tests/),
    ).toBeInTheDocument();
    // The headline still counts the whole suite.
    expect(
      screen.getByText(/The suite passed — 2,400 tests/),
    ).toBeInTheDocument();
  });

  // A failure the capped list dropped keeps its message rather than losing it.
  it("keeps a failure whose test the capped list dropped", () => {
    render(
      <ToolchainTests
        tests={tests({
          failed: 40,
          passed: 0,
          succeeded: false,
          failuresTruncated: true,
          testsTruncated: true,
          failures: [
            {
              file: "src/other.test.ts",
              name: "not in the list",
              message: "expected true to be false",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("What failed")).toBeInTheDocument();
    expect(screen.getByText("not in the list")).toBeInTheDocument();
    expect(
      screen.getByText(/Messages recorded for the first 1 of 40 failures/),
    ).toBeInTheDocument();
    // And the card carrying that dropped failure says the failure list it comes from was
    // capped, in its own right — the disclosure that carries the other statement of the
    // cap collapses, and this card does not.
    expect(
      screen.getByText(/Detail was kept for the first 1 of 40 failures/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /suite failed/ }));
    expect(
      screen.queryByText(/Messages recorded for the first 1 of 40 failures/),
    ).toBeNull();
    expect(
      screen.getByText(/Detail was kept for the first 1 of 40 failures/),
    ).toBeInTheDocument();
  });

  // A thousand rows is the cap the record carries, and the list virtualizes rather than
  // putting every one of them in the DOM.
  it("virtualizes a list past the threshold", () => {
    const many = Array.from({ length: VIRTUALIZE_ABOVE + 40 }, (_, index) =>
      test({ name: `case ${index}` }),
    );
    const { container } = render(
      <ToolchainTests
        tests={tests({ total: many.length, passed: many.length, tests: many })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /suite passed/ }));
    // The virtualized form is the one react-virtuoso drives — its rows carry the
    // library's own index attribute, which the plain stack has no equivalent of.
    expect(container.querySelector("[data-index]")).not.toBeNull();
    expect(screen.getByText("case 0")).toBeInTheDocument();
  });

  it("draws a short list without a scroller of its own", () => {
    const { container } = render(<ToolchainTests tests={tests()} />);
    fireEvent.click(screen.getByRole("button", { name: /suite passed/ }));
    expect(container.querySelector("[data-index]")).toBeNull();
    expect(screen.getByText("hud > draws")).toBeInTheDocument();
  });
});

describe("ToolchainTests, a record recorded before the per-test list", () => {
  it("renders the counts and failures it does carry, and discloses nothing", () => {
    render(
      <ToolchainTests
        tests={legacy({
          passed: 10,
          failed: 2,
          filesFailed: 1,
          succeeded: false,
          failures: [
            {
              file: "src/game.test.ts",
              name: "engine > advances the clock",
              message: "expected 3 to be 4",
            },
          ],
          failuresTruncated: true,
        })}
      />,
    );
    expect(
      screen.getByText(/The suite failed — 2 of 12 tests/),
    ).toBeInTheDocument();
    expect(screen.getByText("engine > advances the clock")).toBeInTheDocument();
    expect(screen.getByText("expected 3 to be 4")).toBeInTheDocument();
    expect(
      screen.getByText(/Showing the first 1 of 2 failures/),
    ).toBeInTheDocument();
    // No disclosure at all — there is nothing recorded to disclose.
    expect(
      screen.queryByRole("button", { name: /The suite failed/ }),
    ).toBeNull();
    // And it is never described as a suite that ran nothing.
    expect(
      screen.getByText(/Per-test detail was not recorded for this run/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ran no tests/i)).toBeNull();
  });
});
