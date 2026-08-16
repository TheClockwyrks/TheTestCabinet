import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TopUpResult } from "@test-cabinet/run-record/coverage";
import type {
  LadderCell,
  LadderClimber,
  LadderOut,
  LadderProgress,
  LadderProgressRung,
  LadderRungOutcome,
  RungTally,
} from "@test-cabinet/run-record/ladders";
import type { BackendClient } from "../../../client/clients";
import {
  sectionReturnTo,
  useRecordSectionIndex,
} from "../../components/backReturn";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import {
  ClimberRow,
  buildRungViews,
  climberStatusLabel,
  describeLadderHalt,
  describeLadderTopUp,
  describeTally,
  ladderStatusNote,
  topUpLaddersAfterReview,
} from "./LadderPage";

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function rung(
  position: number,
  over: Partial<LadderProgressRung> = {},
): LadderProgressRung {
  return {
    id: `r${position}`,
    position,
    slug: `case-${position}`,
    version: "v1.0.0",
    variant: "base",
    latestVersion: "v1.0.0",
    stale: false,
    ...over,
  };
}

function tally(over: Partial<RungTally> = {}): RungTally {
  return {
    completed: 3,
    judged: 2,
    unjudged: 1,
    passing: 1,
    pending: 2,
    required: 2,
    ...over,
  };
}

function cell(over: Partial<LadderCell> = {}): LadderCell {
  return {
    rungId: "r1",
    position: 1,
    tally: tally(),
    outcome: "undecided",
    slug: "case-1",
    version: "v1.0.0",
    variant: "base",
    harness: "claude",
    model: "opus",
    desired: 5,
    completed: 3,
    inFlight: 2,
    pending: 1,
    unreviewed: 1,
    remaining: 0,
    latestVersion: "v1.0.0",
    stale: false,
    ...over,
  } as LadderCell;
}

function outcome(over: Partial<LadderRungOutcome> = {}): LadderRungOutcome {
  return {
    rungId: "r0",
    decidedVersion: "v1.0.0",
    outcome: "advanced",
    effective: "advanced",
    decidedAt: "2026-08-15T00:00:00Z",
    stale: false,
    recorded: true,
    ...over,
  };
}

function climber(over: Partial<LadderClimber> = {}): LadderClimber {
  return {
    key: "claude|opus",
    harness: "claude",
    model: "opus",
    priority: 0,
    focused: false,
    held: false,
    status: "climbing",
    currentRung: cell(),
    outcomes: [outcome()],
    ...over,
  } as LadderClimber;
}

function progress(over: Partial<LadderProgress> = {}): LadderProgress {
  return {
    ladderId: "l1",
    outerAxis: "rung",
    rungs: [rung(0), rung(1), rung(2)],
    climbers: [climber()],
    climbersToppedOut: 0,
    climbersWalled: 0,
    runsMissing: 4,
    runsUnreviewed: 1,
    runsOutstanding: 3,
    bufferTarget: 10,
    ...over,
  };
}

// "Walled" alone is the same sentence for a model that fell at the first case and one
// that cleared six, and telling those two apart is the reason to run a ladder at all —
// so the rung number is part of every stopped state's label.
describe("climberStatusLabel", () => {
  it("names the rung a walled climber stopped on, counting from one", () => {
    expect(
      climberStatusLabel(
        climber({ status: "walled", currentRung: cell({ position: 2 }) }),
        3,
      ),
    ).toBe("Walled at rung 3");
  });

  it("says a rung is waiting on the reviewer rather than merely stopped", () => {
    expect(
      climberStatusLabel(climber({ status: "awaitingReview" }), 3),
    ).toMatch(/waiting on your review/i);
  });

  it("distinguishes a hold from a wall", () => {
    expect(climberStatusLabel(climber({ status: "held" }), 3)).toBe(
      "Held at rung 2",
    );
  });

  it("reports a climber still working as climbing, out of the whole ladder", () => {
    expect(climberStatusLabel(climber(), 3)).toBe("Climbing rung 2 of 3");
  });

  it("reports a topped-out climber as having cleared every rung", () => {
    expect(
      climberStatusLabel(
        climber({ status: "toppedOut", currentRung: undefined }),
        3,
      ),
    ).toBe("Topped out — all 3 rungs cleared");
  });
});

// The wire delivers verdicts as a flat list with superseded ones trailing; the page
// reads them per rung, so the pairing happens once and in one place.
describe("buildRungViews", () => {
  it("attaches each verdict to its rung and flags the current one", () => {
    const views = buildRungViews(climber(), [rung(0), rung(1), rung(2)]);
    expect(views.map((v) => v.outcome?.effective ?? null)).toEqual([
      "advanced",
      null,
      null,
    ]);
    expect(views.map((v) => v.current)).toEqual([false, true, false]);
    expect(views[1]!.tally).not.toBeNull();
  });

  it("keeps verdicts decided against a superseded version as history only", () => {
    const views = buildRungViews(
      climber({
        outcomes: [
          outcome({ rungId: "r0", decidedVersion: "v0.9.0", stale: true }),
        ],
      }),
      [rung(0), rung(1), rung(2)],
    );
    // Nothing governs rung 0: the only verdict on it was earned against a version it
    // no longer pins.
    expect(views[0]!.outcome).toBeNull();
    expect(views[0]!.history).toHaveLength(1);
  });

  it("marks the rungs above the climber as not reached", () => {
    const views = buildRungViews(climber(), [rung(0), rung(1), rung(2)]);
    expect(views.map((v) => v.reached)).toEqual([true, true, false]);
  });
});

// The evidence sentence has to carry every number a disagreement could be about:
// what is still to come is the ladder's problem, what is unjudged is the reviewer's.
describe("describeTally", () => {
  it("states the runs in, the bar, and who each shortfall belongs to", () => {
    const text = describeTally(tally());
    expect(text).toMatch(/3 runs in/);
    expect(text).toMatch(/1 of 2 judged clear the bar \(2 needed\)/);
    expect(text).toMatch(/1 waiting on your review/);
    expect(text).toMatch(/2 still to run/);
  });

  it("leaves out the parts that are not happening", () => {
    const text = describeTally(tally({ unjudged: 0, pending: 0 }));
    expect(text).not.toMatch(/waiting on your review/);
    expect(text).not.toMatch(/still to run/);
  });
});

// Every top-up outcome has to read differently, and a ladder has one a plan does not:
// nothing to enqueue because every climber has stopped, which is an answer rather than
// a satisfied target.
describe("describeLadderTopUp", () => {
  function result(over: Partial<TopUpResult> = {}): TopUpResult {
    return { bufferTarget: 5, enqueued: 0, cells: [], ...over };
  }

  it("names a paused ladder as paused rather than as idle", () => {
    expect(describeLadderTopUp(result({ skipped: "paused" }))).toMatch(
      /paused/i,
    );
  });

  it("says a concurrent top-up already ran, so nothing enqueued twice", () => {
    expect(describeLadderTopUp(result({ skipped: "busy" }))).toMatch(
      /already/i,
    );
  });

  it("reports what it enqueued, in runs and rungs", () => {
    const message = describeLadderTopUp(
      result({
        enqueued: 6,
        outstanding: 6,
        cells: [{ runs: 3 }, { runs: 3 }] as TopUpResult["cells"],
      }),
    );
    expect(message).toMatch(/6 runs/);
    expect(message).toMatch(/2 rungs/);
  });

  it("tells a full buffer apart from a ladder that has finished climbing", () => {
    expect(
      describeLadderTopUp(result({ outstanding: 5, bufferTarget: 5 })),
    ).toMatch(/buffer is full/i);
    expect(
      describeLadderTopUp(result({ outstanding: 1, bufferTarget: 5 })),
    ).toMatch(/walled, held, or topped out/i);
  });
});

// A halt that only reports success cannot be told apart from a halt whose scope was
// wrong, so the count — including zero — is always stated.
describe("describeLadderHalt", () => {
  it("reports the count and the scope", () => {
    expect(describeLadderHalt({ canceled: 4, includedActive: false })).toMatch(
      /canceled 4 jobs that had not started/,
    );
    expect(describeLadderHalt({ canceled: 1, includedActive: true })).toMatch(
      /canceled 1 job including runs already executing/,
    );
  });

  it("says explicitly that nothing was found rather than succeeding silently", () => {
    expect(describeLadderHalt({ canceled: 0, includedActive: false })).toMatch(
      /no jobs of this ladder were waiting/i,
    );
  });
});

// An idle ladder is either paused, waiting on the reviewer, or finished — and the last
// of those is a result, not a fault.
describe("ladderStatusNote", () => {
  it("explains a pause before anything else", () => {
    const note = ladderStatusNote(progress(), true);
    expect(note).toMatch(/paused/i);
    expect(note).toMatch(/already queued is untouched/i);
  });

  it("reads a board with nobody climbing as an answer, not a stall", () => {
    const note = ladderStatusNote(
      progress({
        climbers: [
          climber({ status: "walled" }),
          climber({ key: "codex|gpt", status: "toppedOut" }),
        ],
        climbersWalled: 1,
        climbersToppedOut: 1,
      }),
      false,
    );
    expect(note).toMatch(/nobody is climbing/i);
    expect(note).toMatch(/answered its question/i);
  });

  it("explains a full review buffer as waiting on you", () => {
    const note = ladderStatusNote(
      progress({ runsOutstanding: 5, bufferTarget: 5 }),
      false,
    );
    expect(note).toMatch(/5 of 5/);
    expect(note).toMatch(/your review/i);
  });

  it("stays quiet when the ladder is simply climbing", () => {
    expect(ladderStatusNote(progress(), false)).toBeNull();
  });
});

// The board's row is the feature: collapsed it must already answer "where is the wall
// for this model", and expanded it must show the evidence and the controls to disagree.
describe("ClimberRow", () => {
  function renderRow(
    over: Partial<LadderClimber> = {},
    rungs: LadderProgressRung[] = [rung(0), rung(1), rung(2)],
  ) {
    const onSteer = vi.fn();
    const onOverride = vi.fn();
    const onBump = vi.fn();
    render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue()}>
          <ClimberRow
            climber={climber(over)}
            rungs={rungs}
            busy={false}
            onSteer={onSteer}
            onOverride={onOverride}
            onBump={onBump}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    return { onSteer, onOverride, onBump };
  }

  it("answers where the wall is without being expanded", () => {
    renderRow({ status: "walled", currentRung: cell({ position: 1 }) });
    expect(screen.getByText("Walled at rung 2")).toBeTruthy();
    expect(screen.getByText("1/3 rungs")).toBeTruthy();
    // The per-rung detail is what expanding adds.
    expect(screen.queryByText(/1 of 2 judged/)).toBeNull();
  });

  it("expands to the per-rung verdicts and their evidence", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("advanced")).toBeTruthy();
    expect(screen.getByText("not decided yet")).toBeTruthy();
    expect(screen.getByText(/1 of 2 judged clear the bar/)).toBeTruthy();
    // A rung above the climber is still listed — the rungs ahead are what the climb
    // is for.
    expect(screen.getByText("not reached")).toBeTruthy();
  });

  it("links a reached rung to that combination's runs at the pinned version", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const href =
      screen.getAllByRole("link", { name: "Runs" })[0]?.getAttribute("href") ??
      "";
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("case")).toBe("case-0");
    expect(params.get("harness")).toBe("claude");
    expect(params.get("model")).toBe("opus");
    // A rung pins an exact version, which the listing's "current versions only"
    // default would otherwise filter away.
    expect(params.get("latest")).toBe("0");
  });

  it("offers a promotion only where there is a verdict to promote past", () => {
    renderRow({
      status: "walled",
      currentRung: cell({ rungId: "r1", position: 1, outcome: "wall" }),
      outcomes: [
        outcome(),
        outcome({ rungId: "r1", outcome: "walled", effective: "walled" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Rung 0 advanced, rung 1 walled, rung 2 has no verdict at all.
    expect(screen.getAllByText("Promote anyway")).toHaveLength(1);
    expect(screen.getAllByText("Wall here")).toHaveLength(1);
  });

  it("says when a verdict is a hand override, and what the gate itself said", () => {
    const { onOverride } = renderRow({
      outcomes: [
        outcome({
          outcome: "walled",
          overrideOutcome: "advanced",
          effective: "advanced",
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/by hand \(the gate said walled\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("Clear override"));
    expect(onOverride).toHaveBeenCalledWith(expect.anything(), "r0", null);
  });

  it("flags a live verdict as not yet written down, because a read never writes", () => {
    renderRow({ outcomes: [outcome({ recorded: false })] });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/not written down yet/)).toBeTruthy();
  });

  it("offers a bump only where the rung's pin has actually aged", () => {
    const stale = rung(0, { latestVersion: "v1.1.0", stale: true });
    const { onBump } = renderRow({}, [stale, rung(1), rung(2)]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const bump = screen.getByRole("button", { name: /v1\.0\.0 → v1\.1\.0/ });
    fireEvent.click(bump);
    expect(onBump).toHaveBeenCalledWith(stale);
    // The rungs whose pins are current offer nothing to bump.
    expect(screen.getAllByRole("button", { name: /→/ })).toHaveLength(1);
  });

  it("carries a climber's other steering when one field is changed", () => {
    const { onSteer } = renderRow({ priority: 3, focused: true });
    fireEvent.click(screen.getByRole("button", { name: /^Hold$/ }));
    expect(onSteer).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 3, focused: true }),
      { held: true },
    );
  });

  it("toggles the focus flag from the star", () => {
    const { onSteer } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: /^Watch opus$/ }));
    expect(onSteer).toHaveBeenCalledWith(expect.anything(), { focused: true });
  });

  it("releases a held climber rather than offering to hold it again", () => {
    const { onSteer } = renderRow({ held: true, status: "held" });
    fireEvent.click(screen.getByRole("button", { name: /^Release$/ }));
    expect(onSteer).toHaveBeenCalledWith(expect.anything(), { held: false });
  });
});

// The review loop: a rung's runs must open with a return to the ladder behind them, or
// reviewing walks away from the board it was launched from.
describe("the ladder's back-return", () => {
  function Dashboard() {
    useRecordSectionIndex("coverage");
    return (
      <ClimberRow
        climber={climber()}
        rungs={[rung(0), rung(1), rung(2)]}
        busy={false}
        onSteer={vi.fn()}
        onOverride={vi.fn()}
        onBump={vi.fn()}
      />
    );
  }

  it("hands a run's back control a return to the ladder it was opened from", () => {
    render(
      <MemoryRouter initialEntries={["/account/ladders/l1"]}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route path="/account/ladders/:ladderId" element={<Dashboard />} />
            <Route path="/runs" element={<p>the runs</p>} />
          </Routes>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    expect(sectionReturnTo("runs", "/runs")).toBe("/runs");
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("link", { name: "Runs" })[0]!);
    expect(screen.getByText("the runs")).toBeTruthy();
    expect(sectionReturnTo("runs", "/runs")).toBe("/account/ladders/l1");
  });
});

// A submitted review is the moment that frees a buffer slot — and on a ladder it is
// also the verdict itself, so it is the one thing most likely to have unblocked a
// climber. Only ladders that asked are touched.
describe("topUpLaddersAfterReview", () => {
  function entry(over: Partial<LadderOut>): LadderOut {
    return {
      id: "l1",
      name: "ladder",
      runsPerCell: 3,
      gate: {
        floor: "scuffed",
        threshold: { kind: "count", runs: 1 },
        unloadedCountsAsBroken: true,
        earlyStop: false,
      },
      comboGroupIds: [],
      combos: [],
      rungs: [],
      updatedAt: "2026-08-15T00:00:00Z",
      outerAxis: "rung",
      paused: false,
      autoTopUp: false,
      ...over,
    };
  }

  function backend(ladders: LadderOut[], topUp = vi.fn()) {
    return {
      listLadders: async () => ladders,
      topUpLadder: async (id: string) => {
        topUp(id);
        return { bufferTarget: 5, enqueued: 2, cells: [] } as TopUpResult;
      },
    } as unknown as BackendClient;
  }

  it("tops up only the ladders that opted in and are not paused", async () => {
    const topUp = vi.fn();
    const enqueued = await topUpLaddersAfterReview(
      backend(
        [
          entry({ id: "on", autoTopUp: true }),
          entry({ id: "off", autoTopUp: false }),
          entry({ id: "paused", autoTopUp: true, paused: true }),
        ],
        topUp,
      ),
      "token",
    );
    expect(topUp.mock.calls.map((c) => c[0])).toEqual(["on"]);
    expect(enqueued).toBe(2);
  });

  it("stays silent when it cannot run, so a review never fails because of it", async () => {
    await expect(topUpLaddersAfterReview(null, "token")).resolves.toBe(0);
    await expect(
      topUpLaddersAfterReview(
        {
          listLadders: async () => {
            throw new Error("backend down");
          },
          topUpLadder: async () => ({}) as TopUpResult,
        } as unknown as BackendClient,
        "token",
      ),
    ).resolves.toBe(0);
  });
});
