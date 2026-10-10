import type {
  DispatchStatus,
  Ladder,
  LadderClimber,
  LadderDispatch,
  LadderProgress,
  LadderProgressRung,
  LadderSlot,
  RungTally,
  SlotCounts,
} from "@clockwyrks/backend-api/ladders";
import type { RunSummary } from "@clockwyrks/backend-api/snapshot";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchLive } from "./ladder-dispatch";
import ladderStyles from "./Ladder.module.scss";
import {
  ClimberRow,
  LADDER_ATTENTION_NOTE,
  LadderPage,
  climberCombo,
  climberStatusLabel,
  describeClimberBlock,
  describeLadderStop,
  describeTally,
  dispatchStatusLabel,
  ladderStatusNote,
} from "./LadderPage";
import type { BackendClient } from "../../../client/clients";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import {
  sectionReturnTo,
  useRecordSectionIndex,
} from "../../components/backReturn";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import exec from "../runs/RunExec.module.scss";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
let confirmAnswer = true;
const confirmSpy = vi.fn();
vi.mock("../../components/ConfirmDialog", () => ({
  useConfirm: () => ({
    confirm: async (opts: unknown) => {
      confirmSpy(opts);
      return confirmAnswer;
    },
    alert: async () => {},
  }),
}));

// A run of one rung, carrying only the fields the run log reads.
function runSummary(id: string, slug: string): RunSummary {
  return {
    id,
    startedAt: "2026-08-15T00:00:00Z",
    finishedAt: "2026-08-15T00:01:00Z",
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "v1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      modelId: "opus",
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: 1 },
    },
    state: "completed",
    rating: null,
  } as unknown as RunSummary;
}

function galleryValue(
  queryRunSummaries: GalleryDataInput["queryRunSummaries"] = async () => ({
    summaries: [],
    total: 0,
  }),
): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries,
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
    counted: 3,
    rated: 2,
    unrated: 1,
    passing: 1,
    pending: 2,
    inFlight: 1,
    required: 2,
    ...over,
  };
}

function slot(position: number, over: Partial<LadderSlot> = {}): LadderSlot {
  return {
    rungId: `r${position}`,
    position,
    status: "pending",
    runIds: [],
    jobIds: [],
    ...over,
  };
}

// A climber that passed rung 1 and is running rung 2 of 3.
function climber(over: Partial<LadderClimber> = {}): LadderClimber {
  return {
    key: "claude|opus",
    harness: "claude",
    model: "opus",
    status: "running",
    currentRung: 1,
    slots: [
      slot(0, {
        status: "passed",
        tally: tally({ inFlight: 0, pending: 0, passing: 2 }),
        runIds: ["run-1"],
      }),
      slot(1, { status: "running", tally: tally(), jobIds: ["job-2"] }),
      slot(2),
    ],
    ...over,
  } as LadderClimber;
}

// A gg climber: the same ladder, climbed by a saved configuration with a model bound
// to each launch slot rather than by a harness and a model id.
function ggClimber(over: Partial<LadderClimber> = {}): LadderClimber {
  return climber({
    key: "gg|saved:cfg-1|critic=haiku,primary=opus",
    harness: "gg",
    model: "opus",
    ggConfigId: "saved:cfg-1",
    ggConfigName: "reviewer",
    ggSlotModels: { primary: "opus", critic: "haiku" },
    ...over,
  });
}

function slotCounts(over: Partial<SlotCounts> = {}): SlotCounts {
  return {
    total: 3,
    running: 1,
    blocked: 0,
    passed: 1,
    failed: 0,
    pending: 1,
    skipped: 0,
    ...over,
  };
}

function dispatch(over: Partial<LadderDispatch> = {}): LadderDispatch {
  return {
    id: "d1",
    status: "running",
    startedAt: "2026-10-02T10:00:00Z",
    gate: {
      floor: "playable",
      threshold: { kind: "count", runs: 1 },
      unloadedCountsAsBroken: true,
      earlyStop: false,
    },
    outerAxis: "rung",
    inFlightLimit: { kind: "bounded", runs: 10 },
    retryCount: 1,
    slots: slotCounts(),
    runs: { total: 9, done: 4, inFlight: 1 },
    climbersRunning: 1,
    climbersBlocked: 0,
    climbersFailed: 0,
    climbersCompleted: 0,
    ...over,
  } as LadderDispatch;
}

function progress(over: Partial<LadderProgress> = {}): LadderProgress {
  return {
    ladderId: "l1",
    dispatch: dispatch(),
    rungs: [rung(0), rung(1), rung(2)],
    climbers: [climber()],
    runsUnreviewed: 1,
    ...over,
  };
}

// "Failed" alone is the same sentence for a model that fell at the first case and one
// that passed six, so every state but a completed climb names its rung.
describe("climberStatusLabel", () => {
  it("says each state in plain words, naming the rung from one", () => {
    expect(climberStatusLabel(climber(), 3)).toBe("Running rung 2");
    expect(climberStatusLabel(climber({ status: "failed" }), 3)).toBe(
      "Failed at rung 2",
    );
    expect(
      climberStatusLabel(
        climber({ status: "completed", currentRung: undefined }),
        3,
      ),
    ).toBe("Completed");
  });

  it("names the rung a blocked climber is stuck on, and the kind of fault", () => {
    expect(
      climberStatusLabel(
        climber({
          status: "blocked",
          blocked: { kind: "failing", attempts: 3 },
        }),
        3,
      ),
    ).toBe("Blocked at rung 2: retries used up");
    expect(
      climberStatusLabel(
        climber({ status: "blocked", blocked: { kind: "unrated", runs: 1 } }),
        3,
      ),
    ).toBe("Blocked at rung 2: 1 run unrated");
  });

  it("reads a climber of a stopped dispatch as stopped where it stood", () => {
    expect(climberStatusLabel(climber(), 3, "stopped")).toBe(
      "Stopped at rung 2",
    );
    // A verdict is a verdict whatever ended the dispatch.
    expect(
      climberStatusLabel(climber({ status: "failed" }), 3, "stopped"),
    ).toBe("Failed at rung 2");
  });

  it("never says a climber is waiting on a review or paused", () => {
    for (const status of [
      "running",
      "blocked",
      "failed",
      "completed",
    ] as const) {
      expect(climberStatusLabel(climber({ status }), 3)).not.toMatch(
        /review|paused/i,
      );
    }
  });
});

describe("dispatchStatusLabel", () => {
  it("reads a ladder never run as Not run yet", () => {
    expect(dispatchStatusLabel(null)).toBe("Not run yet");
    expect(dispatchStatusLabel("running")).toBe("Running");
    expect(dispatchStatusLabel("needsAttention")).toBe("Needs attention");
    expect(dispatchStatusLabel("finished")).toBe("Finished");
    expect(dispatchStatusLabel("stopped")).toBe("Stopped");
  });
});

describe("describeTally", () => {
  it("states how many runs passed, against how many, and how many are needed", () => {
    expect(describeTally(tally({ unrated: 0, inFlight: 0, pending: 0 }))).toBe(
      "1 of 3 runs passed (2 needed)",
    );
  });

  it("adds the unrated runs, the runs in flight and the runs still to launch", () => {
    expect(describeTally(tally({ pending: 3, inFlight: 1 }))).toBe(
      "1 of 3 runs passed (2 needed) · 1 without a validator rating · 1 in flight · 2 still to launch",
    );
  });

  it("says one run in the singular", () => {
    expect(
      describeTally(tally({ counted: 1, unrated: 0, inFlight: 0, pending: 0 })),
    ).toBe("1 of 1 run passed (2 needed)");
  });
});

describe("dispatchLive", () => {
  it("holds a dispatch that needs attention to be the running one", () => {
    expect(dispatchLive("running")).toBe(true);
    expect(dispatchLive("needsAttention")).toBe(true);
    expect(dispatchLive("finished")).toBe(false);
    expect(dispatchLive("stopped")).toBe(false);
    expect(dispatchLive(null)).toBe(false);
  });
});

describe("describeClimberBlock", () => {
  // The attempts are the ones the one blocking launch made: the first, and each
  // automatic retry. Nothing is counted "in a row" any more.
  it("counts the blocking launch's attempts, one or several", () => {
    expect(describeClimberBlock({ kind: "failing", attempts: 1 })).toBe(
      "A run launched for this rung used up its automatic retries without a run " +
        "that counts (1 attempt) and was not launched again. Fix the cause, then " +
        "retry this climber to launch it again.",
    );
    expect(describeClimberBlock({ kind: "failing", attempts: 2 })).toBe(
      "A run launched for this rung used up its automatic retries without a run " +
        "that counts (2 attempts) and was not launched again. Fix the cause, then " +
        "retry this climber to launch it again.",
    );
  });

  it("names the fix for each reason", () => {
    expect(describeClimberBlock({ kind: "failing", attempts: 3 })).toMatch(
      /used up its automatic retries without a run that counts \(3 attempts\).*retry/,
    );
    expect(
      describeClimberBlock({ kind: "unlaunchable", reason: "slot unbound" }),
    ).toMatch(/cannot be launched: slot unbound.*retry/);
    expect(describeClimberBlock({ kind: "unrated", runs: 2 })).toMatch(
      /2 completed runs .* carry no validator rating/,
    );
  });
});

describe("climberCombo", () => {
  it("keeps a harness climber's combination to the fields it has", () => {
    expect(climberCombo(climber())).toEqual({
      harness: "claude",
      model: "opus",
    });
  });

  it("carries a gg climber's configuration and slot models through", () => {
    expect(climberCombo(ggClimber())).toEqual({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
      ggSlotModels: { primary: "opus", critic: "haiku" },
    });
  });
});

// A stop that only reports success cannot be told apart from one that found nothing.
describe("describeLadderStop", () => {
  it("reports the count and the scope", () => {
    expect(describeLadderStop({ canceled: 4, includedActive: false })).toBe(
      "Stopped. Canceled 4 runs that had not started.",
    );
    expect(describeLadderStop({ canceled: 1, includedActive: true })).toBe(
      "Stopped. Canceled 1 run including runs already executing.",
    );
  });

  it("says explicitly that nothing was found", () => {
    expect(describeLadderStop({ canceled: 0, includedActive: false })).toMatch(
      /No runs of this dispatch were waiting/,
    );
  });
});

describe("ladderStatusNote", () => {
  it("says nothing for a ladder never run, or one simply running", () => {
    expect(ladderStatusNote(progress({ dispatch: null, climbers: [] }))).toBe(
      null,
    );
    expect(ladderStatusNote(progress())).toBe(null);
  });

  it("says Finished. and Stopped. at the ends of a dispatch", () => {
    expect(
      ladderStatusNote(
        progress({ dispatch: dispatch({ status: "finished" }) }),
      ),
    ).toBe("Finished.");
    expect(
      ladderStatusNote(progress({ dispatch: dispatch({ status: "stopped" }) })),
    ).toBe("Stopped.");
  });

  it("groups blocked climbers by reason, each with its fix", () => {
    const note = ladderStatusNote(
      progress({
        climbers: [
          climber({
            status: "blocked",
            blocked: { kind: "failing", attempts: 3 },
          }),
          climber({
            key: "b",
            status: "blocked",
            blocked: { kind: "failing", attempts: 3 },
          }),
          climber({
            key: "c",
            status: "blocked",
            blocked: { kind: "unlaunchable", reason: "x" },
          }),
        ],
      }),
    );
    expect(note).toMatch(/1 blocked climber cannot be launched/);
    expect(note).toMatch(
      /2 blocked climbers stand on a rung where a launch used up its automatic retries/,
    );
  });

  it("says first that nothing is running when the dispatch needs attention", () => {
    const note = ladderStatusNote(
      progress({
        dispatch: dispatch({ status: "needsAttention", climbersBlocked: 1 }),
        climbers: [
          climber({
            status: "blocked",
            blocked: { kind: "failing", attempts: 2 },
          }),
        ],
      }),
    );
    expect(note).toBe(
      `${LADDER_ATTENTION_NOTE} 1 blocked climber stands on a rung where a ` +
        "launch used up its automatic retries without a run that counts: fix " +
        "the cause, then retry it.",
    );
    expect(LADDER_ATTENTION_NOTE).toMatch(
      /Nothing is running.*blocked climbers are waiting on you/,
    );
  });

  it("names a zero runs-in-flight limit", () => {
    expect(
      ladderStatusNote(
        progress({
          dispatch: dispatch({ inFlightLimit: { kind: "bounded", runs: 0 } }),
        }),
      ),
    ).toMatch(/runs-in-flight limit is 0/);
  });
});

// The board's card is the feature: collapsed it must already answer "how far did this
// model get", and expanded it must show the evidence behind each rung.
describe("ClimberRow", () => {
  function renderRow(
    over: Partial<LadderClimber> = {},
    opts: {
      rungs?: LadderProgressRung[];
      query?: GalleryDataInput["queryRunSummaries"];
      dispatch?: DispatchStatus;
    } = {},
  ) {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue(opts.query)}>
          <ClimberRow
            climber={climber(over)}
            rungs={opts.rungs ?? [rung(0), rung(1), rung(2)]}
            busy={false}
            dispatch={opts.dispatch ?? "running"}
            onRetry={onRetry}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    return { onRetry };
  }

  it("answers where the climber stands without being expanded", () => {
    renderRow();
    expect(screen.getByText("Running rung 2")).toBeTruthy();
    expect(screen.getByText("1/3 rungs")).toBeTruthy();
    expect(screen.queryByText(/runs passed/)).toBeNull();
  });

  // jsdom has no layout, so stability is asserted structurally: the status pill lives
  // in its own slot, and the track and the count are separate slots beside it, for the
  // shortest and the longest statuses alike.
  it("keeps the status in its own slot, apart from the track", () => {
    for (const over of [
      {},
      {
        status: "blocked" as const,
        blocked: { kind: "unrated" as const, runs: 3 },
        currentRung: 11,
      },
    ]) {
      const { unmount } = render(
        <MemoryRouter>
          <GalleryDataProvider value={galleryValue()}>
            <ClimberRow
              climber={climber(over)}
              rungs={Array.from({ length: 12 }, (_, i) => rung(i))}
              busy={false}
            />
          </GalleryDataProvider>
        </MemoryRouter>,
      );
      const label =
        "status" in over
          ? "Blocked at rung 12: 3 runs unrated"
          : "Running rung 2";
      const pill = screen.getByText(label);
      const statusSlot = pill.parentElement!;
      expect(statusSlot.className).toMatch(/climberStatusSlot/);
      expect(pill.getAttribute("title")).toBeTruthy();
      const slots = [...statusSlot.parentElement!.children].map(
        (c) => c.className,
      );
      expect(slots).toHaveLength(3);
      expect(slots[1]).toMatch(/rungTrack/);
      expect(slots[2]).toMatch(/rungCount/);
      unmount();
    }
  });

  it("heads a gg climber with its configuration and the models it binds", () => {
    renderRow(ggClimber());
    expect(screen.getByText("reviewer · haiku, opus")).toBeTruthy();
  });

  it("offers no steering: no watch, priority, or pause", () => {
    renderRow();
    expect(
      screen.queryByRole("button", { name: /watch|pause|resume/i }),
    ).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("says why a blocked climber will not move and offers Retry", () => {
    const { onRetry } = renderRow({
      status: "blocked",
      blocked: { kind: "failing", attempts: 3 },
    });
    expect(screen.getByText("Blocked at rung 2: retries used up")).toBeTruthy();
    expect(screen.getByText(/used up its automatic retries/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry claude · opus" }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers Retry on an unlaunchable climber, once, with one reason line", () => {
    renderRow(
      ggClimber({
        status: "blocked",
        blocked: { kind: "unlaunchable", reason: "configuration deleted" },
        unlaunchable: "configuration deleted",
      }),
    );
    expect(screen.getAllByText(/configuration deleted/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Retry / })).toBeTruthy();
  });

  it("offers no Retry for an unrated block", () => {
    renderRow({ status: "blocked", blocked: { kind: "unrated", runs: 2 } });
    expect(screen.queryByRole("button", { name: /^Retry / })).toBeNull();
  });

  it("keeps the reason and Retry under a dispatch that needs attention", () => {
    const { onRetry } = renderRow(
      { status: "blocked", blocked: { kind: "failing", attempts: 2 } },
      { dispatch: "needsAttention" },
    );
    expect(
      screen.getByText(/without a run that counts \(2 attempts\)/),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry claude · opus" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry once the dispatch is no longer running", () => {
    renderRow(
      { status: "blocked", blocked: { kind: "failing", attempts: 3 } },
      { dispatch: "stopped" },
    );
    expect(screen.getByText("Stopped at rung 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Retry / })).toBeNull();
  });

  it("expands to each rung's slot status and its evidence", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(
      screen.getByText(
        "1 of 3 runs passed (2 needed) · 1 without a validator rating · 1 in flight · 1 still to launch",
      ),
    ).toBeTruthy();
  });

  it("badges the slots after a failed rung as skipped", () => {
    renderRow({
      status: "failed",
      currentRung: 0,
      slots: [
        slot(0, { status: "failed", tally: tally(), runIds: ["run-1"] }),
        slot(1, { status: "skipped" }),
        slot(2, { status: "skipped" }),
      ],
    });
    expect(screen.getByText("Failed at rung 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getAllByText("Skipped")).toHaveLength(2);
  });

  it("highlights only a running climber's current rung", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const rows = screen.getAllByRole("listitem");
    const current = rows.filter((r) => /rungRowCurrent/.test(r.className));
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toMatch(/Running/);
  });

  it("names a rung's engine, so one case climbed on two is two rows", () => {
    renderRow(
      {},
      {
        rungs: [
          rung(0, { engine: "simple-2d" }),
          rung(1, { slug: "case-0" }),
          rung(2),
        ],
      },
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Case 0 · base · v1.0.0 · Simple 2D")).toBeTruthy();
    expect(screen.getByText("Case 0 · base · v1.0.0")).toBeTruthy();
  });

  // A rung's runs are the ones the board says the slot holds, whoever launched them:
  // the gate counts nothing else, so the list under a rung shows nothing else either.
  it("lists only the runs the slot holds for a rung", async () => {
    const query = vi.fn(async () => ({
      summaries: [runSummary("run-1", "case-0"), runSummary("other", "case-0")],
      total: 2,
    }));
    renderRow({}, { query });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(query).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "any",
        testCase: "case-0",
        version: "v1.0.0",
        variant: "base",
        harness: "claude",
        model: "opus",
        engine: "none",
        latestVersions: false,
      }),
    );
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
  });

  it("offers no runs list on a rung the dispatch has not reached", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Rung 1 has a counted run and rung 2 a job in flight; rung 3 has neither.
    expect(screen.getAllByRole("button", { name: /Runs$/ })).toHaveLength(2);
  });

  it("narrows a gg climber's rung runs to its configuration", () => {
    const query = vi.fn(async () => ({ summaries: [], total: 0 }));
    renderRow(ggClimber(), { query });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ harness: "gg", ggConfigId: "cfg-1" }),
    );
  });
});

// The review loop: a rung's runs must open with a return to the ladder behind them.
describe("the ladder's back-return", () => {
  function Dashboard() {
    useRecordSectionIndex("coverage");
    return (
      <ClimberRow
        climber={climber()}
        rungs={[rung(0), rung(1), rung(2)]}
        busy={false}
      />
    );
  }

  it("hands a run's back control a return to the ladder it was opened from", async () => {
    render(
      <MemoryRouter initialEntries={["/account/ladders/l1"]}>
        <GalleryDataProvider
          value={galleryValue(async () => ({
            summaries: [runSummary("run-1", "case-0")],
            total: 1,
          }))}
        >
          <Routes>
            <Route path="/account/ladders/:ladderId" element={<Dashboard />} />
            <Route path="/runs/:runId" element={<p>the run</p>} />
          </Routes>
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    expect(sectionReturnTo("runs", "/runs")).toBe("/runs");
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    const row = await screen.findByRole("link", { name: /opus/i });
    fireEvent.click(row);
    expect(screen.getByText("the run")).toBeTruthy();
    expect(sectionReturnTo("runs", "/runs")).toBe("/account/ladders/l1");
  });
});

// The dashboard mounted for real: Run ladder starts a dispatch, Stop ends it, and the
// controls a dispatch replaced (Enabled, Halt, Pause) are gone.
describe("LadderPage", () => {
  const ladder: Ladder = {
    id: "l1",
    name: "Easy to hard",
    runsPerCell: 3,
    gate: dispatch().gate,
    comboGroupIds: [],
    combos: [{ harness: "claude", model: "opus" }],
    rungs: [
      { id: "r0", slug: "case-0", version: "v1.0.0", variant: "base" },
      { id: "r1", slug: "case-1", version: "v1.0.0", variant: "base" },
    ],
    outerAxis: "rung",
    inFlightLimit: null,
    retryCount: 1,
    updatedAt: "2026-10-02T00:00:00Z",
  };

  let board: LadderProgress;
  let calls: string[];
  // What a Run answers with: a running dispatch unless a test says otherwise.
  let ranBoard: LadderProgress;

  beforeEach(() => {
    calls = [];
    ranBoard = progress();
    confirmAnswer = true;
    confirmSpy.mockClear();
  });

  function renderPage(initial: LadderProgress) {
    board = initial;
    const client = {
      getLadder: async () => ladder,
      getLadderProgress: async () => board,
      getLadderQueue: async () => ({ runs: [], truncated: false }),
      runLadder: async () => {
        calls.push("run");
        board = ranBoard;
        return board;
      },
      stopLadder: async (_id: string, input: { cancelRunning: boolean }) => {
        calls.push(`stop:${input.cancelRunning}`);
        board = progress({ dispatch: dispatch({ status: "stopped" }) });
        return { canceled: 2, includedActive: input.cancelRunning };
      },
      retryLadderClimber: async () => {
        calls.push("retry");
      },
    } as unknown as BackendClient;
    const value = {
      client,
      identity: null,
      status: "ready",
      error: null,
      url: null,
      setUrl: () => {},
    } as unknown as BackendContextValue;
    return render(
      <MemoryRouter initialEntries={["/account/ladders/l1"]}>
        <BackendProvider value={value}>
          <GalleryDataProvider value={galleryValue()}>
            <Routes>
              <Route
                path="/account/ladders/:ladderId"
                element={<LadderPage />}
              />
            </Routes>
          </GalleryDataProvider>
        </BackendProvider>
      </MemoryRouter>,
    );
  }

  it("says how to start a ladder never run, and runs it", async () => {
    renderPage(progress({ dispatch: null, climbers: [], runsUnreviewed: 0 }));
    expect(await screen.findByText("Not run yet")).toBeTruthy();
    expect(
      screen.getByText(/Press Run ladder to start a dispatch/),
    ).toBeTruthy();
    // The configured rungs, so the reader sees what a Run would climb.
    expect(screen.getByText("Case 0 · base · v1.0.0")).toBeTruthy();
    const stop = screen.getByRole("button", { name: "Stop" });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "▶ Run ladder" }));
    await screen.findByText(
      /launches the runs its rung is missing.*Runs that already exist count/,
    );
    expect(calls).toEqual(["run"]);
    // A first Run replaces nothing, so it is not confirmed.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  // A dispatch counts the runs its rungs already have, so a Run over runs that exist
  // finishes at once. "Launched nothing" must not read as "did nothing".
  it("says a Run decided by existing runs launched nothing", async () => {
    ranBoard = progress({
      dispatch: dispatch({
        status: "finished",
        endedAt: "2026-10-02T10:00:01Z",
        runs: { total: 9, done: 9, inFlight: 0 },
        climbersRunning: 0,
        climbersCompleted: 1,
      }),
      climbers: [climber({ status: "completed", currentRung: undefined })],
    });
    renderPage(progress({ dispatch: null, climbers: [], runsUnreviewed: 0 }));
    await screen.findByText("Not run yet");
    fireEvent.click(screen.getByRole("button", { name: "▶ Run ladder" }));
    await screen.findByText(
      /the runs that already exist decided every rung, so nothing was launched/,
    );
    expect(calls).toEqual(["run"]);
  });

  it("shows the summary with the skipped count, and offers no removed controls", async () => {
    renderPage(
      progress({ dispatch: dispatch({ slots: slotCounts({ skipped: 4 }) }) }),
    );
    await screen.findByText("rungs skipped");
    expect(screen.getByText("rungs skipped").textContent).toBe(
      "4 rungs skipped",
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Halt/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Resume/ })).toBeNull();
    expect(screen.queryByText(/↑/)).toBeNull();
    const run = screen.getByRole("button", { name: "▶ Run ladder" });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(run.getAttribute("title")).toMatch(/Stop it to run again/);
  });

  // Needs attention is a reading of a running dispatch: nothing of it is in flight and
  // its blocked climbers wait on their owner, so Run stays unavailable while Stop and
  // the climber's Retry stay available.
  it("reads a dispatch that needs attention, keeping Stop and Retry", async () => {
    renderPage(
      progress({
        dispatch: dispatch({
          status: "needsAttention",
          retryCount: 2,
          climbersRunning: 0,
          climbersBlocked: 1,
          runs: { total: 9, done: 3, inFlight: 0 },
        }),
        climbers: [
          climber({
            status: "blocked",
            blocked: { kind: "failing", attempts: 3 },
          }),
        ],
      }),
    );
    const badge = await screen.findByText("Needs attention");
    expect(badge).toHaveClass(ladderStyles.badgeAttention ?? "missing");
    expect(screen.getByText(/^Nothing is running: every climber/)).toHaveClass(
      exec.warn ?? "missing",
    );
    const run = screen.getByRole("button", { name: "▶ Run ladder" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute(
      "title",
      expect.stringMatching(/waiting on its blocked climbers/),
    );
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Stop and cancel running" }),
    ).toBeEnabled();
    // The retry limit the dispatch took at Run, beside the order it climbs in.
    expect(screen.getByText(/^Retry limit:/)).toHaveTextContent(
      "Retry limit: 2",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry claude · opus" }),
    );
    await screen.findByText("Retrying claude · opus.");
    expect(calls).toEqual(["retry"]);
  });

  it("stops the dispatch and says what it cancelled", async () => {
    renderPage(progress());
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await screen.findByText("Stopped. Canceled 2 runs that had not started.");
    expect(calls).toEqual(["stop:false"]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirms before cancelling running runs too", async () => {
    renderPage(progress());
    confirmAnswer = false;
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop and cancel running" }),
    );
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([]);
    confirmAnswer = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Stop and cancel running" }),
    );
    await screen.findByText(/including runs already executing/);
    expect(calls).toEqual(["stop:true"]);
  });

  it("confirms running again over a finished dispatch", async () => {
    renderPage(progress({ dispatch: dispatch({ status: "finished" }) }));
    expect(await screen.findByText("Finished")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "▶ Run ladder" }));
    await waitFor(() => expect(calls).toEqual(["run"]));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
