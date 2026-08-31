// One frame, driven directly.
//
// `src/engine.test.ts` runs these paths under the real engine; what is checked
// here is the frame itself in isolation — which chain steps it reports to the
// presentation, and that slicing the delta changes what is reported without
// changing what is resolved.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { AssetStore } from "./assets";
import { fromCore, toCore } from "./bridge";
import { CUES, MAX_STRAIN, STEP_SECONDS } from "./constants";
import {
  createInitialState,
  loadBoard,
  poseSwap,
  setGem,
  startRound,
  tick,
  type FacetState as CoreState,
  type PointerState,
} from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { Presentation } from "./effects";
import {
  advanceTime,
  fold,
  handleInput,
  openFrame,
  reportFor,
  runFrame,
} from "./frame";
import type { PointerSample, UpdateApi } from "@test-cabinet/simple-2d";

/** A scratch factory backed by a real canvas, so bursts really simulate. */
const scratch = (width: number, height: number) =>
  createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

interface FakeApi {
  api: UpdateApi;
  played: string[];
  muted: () => boolean;
}

/** An `UpdateApi` that arms the actions named and reports the samples given. */
function fakeApi(
  armed: readonly string[] = [],
  samples: readonly PointerSample[] = [],
  pointer: PointerState = { x: 0, y: 0, down: false },
): FakeApi {
  const pending = new Set(armed);
  const played: string[] = [];
  const looping = new Set<string>();
  let muted = false;
  const api = {
    input: {
      value: () => 0,
      // An edge is consumed by the first read, exactly as the engine's is.
      pressed: (name: string) => pending.delete(name),
      pointer: () => ({ ...pointer }),
      pointerPressed: () => false,
      pointerReleased: () => false,
      pointerSamples: () => [...samples],
    },
    audio: {
      play: (cue: string) => played.push(cue),
      loop: (cue: string) => looping.add(cue),
      stop: (cue: string) => looping.delete(cue),
      looping: (cue: string) => looping.has(cue),
      setMuted: (next: boolean) => {
        muted = next;
      },
      muted: () => muted,
    },
    frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
    viewport: () => ({
      width: 1280,
      height: 720,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
  } as unknown as UpdateApi;
  return { api, played, muted: () => muted };
}

/** A board with one swap that clears exactly three rubies. */
function board(): CoreState {
  return loadBoard(
    startRound(createInitialState(11)),
    quietRowsWith({
      "1,1": "R0",
      "2,1": "R0",
      "3,1": "C0",
      "3,2": "R0",
      "4,1": "B0",
    }),
  );
}

/**
 * A board that CHAINS. The swap `(3, 6)` against `(3, 7)` completes three
 * rubies along the bottom row; the jades that fall into the gap then line up
 * with the jade at `(0, 7)`, so a second step resolves one `STEP_SECONDS`
 * later, at multiplier `2`. Every gem involved is a survivor rather than a
 * refill, so the cascade is a fact of the board rather than of the seed.
 */
function cascade(): CoreState {
  return loadBoard(
    startRound(createInitialState(11)),
    quietRowsWith({
      "0,7": "J0",
      "1,7": "R0",
      "2,7": "R0",
      "3,7": "C0",
      "1,6": "J0",
      "2,6": "J0",
      "3,6": "R0",
    }),
  );
}

describe("reportFor", () => {
  it("reports nothing where no step resolved", () => {
    const state = board();
    expect(reportFor(state, state)).toBeNull();
    expect(reportFor(state, tick(state, 1).state)).toBeNull();
  });

  it("reports the cells the first step of a swap's chain cleared", () => {
    const before = board();
    const after = poseSwap(before, 3, 1, 3, 2);
    const report = reportFor(before, after);

    expect(report?.cleared.map((gem) => `${gem.col},${gem.row}`)).toEqual([
      "1,1",
      "2,1",
      "3,1",
    ]);
    expect(report?.cleared.every((gem) => gem.kind === "ruby")).toBe(true);
    expect(report?.cleared.every((gem) => !gem.flawed)).toBe(true);
    expect(report?.created).toEqual([]);
  });

  it("marks a flawed gem, which throws the heavier detonation", () => {
    const primed = setGem(board(), 2, 1, "R3");
    const report = reportFor(primed, poseSwap(primed, 3, 1, 3, 2));
    expect(
      report?.cleared.find((gem) => gem.col === 2 && gem.row === 1)?.flawed,
    ).toBe(true);
  });

  it("reports what R8 created, at the cell it placed it in", () => {
    // Four in a row leaves a brilliant at the cell the swap named.
    const four = loadBoard(
      startRound(createInitialState()),
      quietRowsWith({
        "1,1": "R0",
        "2,1": "R0",
        "3,1": "C0",
        "3,2": "R0",
        "4,1": "R0",
      }),
    );
    const report = reportFor(four, poseSwap(four, 3, 1, 3, 2));
    expect(report?.cleared).toHaveLength(4);
    expect(report?.created).toEqual([{ col: 3, row: 1 }]);
  });

  it("reports a step seeded from a prism swap, which R8 creates nothing on", () => {
    const withPrism = setGem(
      loadBoard(startRound(createInitialState()), quietRows()),
      4,
      4,
      "X0",
    );
    const report = reportFor(withPrism, poseSwap(withPrism, 4, 4, 5, 4));
    // Every gem of the traded kind, and the prism itself.
    expect(report?.cleared.length).toBeGreaterThan(1);
    expect(report?.created).toEqual([]);
  });
});

describe("advanceTime", () => {
  it("reports the same steps out of one long frame as out of many short ones", () => {
    // This is the whole point of the slicing: a frame worth several
    // STEP_SECONDS must hand the presentation each step it crossed, not the
    // first alone, so the effects of a chain driven from code look like the
    // effects of one played by hand.
    const chaining = poseSwap(cascade(), 3, 6, 3, 7);
    const coarse = advanceTime(openFrame(chaining), 4 * STEP_SECONDS);
    let fine = openFrame(chaining);
    for (let frame = 0; frame < 60; frame += 1) {
      fine = advanceTime(fine, (4 * STEP_SECONDS) / 60);
    }

    expect(coarse.state.phase).toBe("idle");
    expect(coarse.state.simTime).toBeCloseTo(4 * STEP_SECONDS, 6);
    // Step 2 of the chain, scored at multiplier 2: 30 for the swap's own step
    // and 60 for the one the fall set off.
    expect(coarse.steps).toHaveLength(1);
    expect(coarse.steps[0].cleared).toHaveLength(3);
    expect(coarse.state.score).toBe(90);
    expect(coarse.steps.map((step) => step.cleared.length)).toEqual(
      fine.steps.map((step) => step.cleared.length),
    );
    expect(coarse.state.score).toBe(fine.state.score);
  });

  it("resolves the same state however the delta was divided", () => {
    const chaining = poseSwap(cascade(), 3, 6, 3, 7);
    const coarse = advanceTime(openFrame(chaining), 1);
    let fine = openFrame(chaining);
    for (let frame = 0; frame < 60; frame += 1)
      fine = advanceTime(fine, 1 / 60);

    expect(coarse.state.board).toEqual(fine.state.board);
    expect(coarse.state.score).toBe(fine.state.score);
    expect(coarse.state.rngState).toBe(fine.state.rngState);
  });

  it("stops slicing rather than hanging on an absurd delta", () => {
    const outcome = advanceTime(openFrame(poseSwap(board(), 3, 1, 3, 2)), 1000);
    expect(outcome.state.simTime).toBeCloseTo(1000, 3);
    expect(outcome.state.phase).toBe("idle");
  });

  it("runs a frame worth no time at all", () => {
    const state = board();
    expect(advanceTime(openFrame(state), 0).state).toEqual(state);
  });
});

/** Events with nothing raised, spread over in the checks below. */
const NO = {
  select: false,
  swap: false,
  refuse: false,
  clear: false,
  flaw: false,
  cut: false,
  levelUp: false,
  gameOver: false,
};

describe("fold", () => {
  it("merges the events of every transition in the frame", () => {
    const outcome = openFrame(board());
    fold(outcome, { state: outcome.state, events: { ...NO, select: true } });
    fold(outcome, { state: outcome.state, events: { ...NO, swap: true } });
    expect(outcome.events.select).toBe(true);
    expect(outcome.events.swap).toBe(true);
    expect(outcome.events.clear).toBe(false);
  });
});

describe("handleInput", () => {
  it("applies every armed action in turn, to the state the last one left", () => {
    const { api } = fakeApi(["down", "right", "confirm"]);
    const { state } = handleInput(board(), api);
    // The cursor moved twice and then the confirm selected where it landed.
    expect(state.cursor).toEqual({ col: 1, row: 1 });
    expect(state.selection).toEqual({ col: 1, row: 1 });
  });

  it("toggles the engine's mute bit rather than the state", () => {
    const { api, muted } = fakeApi(["mute"]);
    const before = board();
    const { state } = handleInput(before, api);
    expect(muted()).toBe(true);
    expect(state.muted).toBe(before.muted);
  });

  it("reads every edge even where the screen acts on none of them", () => {
    const { api } = fakeApi(["up", "down", "left", "right", "back"]);
    const title = createInitialState();
    const { state } = handleInput(title, api);
    // `up` then `down` on a two-item menu wraps back to where it started.
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });
});

describe("runFrame", () => {
  it("plays the cues its own transitions raised", () => {
    const { api, played } = fakeApi();
    const presentation = new Presentation(scratch);
    const chaining = poseSwap(board(), 3, 1, 3, 2);
    runFrame(chaining, chaining, api, 1 / 60, new AssetStore(), presentation);
    // The pose itself played nothing; this frame resolved no further step.
    expect(played).toEqual([]);
  });

  it("plays the cues of a swap made inside the frame", () => {
    const { api, played } = fakeApi(
      [],
      [
        { type: "down", x: 604, y: 216 },
        { type: "move", x: 604, y: 288 },
      ],
    );
    const presentation = new Presentation(scratch);
    const state = board();
    runFrame(state, state, api, 1 / 60, new AssetStore(), presentation);

    expect(played).toContain(CUES.select);
    expect(played).toContain(CUES.swap);
    expect(played).toContain(CUES.clear);
  });

  it("shows the effects of a step a pose resolved between two frames", () => {
    const { api } = fakeApi();
    const presentation = new Presentation(scratch);
    const before = board();
    const after = poseSwap(before, 3, 1, 3, 2);
    expect(presentation.idle()).toBe(true);

    const assets = new AssetStore();
    runFrame(before, after, api, 1 / 60, assets, presentation);
    // With no produced files in the store there is no burst to fly, but the
    // break sheets of the three cleared rubies are playing.
    expect(presentation.idle()).toBe(false);
  });

  it("keeps the effects flying over the frames that follow, across the bridge", () => {
    // The state round-trips through `src/bridge.ts` twice a frame, so every
    // board a frame sees is a fresh object. A presentation that told one board
    // from another by identity would wipe the sheets one frame after throwing
    // them, which is exactly what a browser shows and a lazy check does not.
    const presentation = new Presentation(scratch);
    const assets = new AssetStore();
    let state = board();
    const swapped = fakeApi(
      [],
      [
        { type: "down", x: 604, y: 216 },
        { type: "move", x: 604, y: 288 },
      ],
    );
    state = runFrame(state, state, swapped.api, 1 / 60, assets, presentation);
    expect(presentation.idle()).toBe(false);

    for (let frame = 0; frame < 8; frame += 1) {
      const seen = toCore(fromCore(state));
      state = runFrame(
        seen,
        toCore(fromCore(state)),
        fakeApi().api,
        1 / 60,
        assets,
        presentation,
      );
      expect(presentation.idle(), `frame ${frame}`).toBe(false);
    }
  });

  it("clears the presentation when a completed level deals a new board", () => {
    const { api } = fakeApi();
    const presentation = new Presentation(scratch);
    const primed = {
      ...poseSwap(board(), 3, 1, 3, 2),
      levelScore: 100000,
    };
    const next = runFrame(
      primed,
      primed,
      api,
      1,
      new AssetStore(),
      presentation,
    );
    expect(next.level).toBe(2);
    expect(presentation.idle()).toBe(true);
  });

  it("counts a gem at MAX_STRAIN as flawed in what it reports", () => {
    const primed = setGem(board(), 1, 1, `R${MAX_STRAIN}`);
    const report = reportFor(primed, poseSwap(primed, 3, 1, 3, 2));
    expect(report?.cleared.some((gem) => gem.flawed)).toBe(true);
  });
});
