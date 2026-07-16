import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  PerformanceCaseResult,
  PerformanceResult,
} from "@test-cabinet/run-record";
import { PerformanceResultBody } from "./PerformanceResultSection";

function scenarioCase(
  overrides: Partial<PerformanceCaseResult> = {},
): PerformanceCaseResult {
  return {
    input: "cases/small.json",
    correct: true,
    fuel: 1_234_567,
    firstMismatchTick: null,
    detail: null,
    ...overrides,
  };
}

function result(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return {
    correct: true,
    totalFuel: 3_210_000,
    cases: [scenarioCase()],
    detail: null,
    ...overrides,
  };
}

describe("PerformanceResultBody", () => {
  it("shows the fuel score and per-scenario fuel for a correct run", () => {
    render(
      <PerformanceResultBody
        result={result({
          totalFuel: 3_210_000,
          cases: [
            scenarioCase({ input: "cases/small.json", fuel: 1_000_000 }),
            scenarioCase({ input: "cases/large.json", fuel: 2_210_000 }),
          ],
        })}
      />,
    );
    // The correctness gate reads as a pass, and the total-fuel score is shown in
    // full precision (it is the comparable result, so it is not abbreviated).
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("3,210,000")).toBeInTheDocument();
    // Each held-out scenario appears with its own fuel figure.
    expect(screen.getByText("2,210,000")).toBeInTheDocument();
    expect(
      screen.getByText(
        /all 2 held-out scenarios reproduced the reference oracle/,
      ),
    ).toBeInTheDocument();
  });

  it("withholds the fuel score for an incorrect run and shows the divergence", () => {
    render(
      <PerformanceResultBody
        result={result({
          correct: false,
          // A wrong engine has no comparable fuel: the total is unknown even
          // though a per-case fuel figure was still recorded for diagnostics.
          totalFuel: null,
          cases: [
            scenarioCase({ input: "cases/small.json", correct: true }),
            scenarioCase({
              input: "cases/large.json",
              correct: false,
              fuel: 4_000_000,
              firstMismatchTick: 150_000,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Fail")).toBeInTheDocument();
    // The aggregate is all-or-nothing, so the headline names the tally (not a bare
    // "Fail") — here 1 of the 2 scenarios reproduced the reference state.
    expect(
      screen.getByText(/1 of 2 scenarios reproduced the reference state/),
    ).toBeInTheDocument();
    // The diverging scenario points at the first snapshot tick that mismatched.
    expect(
      screen.getByText(/first mismatch at tick 150,000/),
    ).toBeInTheDocument();
  });

  it("surfaces a run-level detail when the run could not be scored", () => {
    render(
      <PerformanceResultBody
        result={result({
          correct: false,
          totalFuel: null,
          cases: [],
          detail: "the submission did not export the `simulate` entry",
        })}
      />,
    );
    expect(
      screen.getByText(/did not export the .simulate. entry/),
    ).toBeInTheDocument();
  });

  it("renders an unrunnable scenario's fuel as an em dash", () => {
    render(
      <PerformanceResultBody
        result={result({
          correct: false,
          totalFuel: null,
          cases: [
            scenarioCase({
              input: "cases/large.json",
              correct: false,
              fuel: null,
              detail: "host failure: fuel limit exceeded",
            }),
          ],
        })}
      />,
    );
    const row = screen.getByText("cases/large.json").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(
      within(row).getByText(/host failure: fuel limit exceeded/),
    ).toBeInTheDocument();
  });
});
