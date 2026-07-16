import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HarnessErrorRingWidget } from "./HarnessErrorRingWidget";

describe("HarnessErrorRingWidget", () => {
  it("shows an empty state and no gauge when the model has no runs", () => {
    render(
      <HarnessErrorRingWidget
        title="Harness errors"
        harnessErrors={0}
        totalRuns={0}
      />,
    );
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a rounded whole-percent share and the raw tally", () => {
    render(
      <HarnessErrorRingWidget
        title="Harness errors"
        harnessErrors={3}
        totalRuns={12}
      />,
    );
    // 3/12 = 25%.
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("3 of 12 runs")).toBeInTheDocument();
  });

  it("floors a rare-but-present error at <1% rather than rounding it away", () => {
    render(
      <HarnessErrorRingWidget
        title="Harness errors"
        harnessErrors={1}
        totalRuns={500}
      />,
    );
    // 0.2% must not round to "0%" — that would hide a real harness error.
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });

  it("shows a clean 0% (and no value arc) when a model has runs but no errors", () => {
    const { container } = render(
      <HarnessErrorRingWidget
        title="Harness errors"
        harnessErrors={0}
        totalRuns={40}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("0 of 40 runs")).toBeInTheDocument();
    // Only the track circle is drawn — no value arc when the share is zero.
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("uses the singular 'run' for a lone run", () => {
    render(
      <HarnessErrorRingWidget
        title="Harness errors"
        harnessErrors={1}
        totalRuns={1}
      />,
    );
    expect(screen.getByText("1 of 1 run")).toBeInTheDocument();
  });
});
