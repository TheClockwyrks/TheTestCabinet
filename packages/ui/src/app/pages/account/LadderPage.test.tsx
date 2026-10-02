import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  LadderCell,
  LadderClimber,
  LadderProgress,
  LadderProgressRung,
  LadderRungOutcome,
  RungTally,
} from "@clockwyrks/run-record/ladders";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
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
  climberCombo,
  climberStatusLabel,
  describeClimberBlock,
  describeLadderHalt,
  describeTally,
  ladderStatusNote,
} from "./LadderPage";

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
    supported: true,
    ...over,
  };
}

function tally(over: Partial<RungTally> = {}): RungTally {
  return {
    completed: 3,
    rated: 2,
    unrated: 1,
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
    outcome: "passed",
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
    paused: false,
    status: "running",
    currentRung: cell(),
    outcomes: [outcome()],
    ...over,
  } as LadderClimber;
}

// A gg climber: the same ladder, climbed by a saved configuration with a model bound
// to each launch slot rather than by a harness and a model id. Its key names both,
// because two climbers of one configuration on different models are the two arms a
// ladder exists to separate.
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

function progress(over: Partial<LadderProgress> = {}): LadderProgress {
  return {
    ladderId: "l1",
    outerAxis: "rung",
    rungs: [rung(0), rung(1), rung(2)],
    climbers: [climber()],
    climbersRunning: 1,
    climbersCompleted: 0,
    climbersFailed: 0,
    climbersBlocked: 0,
    climbersPaused: 0,
    runsUnreviewed: 1,
    runsInFlight: 3,
    bufferTarget: { kind: "bounded", runs: 10 },
    ...over,
  };
}

// "Failed" alone is the same sentence for a model that fell at the first case and one
// that passed six, so every state but a completed climb names its rung.
describe("climberStatusLabel", () => {
  it("says each state in plain words, naming the rung from one", () => {
    expect(climberStatusLabel(climber(), 3)).toBe("Running rung 2");
    expect(
      climberStatusLabel(
        climber({
          status: "blocked",
          blocked: { kind: "failing", attempts: 3 },
        }),
        3,
      ),
    ).toBe("Blocked at rung 2: runs keep failing");
    expect(
      climberStatusLabel(
        climber({ status: "failed", currentRung: cell({ position: 2 }) }),
        3,
      ),
    ).toBe("Failed at rung 3");
    expect(climberStatusLabel(climber({ status: "paused" }), 3)).toBe(
      "Paused at rung 2",
    );
    expect(
      climberStatusLabel(
        climber({ status: "completed", currentRung: undefined }),
        3,
      ),
    ).toBe("Completed");
  });

  it("names the rung a blocked climber is stuck on, and the kind of fault", () => {
    const blocked = (b: LadderClimber["blocked"]) =>
      climberStatusLabel(climber({ status: "blocked", blocked: b }), 3);
    expect(blocked({ kind: "unsupportedRung", rungId: "r1" })).toBe(
      "Blocked at rung 2: not validator-rated",
    );
    expect(blocked({ kind: "unlaunchable", reason: "slot unbound" })).toBe(
      "Blocked at rung 2: cannot launch",
    );
    expect(blocked({ kind: "unrated", runs: 2 })).toBe(
      "Blocked at rung 2: 2 runs unrated",
    );
    expect(blocked({ kind: "unrated", runs: 1 })).toBe(
      "Blocked at rung 2: 1 run unrated",
    );
  });

  it("says a paused climber with no rung is paused", () => {
    expect(
      climberStatusLabel(
        climber({ status: "paused", currentRung: undefined }),
        3,
      ),
    ).toBe("Paused");
  });

  it("never says a climber is waiting on a review", () => {
    for (const status of [
      "running",
      "blocked",
      "failed",
      "paused",
      "completed",
    ] as const) {
      expect(climberStatusLabel(climber({ status }), 3)).not.toMatch(/review/i);
    }
  });
});

// The wire delivers verdicts as a flat list with superseded ones trailing; the page
// reads them per rung, so the pairing happens once and in one place.
describe("buildRungViews", () => {
  it("attaches each verdict to its rung and flags a running climber's current one", () => {
    const views = buildRungViews(climber(), [rung(0), rung(1), rung(2)]);
    expect(views.map((v) => v.outcome?.outcome ?? null)).toEqual([
      "passed",
      null,
      null,
    ]);
    expect(views.map((v) => v.current)).toEqual([false, true, false]);
    expect(views.map((v) => v.badge)).toEqual([
      "passed",
      "running",
      "notReached",
    ]);
    expect(views[1]!.tally).not.toBeNull();
  });

  // A failed climber is finished: the rung it failed is its result, carried by the
  // Failed badge, and highlighting it as "current" is what made that row shift.
  it("never marks a failed climber's rung as current", () => {
    const views = buildRungViews(
      climber({
        status: "failed",
        currentRung: cell({ rungId: "r1", position: 1, outcome: "failed" }),
        outcomes: [outcome(), outcome({ rungId: "r1", outcome: "failed" })],
      }),
      [rung(0), rung(1), rung(2)],
    );
    expect(views.map((v) => v.current)).toEqual([false, false, false]);
    expect(views.map((v) => v.badge)).toEqual([
      "passed",
      "failed",
      "notReached",
    ]);
  });

  it("badges a blocked or paused climber's rung by its state, without a highlight", () => {
    for (const status of ["blocked", "paused"] as const) {
      const views = buildRungViews(climber({ status }), [
        rung(0),
        rung(1),
        rung(2),
      ]);
      expect(views[1]!.badge).toBe(status);
      expect(views.some((v) => v.current)).toBe(false);
    }
  });

  it("badges every rung of a completed climber as passed", () => {
    const views = buildRungViews(
      climber({ status: "completed", currentRung: undefined }),
      [rung(0), rung(1), rung(2)],
    );
    expect(views.map((v) => v.badge)).toEqual(["passed", "passed", "passed"]);
    expect(views.some((v) => v.current)).toBe(false);
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
// what is still to come is the ladder's to launch, and a run with no validator rating
// is a fault the gate cannot see past. Nothing in it waits on a reviewer.
describe("describeTally", () => {
  it("states how many runs passed, against how many, and how many are needed", () => {
    expect(
      describeTally(
        tally({
          completed: 3,
          passing: 2,
          required: 1,
          unrated: 0,
          pending: 0,
        }),
      ),
    ).toBe("2 of 3 runs passed (1 needed)");
  });

  it("adds the runs the gate cannot read yet and the runs still to come", () => {
    const text = describeTally(tally());
    expect(text).toBe(
      "1 of 3 runs passed (2 needed) · 1 without a validator rating · 2 still to run",
    );
    expect(text).not.toMatch(/review/i);
  });

  it("says one run in the singular", () => {
    expect(
      describeTally(
        tally({
          completed: 1,
          passing: 1,
          required: 1,
          unrated: 0,
          pending: 0,
        }),
      ),
    ).toBe("1 of 1 run passed (1 needed)");
  });
});

// Every reason a climber is blocked names its fix, because it is the one state nothing
// clears by itself.
describe("describeClimberBlock", () => {
  const name = (slug: string) => slug.toUpperCase();
  const rungs = [rung(0), rung(1, { slug: "pong" })];

  it("names the rung that is not validator-rated, and says to replace it", () => {
    const text = describeClimberBlock(
      { kind: "unsupportedRung", rungId: "r1" },
      rungs,
      name,
    );
    expect(text).toMatch(
      /^Rung 2 \(PONG · base · v1\.0\.0\) is not validator-rated/,
    );
    expect(text).toMatch(/Replace it with a validator-rated version/);
  });

  it("says what to do about each of the other reasons", () => {
    expect(
      describeClimberBlock(
        { kind: "unlaunchable", reason: "launch slot `critic` is unbound" },
        rungs,
        name,
      ),
    ).toMatch(
      /launch slot `critic` is unbound\. Fix the combination or drop it/,
    );
    expect(
      describeClimberBlock({ kind: "failing", attempts: 3 }, rungs, name),
    ).toMatch(/last 3 runs on this rung failed.*retry this climber/);
    expect(
      describeClimberBlock({ kind: "failing", attempts: 3 }, rungs, name),
    ).not.toMatch(/top up/i);
    expect(
      describeClimberBlock({ kind: "unrated", runs: 2 }, rungs, name),
    ).toMatch(
      /2 completed runs on this rung carry no validator rating.*Re-push/,
    );
  });
});

// Steering and retries address a climber by the combination itself, so the fields
// that make a gg climber a gg climber have to survive the round trip — otherwise a
// pause lands on whichever climber happened to share the root model, or on none.
describe("climberCombo", () => {
  it("keeps a harness climber's combination to the three fields it has", () => {
    expect(climberCombo(climber({ provider: "openrouter" }))).toEqual({
      harness: "claude",
      model: "opus",
      provider: "openrouter",
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

  it("leaves the gg fields off a harness climber entirely", () => {
    expect(climberCombo(climber())).not.toHaveProperty("ggConfigId");
    expect(climberCombo(climber())).not.toHaveProperty("ggSlotModels");
  });
});

// A halt that only reports success cannot be told apart from a halt whose scope was
// wrong, so the count — including zero — is always stated.
describe("describeLadderHalt", () => {
  it("reports the count and the scope", () => {
    expect(describeLadderHalt({ canceled: 4, includedActive: false })).toMatch(
      /canceled 4 jobs that had not started/i,
    );
    expect(describeLadderHalt({ canceled: 1, includedActive: true })).toMatch(
      /canceled 1 job including runs already executing/i,
    );
  });

  it("says explicitly that nothing was found rather than succeeding silently", () => {
    expect(describeLadderHalt({ canceled: 0, includedActive: false })).toMatch(
      /no jobs of this ladder were waiting/i,
    );
  });
});

// The note says only what the summary figures cannot: "Finished." once every climber
// has completed or failed, the blocked climbers with each fix, and a climb that cannot
// proceed at all. A ladder that is simply running gets no note, and nothing narrates.
describe("ladderStatusNote", () => {
  const LEGACY = /top up|promote|wall|topped out|answered its question|nobody/i;

  it("says Finished. when every climber completed or failed", () => {
    const note = ladderStatusNote(
      progress({
        climbers: [
          climber({ status: "failed" }),
          climber({
            key: "codex|gpt",
            status: "completed",
            currentRung: undefined,
            unlaunchable: "that model is no longer offered",
          }),
        ],
        climbersRunning: 0,
        climbersFailed: 1,
        climbersCompleted: 1,
      }),
      true,
    );
    expect(note).toBe("Finished.");
  });

  it("is not Finished. while a climber is blocked, paused, or running", () => {
    for (const status of ["blocked", "paused", "running"] as const) {
      const note = ladderStatusNote(
        progress({
          climbers: [
            climber({ status: "failed" }),
            climber({
              key: "codex|gpt",
              status,
              ...(status === "blocked"
                ? { blocked: { kind: "unsupportedRung", rungId: "r1" } }
                : {}),
            }),
          ],
        }),
        true,
      );
      expect(note).not.toBe("Finished.");
    }
  });

  it("groups blocked climbers by reason, each with its fix", () => {
    const note = ladderStatusNote(
      progress({
        climbers: [
          climber(),
          climber({
            key: "a",
            status: "blocked",
            blocked: { kind: "failing", attempts: 3 },
          }),
          climber({
            key: "b",
            status: "blocked",
            blocked: { kind: "unrated", runs: 1 },
          }),
          climber({
            key: "c",
            status: "blocked",
            blocked: { kind: "unrated", runs: 2 },
          }),
        ],
        climbersBlocked: 3,
      }),
    );
    // The blocked total is the summary's figure; the note gives only the reasons.
    expect(note).toBe(
      "1 blocked climber stands on a rung whose runs keep failing: fix the cause, then retry it. " +
        "2 blocked climbers stand on a rung whose runs carry no validator rating: re-push those runs, or replace the rung.",
    );
  });

  // The note's blocked count is the header's: only climbers whose status is blocked.
  // A paused climber nothing can launch keeps that reason on its own row.
  it("counts only the climbers whose status is blocked", () => {
    const note = ladderStatusNote(
      progress({
        climbers: [
          climber(),
          ggClimber({
            key: "gg|saved:gone|primary=opus",
            status: "blocked",
            blocked: {
              kind: "unlaunchable",
              reason: "that gg configuration is no longer on your account",
            },
            unlaunchable: "that gg configuration is no longer on your account",
          }),
          ggClimber({
            key: "gg|saved:cfg-2|primary=opus",
            status: "paused",
            unlaunchable: "launch slot `critic` is unbound",
          }),
        ],
        climbersBlocked: 1,
      }),
    );
    expect(note).toBe(
      "1 blocked climber cannot be launched at all: fix or drop the combination named on its row.",
    );
  });

  it("names a zero runs-in-flight limit on an enabled ladder", () => {
    const stuck = progress({ bufferTarget: { kind: "bounded", runs: 0 } });
    expect(ladderStatusNote(stuck, true)).toBe(
      "The runs-in-flight limit is 0, so this ladder launches nothing.",
    );
    // A disabled ladder launches nothing anyway; its switch says so.
    expect(ladderStatusNote(stuck, false)).toBeNull();
  });

  it("stays quiet while the ladder is simply running", () => {
    expect(ladderStatusNote(progress(), true)).toBeNull();
    expect(
      ladderStatusNote(
        progress({
          runsInFlight: 10,
          bufferTarget: { kind: "bounded", runs: 10 },
        }),
        true,
      ),
    ).toBeNull();
    expect(ladderStatusNote(progress({ runsInFlight: 0 }), true)).toBeNull();
  });

  it("never mentions Top up now, promote, wall, or topped out", () => {
    const boards = [
      progress(),
      progress({ climbers: [climber({ status: "failed" })] }),
      progress({
        climbers: [
          climber({
            status: "blocked",
            blocked: { kind: "failing", attempts: 3 },
          }),
          climber({
            key: "b",
            status: "blocked",
            blocked: { kind: "unsupportedRung", rungId: "r1" },
          }),
          climber({
            key: "c",
            status: "blocked",
            blocked: { kind: "unlaunchable", reason: "x" },
          }),
          climber({
            key: "d",
            status: "blocked",
            blocked: { kind: "unrated", runs: 1 },
          }),
        ],
        bufferTarget: { kind: "bounded", runs: 0 },
      }),
    ];
    for (const board of boards) {
      for (const enabled of [true, false]) {
        expect(ladderStatusNote(board, enabled) ?? "").not.toMatch(LEGACY);
      }
    }
  });
});

// The board's row is the feature: collapsed it must already answer "how far did this
// model get", and expanded it must show the evidence behind each rung.
describe("ClimberRow", () => {
  function renderRow(
    over: Partial<LadderClimber> = {},
    rungs: LadderProgressRung[] = [rung(0), rung(1), rung(2)],
    query?: GalleryDataInput["queryRunSummaries"],
  ) {
    const onSteer = vi.fn();
    const onRetry = vi.fn();
    const onBump = vi.fn();
    render(
      <MemoryRouter>
        <GalleryDataProvider value={galleryValue(query)}>
          <ClimberRow
            climber={climber(over)}
            rungs={rungs}
            busy={false}
            editTo="/account/ladders/l1/edit"
            onSteer={onSteer}
            onRetry={onRetry}
            onBump={onBump}
          />
        </GalleryDataProvider>
      </MemoryRouter>,
    );
    return { onSteer, onRetry, onBump };
  }

  it("answers where the climber stopped without being expanded", () => {
    renderRow({ status: "failed", currentRung: cell({ position: 1 }) });
    expect(screen.getByText("Failed at rung 2")).toBeTruthy();
    expect(screen.getByText("1/3 rungs")).toBeTruthy();
    // The per-rung detail is what expanding adds.
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
        currentRung: cell({ position: 11 }),
      },
    ]) {
      const { unmount } = render(
        <MemoryRouter>
          <GalleryDataProvider value={galleryValue()}>
            <ClimberRow
              climber={climber(over)}
              rungs={Array.from({ length: 12 }, (_, i) => rung(i))}
              busy={false}
              onSteer={vi.fn()}
              onBump={vi.fn()}
            />
          </GalleryDataProvider>
        </MemoryRouter>,
      );
      const label =
        "status" in over
          ? "Blocked at rung 12: 3 runs unrated"
          : "Running rung 2";
      const pill = screen.getByText(label);
      const slot = pill.parentElement!;
      expect(slot.className).toMatch(/climberStatusSlot/);
      // The whole status is the pill's tooltip, for when the slot cuts it short.
      expect(pill.getAttribute("title")).toBeTruthy();
      const line = slot.parentElement!;
      const slots = [...line.children].map((c) => c.className);
      expect(slots).toHaveLength(3);
      expect(slots[1]).toMatch(/rungTrack/);
      expect(slots[2]).toMatch(/rungCount/);
      unmount();
    }
  });

  it("heads a gg climber with its configuration and the models it binds", () => {
    renderRow(ggClimber());
    // Not "gg · opus": two climbers of two configurations can share a root model, and
    // the board exists to tell them apart at a glance.
    expect(screen.getByText("reviewer · haiku, opus")).toBeTruthy();
    // The steering controls name the same thing, so a screen reader is never offered
    // two identical buttons.
    expect(
      screen.getByRole("button", { name: /^Watch reviewer · haiku, opus$/ }),
    ).toBeTruthy();
  });

  // The state this row is worst at showing: a climber that cannot move looks exactly
  // like one waiting on its runs, and it will keep looking like one forever.
  it("says why a blocked climber will not move, without being expanded", () => {
    renderRow(
      ggClimber({
        status: "blocked",
        blocked: {
          kind: "unlaunchable",
          reason: "that gg configuration is no longer on your account",
        },
        unlaunchable: "that gg configuration is no longer on your account",
      }),
    );
    expect(screen.getByText("Blocked at rung 2: cannot launch")).toBeTruthy();
    // One reason line, not two: the block and the membership fault are the same one.
    const lines = screen.getAllByText(
      /that gg configuration is no longer on your account/,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toMatch(/Fix the combination or drop it/);
  });

  it("names the rung that is not validator-rated and links to replacing it", () => {
    renderRow(
      {
        status: "blocked",
        blocked: { kind: "unsupportedRung", rungId: "r1" },
      },
      [rung(0), rung(1, { supported: false }), rung(2)],
    );
    expect(
      screen.getByText("Blocked at rung 2: not validator-rated"),
    ).toBeTruthy();
    const replace = screen.getByRole("link", { name: "Replace the rung" });
    expect(replace.getAttribute("href")).toBe("/account/ladders/l1/edit");
    // The fix sits in the sentence that names the rung it fixes.
    expect(replace.closest("p")?.textContent).toMatch(
      /^Rung 2 \(Case 1 · base · v1\.0\.0\) is not validator-rated/,
    );
  });

  it("offers Retry only on a climber blocked as failing, and retries that climber", () => {
    const failing = climber({
      status: "blocked",
      blocked: { kind: "failing", attempts: 3 },
    });
    const { onRetry } = renderRow(failing);
    const retry = screen.getByRole("button", { name: "Retry" });
    // The fix sits at the end of the sentence that names the fault.
    expect(retry.closest("p")?.textContent).toMatch(
      /Fix the cause, then retry this climber/,
    );
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith(failing);
    expect(screen.queryByRole("link", { name: "Replace the rung" })).toBeNull();
    expect(screen.queryByText(/top up/i)).toBeNull();
  });

  it("offers no Retry for any other state or block", () => {
    for (const over of [
      {},
      { status: "failed" as const },
      { status: "paused" as const, paused: true },
      {
        status: "blocked" as const,
        blocked: { kind: "unrated" as const, runs: 2 },
      },
    ]) {
      const { unmount } = render(
        <MemoryRouter>
          <GalleryDataProvider value={galleryValue()}>
            <ClimberRow
              climber={climber(over)}
              rungs={[rung(0), rung(1), rung(2)]}
              busy={false}
              onSteer={vi.fn()}
              onRetry={vi.fn()}
              onBump={vi.fn()}
            />
          </GalleryDataProvider>
        </MemoryRouter>,
      );
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      unmount();
    }
  });

  it("keeps a broken combination's reason on a climber that has no current rung", () => {
    renderRow(
      ggClimber({
        status: "completed",
        currentRung: undefined,
        unlaunchable: "launch slot `critic` is unbound",
      }),
    );
    expect(screen.getByText("Cannot launch")).toBeTruthy();
    expect(screen.getByText(/launch slot `critic` is unbound/)).toBeTruthy();
    // And the state it is actually in is still said, because a broken membership is
    // a fault beside the climb rather than a verdict of it.
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("says nothing about blocking on a climber that can launch", () => {
    renderRow();
    expect(screen.queryByText(/Blocked|Cannot launch/)).toBeNull();
  });

  it("marks a rung the ladder cannot climb on every climber, with the way to replace it", () => {
    renderRow({}, [rung(0), rung(1), rung(2, { supported: false })]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText("Not validator-rated: cannot be climbed"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Replace rung" }).getAttribute("href"),
    ).toBe("/account/ladders/l1/edit");
  });

  it("expands to the per-rung badges and their evidence", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Passed")).toBeTruthy();
    // "Running" is the current rung's badge; the header pill says "Running rung 2".
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText(/1 of 3 runs passed \(2 needed\)/)).toBeTruthy();
    // A rung above the climber is still listed — the rungs ahead are what the climb
    // is for.
    expect(screen.getByText("Not reached")).toBeTruthy();
  });

  it("highlights only a running climber's current rung", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => /rungRowCurrent/.test(r.className))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("highlights no rung of a failed climber, and badges the rung it failed", () => {
    renderRow({
      status: "failed",
      currentRung: cell({ rungId: "r1", position: 1, outcome: "failed" }),
      outcomes: [outcome(), outcome({ rungId: "r1", outcome: "failed" })],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const rows = screen.getAllByRole("listitem");
    expect(rows.some((r) => /rungRowCurrent/.test(r.className))).toBe(false);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("offers no way to override a verdict", () => {
    renderRow({
      status: "failed",
      currentRung: cell({ rungId: "r1", position: 1, outcome: "failed" }),
      outcomes: [outcome(), outcome({ rungId: "r1", outcome: "failed" })],
    });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.queryByText(/promote|wall here|override|by hand/i),
    ).toBeNull();
  });

  it("names a rung's engine, so one case climbed on two is two rows", () => {
    renderRow({}, [
      rung(0, { engine: "simple-2d" }),
      rung(1, { slug: "case-0" }),
    ]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Case 0 · base · v1.0.0 · Simple 2D")).toBeTruthy();
    // The engineless rung reads exactly as it always did: every pin has an engine, so
    // naming `none` would add a word to every rung and distinguish nothing.
    expect(screen.getByText("Case 0 · base · v1.0.0")).toBeTruthy();
  });

  it("lists a reached rung's own runs inline, for that combination at the pinned version", async () => {
    const query = vi.fn(async () => ({
      summaries: [runSummary("run-1", "case-0")],
      total: 1,
    }));
    renderRow({}, undefined, query);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Nothing is fetched until the rung's runs are actually asked for.
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
        // A rung pins an exact version, which the listing's "current versions
        // only" default would otherwise filter away.
        latestVersions: false,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /run-1|Case 0|opus/i }),
      ).toBeTruthy(),
    );
  });

  it("narrows a gg climber's rung runs to its configuration", () => {
    // Harness and model alone say nothing here: every gg climber on this model runs
    // the `gg` harness, so a rung listing without the configuration would show the
    // runs of every arm and disagree with the verdict printed above it.
    const query = vi.fn(async () => ({ summaries: [], total: 0 }));
    renderRow(ggClimber(), undefined, query);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "gg",
        // The bare id the run records, not the picker's `saved:` spelling.
        ggConfigId: "cfg-1",
      }),
    );
  });

  it("narrows a rung's runs to the rung's own engine", () => {
    // Two rungs of one case on two engines are two cells, and the gate counts its
    // evidence through the engine segment. A listing without it shows the other
    // rung's runs as the argument behind this rung's verdict.
    const query = vi.fn(async () => ({ summaries: [], total: 0 }));
    renderRow({}, [rung(0, { engine: "simple-2d" }), rung(1)], query);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "simple-2d" }),
    );
  });

  it("asks for the engineless runs of a rung that pins no engine", () => {
    // Absent and `none` are one pin, so the listing names the engineless run rather
    // than leaving the filter off and picking up every engine's runs.
    const query = vi.fn(async () => ({ summaries: [], total: 0 }));
    renderRow({}, undefined, query);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getAllByRole("button", { name: /Runs$/ })[0]!);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "none" }),
    );
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
    fireEvent.click(screen.getByRole("button", { name: /^Pause$/ }));
    expect(onSteer).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 3, focused: true }),
      { paused: true },
    );
  });

  // Typing "12" passes through "1", and a write per keystroke re-read the board and
  // re-rendered the field from the server's answer mid-edit — which is what made the
  // field appear to change itself.
  it("writes a typed priority once the field is done with, not per keystroke", () => {
    const { onSteer } = renderRow({ priority: 0 });
    const field = screen.getByRole("spinbutton", { name: /Climb priority/ });
    fireEvent.change(field, { target: { value: "1" } });
    fireEvent.change(field, { target: { value: "12" } });
    expect(onSteer).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onSteer).toHaveBeenCalledWith(expect.anything(), { priority: 12 });
  });

  it("treats an emptied priority as an abandoned edit, not as zero", () => {
    const { onSteer } = renderRow({ priority: 4 });
    const field = screen.getByRole("spinbutton", { name: /Climb priority/ });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(onSteer).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("4");
  });

  it("toggles the focus flag from the star", () => {
    const { onSteer } = renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: /^Watch claude · opus$/ }),
    );
    expect(onSteer).toHaveBeenCalledWith(expect.anything(), { focused: true });
  });

  it("resumes a paused climber rather than offering to pause it again", () => {
    const { onSteer } = renderRow({ paused: true, status: "paused" });
    fireEvent.click(screen.getByRole("button", { name: /^Resume$/ }));
    expect(onSteer).toHaveBeenCalledWith(expect.anything(), { paused: false });
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
        onBump={vi.fn()}
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
