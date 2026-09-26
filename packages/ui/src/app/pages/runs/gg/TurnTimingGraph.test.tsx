import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  formatMs,
  MAX_BARS,
  axisTicks,
  offeredSizes,
  PHASES,
  tooltipFor,
  TurnTimingGraph,
  windowOf,
  WINDOW_SIZES,
} from "./TurnTimingGraph";
import type { TurnTiming } from "./useGgRunState";

const [PROMPT_PHASE, REQUEST_PHASE, RESPONSE_PHASE] = PHASES;

function timing(turn: number, promptMs = 10, requestMs = 100, responseMs = 40) {
  return { turn, promptMs, requestMs, responseMs } satisfies TurnTiming;
}

// A run of `n` turns, numbered from 0 as gg numbers them.
function run(n: number): TurnTiming[] {
  return Array.from({ length: n }, (_, i) => timing(i));
}

describe("formatMs", () => {
  it("keeps sub-second durations in whole milliseconds", () => {
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(937.4)).toBe("937 ms");
  });

  it("reads seconds with one decimal, so adjacent bars stay distinguishable", () => {
    expect(formatMs(1000)).toBe("1.0 s");
    expect(formatMs(4235)).toBe("4.2 s");
  });

  it("reads past a minute as m:ss", () => {
    expect(formatMs(60_000)).toBe("1m 00s");
    expect(formatMs(154_000)).toBe("2m 34s");
  });

  it("carries a rounded 60s into the minute rather than rendering 60", () => {
    // 119.6s must not read as "1m 60s".
    expect(formatMs(119_600)).toBe("2m 00s");
  });
});

describe("tooltipFor", () => {
  const t = timing(7, 250, 4000, 750);

  it("shows the whole bar's raw figures, not just the hovered band", () => {
    const tip = tooltipFor(t, REQUEST_PHASE!);
    expect(tip).toContain("Turn 7");
    expect(tip).toContain("5.0 s total");
    expect(tip).toContain("Prompt construction: 250 ms");
    expect(tip).toContain("Request: 4.0 s");
    expect(tip).toContain("Response processing: 750 ms");
  });

  it("marks which band the pointer is on", () => {
    const tip = tooltipFor(t, RESPONSE_PHASE!);
    expect(tip).toContain("▸ Response processing");
    expect(tip).not.toContain("▸ Request");
  });

  it("reports each phase's share of the turn", () => {
    const tip = tooltipFor(timing(1, 250, 500, 250), PROMPT_PHASE!);
    expect(tip).toContain("(25%)");
    expect(tip).toContain("(50%)");
  });

  it("omits shares for a turn too short to have any", () => {
    // Every phase floors to 0ms; a share would be NaN, which is worse than none.
    const tip = tooltipFor(timing(3, 0, 0, 0), PROMPT_PHASE!);
    expect(tip).toContain("Prompt construction: 0 ms");
    expect(tip).not.toContain("%");
  });
});

describe("windowOf", () => {
  it("follows the newest turns when no frame has been chosen", () => {
    const { slice, start } = windowOf(run(120), 50, null);
    expect(start).toBe(70);
    expect(slice.map((t) => t.turn)).toEqual(
      [...Array(50).keys()].map((i) => i + 70),
    );
  });

  it("never draws more than the cap, however long the run", () => {
    const { slice } = windowOf(run(5000), MAX_BARS, null);
    expect(slice).toHaveLength(MAX_BARS);
    expect(MAX_BARS).toBe(Math.max(...WINDOW_SIZES));
  });

  it("clamps a frame that the run has outgrown or not yet grown into", () => {
    // A frame parked at turn 90 stays valid when the size control widens under it.
    expect(windowOf(run(100), 50, 90).start).toBe(50);
    // ...and when the run is shorter than where the frame was left.
    expect(windowOf(run(20), 10, 500).start).toBe(10);
    expect(windowOf(run(20), 10, -5).start).toBe(0);
  });

  it("shows the whole run when it fits in the frame", () => {
    const { slice, start, maxStart } = windowOf(run(8), 50, null);
    expect(slice).toHaveLength(8);
    expect([start, maxStart]).toEqual([0, 0]);
  });
});

describe("offeredSizes", () => {
  it("offers only sizes that frame more of the run than the one below", () => {
    // 25 already frames all 15 turns, so a 50 that draws the identical graph is a
    // control that does nothing.
    expect(offeredSizes(15)).toEqual([10, 25]);
    expect(offeredSizes(30)).toEqual([10, 25, 50]);
    expect(offeredSizes(500)).toEqual([10, 25, 50]);
  });

  it("always offers the smallest, so a short run can still zoom in", () => {
    expect(offeredSizes(0)).toEqual([10]);
    expect(offeredSizes(3)).toEqual([10]);
  });
});

describe("axisTicks", () => {
  const labels = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => String(i + from));

  it("labels every bar while they fit", () => {
    expect(axisTicks(labels(12))).toEqual(labels(12));
  });

  it("thins to a stride once there are more bars than room", () => {
    const ticks = axisTicks(labels(50, 70));
    expect(ticks.length).toBeLessThanOrEqual(12);
    // An even stride, so the axis reads as a scale rather than an arbitrary sample.
    const gaps = ticks.slice(1).map((t, i) => Number(t) - Number(ticks[i]!));
    expect(new Set(gaps).size).toBe(1);
  });

  it("always labels the newest turn, which is the one a live reader looks for", () => {
    for (const n of [13, 37, 50]) {
      const ticks = axisTicks(labels(n, 70));
      expect(ticks[ticks.length - 1]).toBe(String(70 + n - 1));
    }
  });
});

describe("TurnTimingGraph", () => {
  it("says so plainly when the run recorded no timings", () => {
    render(<TurnTimingGraph timings={[]} />);
    expect(screen.getByText(/Not recorded for this run/)).toBeInTheDocument();
  });

  it("draws every turn, with no frame controls, when they all fit", () => {
    render(<TurnTimingGraph timings={run(6)} />);
    expect(screen.getByText("6 turns")).toBeInTheDocument();
    expect(screen.queryByLabelText("First turn shown")).not.toBeInTheDocument();
  });

  it("frames the newest turns and says which it is showing", () => {
    render(<TurnTimingGraph timings={run(120)} />);
    expect(screen.getByText("turns 70–119 of 120")).toBeInTheDocument();
  });

  it("moves the frame a whole page at a time", () => {
    render(<TurnTimingGraph timings={run(120)} />);

    fireEvent.click(screen.getByLabelText("Show earlier turns"));
    expect(screen.getByText("turns 20–69 of 120")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show later turns"));
    expect(screen.getByText("turns 70–119 of 120")).toBeInTheDocument();
  });

  it("stops the frame at either end of the run", () => {
    render(<TurnTimingGraph timings={run(120)} />);

    // Already following the newest turn, so there is nowhere later to go.
    expect(screen.getByLabelText("Show later turns")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Show earlier turns"));
    fireEvent.click(screen.getByLabelText("Show earlier turns"));
    expect(screen.getByText("turns 0–49 of 120")).toBeInTheDocument();
    expect(screen.getByLabelText("Show earlier turns")).toBeDisabled();
  });

  it("narrows the frame on request, keeping the newest turns in view", () => {
    render(<TurnTimingGraph timings={run(120)} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } });
    expect(screen.getByText("turns 110–119 of 120")).toBeInTheDocument();
  });

  it("keeps following the newest turn as a live run grows", () => {
    const { rerender } = render(<TurnTimingGraph timings={run(60)} />);
    expect(screen.getByText("turns 10–59 of 60")).toBeInTheDocument();
    rerender(<TurnTimingGraph timings={run(75)} />);
    expect(screen.getByText("turns 25–74 of 75")).toBeInTheDocument();
  });

  it("leaves a reader who moved back where they put themselves", () => {
    const { rerender } = render(<TurnTimingGraph timings={run(60)} />);
    fireEvent.click(screen.getByLabelText("Show earlier turns"));
    expect(screen.getByText("turns 0–49 of 60")).toBeInTheDocument();

    // New turns arrive; the frame must not be dragged off what they were reading.
    rerender(<TurnTimingGraph timings={run(75)} />);
    expect(screen.getByText("turns 0–49 of 75")).toBeInTheDocument();
  });
});
