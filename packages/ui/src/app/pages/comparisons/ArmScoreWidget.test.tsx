import type { ComparisonArmResult } from "@clockwyrks/run-record/comparison";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArmScoreWidget } from "./ArmScoreWidget";

/** An arm with three scored runs out of 24 points, one of them full. */
function scored(id: string, label: string): ComparisonArmResult {
  return {
    arm: { id, label },
    nDesired: 3,
    nObserved: 3,
    runIds: ["r1", "r2", "r3"],
    inFlight: 0,
    score: {
      n: 3,
      meanFraction: 0.75,
      points: [
        { earned: 24, total: 24 },
        { earned: 18, total: 24 },
        { earned: 12, total: 24 },
      ],
    },
    passRate: {
      n: 3,
      passed: 1,
      rate: 1 / 3,
      wilsonLow: 0.06,
      wilsonHigh: 0.79,
    },
  } as unknown as ComparisonArmResult;
}

/** An arm none of whose runs have landed. */
function bare(id: string, label: string): ComparisonArmResult {
  return {
    arm: { id, label },
    nDesired: 3,
    nObserved: 0,
    runIds: [],
    inFlight: 2,
  } as unknown as ComparisonArmResult;
}

const COLORS = new Map([
  ["pi", "rgb(10, 20, 30)"],
  ["kilo", "rgb(40, 50, 60)"],
]);

function renderWidget(arms: readonly ComparisonArmResult[]) {
  render(<ArmScoreWidget arms={arms} colorForArm={COLORS} />);
}

const rowFor = (label: string) =>
  screen.getByRole("button", { name: new RegExp(label) });

/** An arm with the given average score and pass rate. */
function rated(id: string, meanFraction: number, rate: number) {
  const arm = scored(id, id);
  return {
    ...arm,
    score: { ...arm.score!, meanFraction },
    passRate: { ...arm.passRate!, rate },
  } as ComparisonArmResult;
}

/** The arms' detail ids in the order the table shows their rows. */
const rowOrder = () =>
  screen
    .getAllByRole("button", { expanded: false })
    .map((row) => row.getAttribute("aria-controls"));

describe("ArmScoreWidget", () => {
  afterEach(() => localStorage.clear());

  it("shows each arm as a closed row with its average score and passed count", () => {
    renderWidget([scored("pi", "pi"), bare("kilo", "kilo")]);
    const pi = rowFor("pi");
    expect(pi).toHaveAttribute("aria-expanded", "false");
    expect(pi).toHaveTextContent("75%");
    expect(pi).toHaveTextContent("1/3");
    expect(pi).toHaveTextContent("33%");
    // An arm with nothing landed says so rather than showing a zero.
    expect(rowFor("kilo")).toHaveTextContent("—");
    expect(screen.getByText("Wilson 95%: 6%–79%")).not.toBeVisible();
  });

  it("opens a row onto its pass-rate interval and a column per run, keeping its figures", () => {
    renderWidget([scored("pi", "pi")]);
    fireEvent.click(rowFor("pi"));
    const pi = rowFor("pi");
    expect(pi).toHaveAttribute("aria-expanded", "true");
    expect(pi).toHaveTextContent("75%");
    const detail = document.getElementById(pi.getAttribute("aria-controls")!)!;
    expect(detail).toBeVisible();
    expect(within(detail).getByText("Wilson 95%: 6%–79%")).toBeInTheDocument();
    expect(within(detail).getByText("n=3 of 3 desired")).toBeInTheDocument();
    expect(within(detail).getByText("avg 75%")).toBeInTheDocument();
    const runs = within(detail).getAllByLabelText(/^run \d+:/);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toHaveAccessibleName("run 1: 24 of 24 points");
    expect(runs[0]!.className).not.toBe(runs[1]!.className);
  });

  it("says what an open arm without runs is still waiting on", () => {
    renderWidget([bare("kilo", "kilo")]);
    fireEvent.click(rowFor("kilo"));
    expect(
      screen.getByText("n=0 of 3 desired · 2 still in flight"),
    ).toBeInTheDocument();
    expect(screen.getByText("No pass-rate data yet.")).toBeInTheDocument();
    expect(screen.getByText("No scored runs yet.")).toBeInTheDocument();
  });

  it("opens and closes every row at once", () => {
    renderWidget([scored("pi", "pi"), bare("kilo", "kilo")]);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(rowFor("pi")).toHaveAttribute("aria-expanded", "true");
    expect(rowFor("kilo")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(rowFor("pi")).toHaveAttribute("aria-expanded", "false");
    expect(rowFor("kilo")).toHaveAttribute("aria-expanded", "false");
  });

  it("sorts the arms by average score and by pass rate, blanks last", () => {
    renderWidget([
      rated("a", 0.5, 0.9),
      rated("b", 0.9, 0.1),
      bare("c", "c"),
      rated("d", 0.2, 0.5),
    ]);
    const ids = (...names: string[]) => names.map((n) => `arm-score-${n}`);
    expect(rowOrder()).toEqual(ids("a", "b", "c", "d"));

    const byScore = screen.getByRole("button", { name: "Sort by Avg score" });
    fireEvent.click(byScore);
    expect(rowOrder()).toEqual(ids("d", "a", "b", "c"));
    fireEvent.click(byScore);
    expect(rowOrder()).toEqual(ids("b", "a", "d", "c"));
    expect(
      screen.getByRole("columnheader", { name: /Avg score/ }),
    ).toHaveAttribute("aria-sort", "descending");
    // A third click returns the arms to the comparison's own order.
    fireEvent.click(byScore);
    expect(rowOrder()).toEqual(ids("a", "b", "c", "d"));

    fireEvent.click(screen.getByRole("button", { name: "Sort by Passed" }));
    expect(rowOrder()).toEqual(ids("b", "d", "a", "c"));
  });
});
