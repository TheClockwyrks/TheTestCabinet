import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ReliabilityRingWidget,
  type ReliabilitySegment,
} from "./ReliabilityRingWidget";

function segments(
  completed: number,
  harnessErrors: number,
  timeouts: number,
): ReliabilitySegment[] {
  return [
    { label: "Completed", value: completed, tone: "success" },
    { label: "Harness errors", value: harnessErrors, tone: "harnessError" },
    { label: "Timeouts", value: timeouts, tone: "timeout" },
  ];
}

describe("ReliabilityRingWidget", () => {
  it("shows an empty state and no gauge when the model has no runs", () => {
    render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(0, 0, 0)}
        totalRuns={0}
      />,
    );
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the total and each outcome's tally and rounded share", () => {
    render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(9, 2, 1)}
        totalRuns={12}
      />,
    );
    // The center shows the denominator.
    expect(screen.getByText("12")).toBeInTheDocument();
    // Each legend row shows "<count> · <percent>" (2/12 ≈ 17%, 1/12 ≈ 8%).
    expect(screen.getByText("9 · 75%")).toBeInTheDocument();
    expect(screen.getByText("2 · 17%")).toBeInTheDocument();
    expect(screen.getByText("1 · 8%")).toBeInTheDocument();
  });

  it("draws one arc per non-zero segment, plus the track", () => {
    const { container } = render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(9, 2, 1)}
        totalRuns={12}
      />,
    );
    // Track + three value arcs (all three segments are non-zero).
    expect(container.querySelectorAll("circle")).toHaveLength(4);
  });

  it("omits the arc for a zero segment but still lists it in the legend", () => {
    const { container } = render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(40, 0, 0)}
        totalRuns={40}
      />,
    );
    // Only the completed arc is drawn (track + one arc); the zero failure tiers
    // add no invisible stroke.
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    // Yet the legend still reports both zero tiers at 0%, so neither is hidden.
    expect(screen.getAllByText("0 · 0%")).toHaveLength(2);
    expect(screen.getByText("Timeouts")).toBeInTheDocument();
  });

  it("floors a rare-but-present outcome at <1% rather than rounding it away", () => {
    render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(499, 0, 1)}
        totalRuns={500}
      />,
    );
    // 1/500 = 0.2% must not round to "0%" — that would hide a real timeout.
    expect(screen.getByText("1 · <1%")).toBeInTheDocument();
  });

  it("uses the singular 'run' label for a lone run", () => {
    render(
      <ReliabilityRingWidget
        title="Run outcomes"
        segments={segments(1, 0, 0)}
        totalRuns={1}
      />,
    );
    expect(screen.getByText("run")).toBeInTheDocument();
  });
});
