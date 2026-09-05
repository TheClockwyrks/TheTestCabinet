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
import { CUES, MAX_STRAIN, STEP_SECONDS, SWAP_SECONDS } from "./constants";
import {
  continueLevel,
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
import type {
  PointerDevice,
  PointerSample,
  UpdateApi,
} from "@clockwyrks/simple-2d";

/** One pointer sample, as the engine's primary pointer reports it. */
function sample(
  type: PointerSample["type"],
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): PointerSample {
  return {
    type,
    x,
    y,
    id: 1,
    primary: true,
    device,
    button: type === "move" ? null : "primary",
    buttons: type === "down" ? ["primary"] : [],
  };
}

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
  pointer: PointerState = { x: 0, y: 0, down: false, device: "mouse" },
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

/**
 * A swap accepted and its first chain step resolved, as the pair a report is
 * read from. An accepted swap exchanges its cells and then travels for
 * `SWAP_SECONDS`, so the board the step reads is the one the swapping state
 * already holds.
 */
function firstStep(
  state: CoreState,
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): { before: CoreState; after: CoreState } {
  const swapping = poseSwap(state, colA, rowA, colB, rowB);
  return { before: swapping, after: tick(swapping, SWAP_SECONDS).state };
}

describe("reportFor", () => {
  it("reports nothing where no step resolved", () => {
    const state = board();
    expect(reportFor(state, state)).toBeNull();
    // A swap accepted is in motion, not resolving: nothing has shattered yet.
    const swapping = poseSwap(state, 3, 1, 3, 2);
    expect(swapping.phase).toBe("swapping");
    expect(reportFor(state, swapping)).toBeNull();
  });

  it("reports the cells the first step of a swap's chain cleared", () => {
    const { before, after } = firstStep(board(), 3, 1, 3, 2);
    const report = reportFor(before, after);

    expect(report?.cleared.map((gem) => `${gem.col},${gem.row}`)).toEqual([
      "1,1",
      "2,1",
      "3,1",
    ]);
    expect(report?.cleared.every((gem) => gem.kind === "ruby")).toBe(true);
    expect(report?.cleared.every((gem) => !gem.flawed)).toBe(true);
    // A set that is its seed alone shatters on one wave.
    expect(report?.cleared.every((gem) => gem.wave === 0)).toBe(true);
    expect(report?.waves).toBe(0);
    expect(report?.created).toEqual([]);
  });

  it("gives a cell R6 brought in the wave that reached it", () => {
    // The brilliant at (2, 1) is in the seed, so the ring it adds is wave 1.
    const primed = setGem(board(), 2, 1, "R0b");
    const { before, after } = firstStep(primed, 3, 1, 3, 2);
    const report = reportFor(before, after);
    const waveOf = (col: number, row: number): number | undefined =>
      report?.cleared.find((gem) => gem.col === col && gem.row === row)?.wave;

    expect(waveOf(2, 1)).toBe(0);
    expect(waveOf(2, 0)).toBe(1);
    expect(report?.waves).toBe(1);
  });

  it("marks a flawed gem, which throws the heavier detonation", () => {
    const primed = setGem(board(), 2, 1, "R3");
    const { before, after } = firstStep(primed, 3, 1, 3, 2);
    const report = reportFor(before, after);
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
    const { before, after } = firstStep(four, 3, 1, 3, 2);
    const report = reportFor(before, after);
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
    const { before, after } = firstStep(withPrism, 4, 4, 5, 4);
    const report = reportFor(before, after);
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
    const span = SWAP_SECONDS + 4 * STEP_SECONDS;
    const coarse = advanceTime(openFrame(chaining), span);
    let fine = openFrame(chaining);
    for (let frame = 0; frame < 60; frame += 1) {
      fine = advanceTime(fine, span / 60);
    }

    expect(coarse.state.phase).toBe("idle");
    expect(coarse.state.simTime).toBeCloseTo(span, 6);
    // Both steps of the chain: 30 for the swap's own step and 60 for the one
    // the fall set off, at multiplier 2.
    expect(coarse.steps).toHaveLength(2);
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
  land: false,
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
    const { api } = fakeApi(["down", "confirm"]);
    const { state } = handleInput(createInitialState(), api);
    // The highlight moved to HOW TO PLAY, and the confirm took it.
    expect(state.screen).toBe("howto");
  });

  it("acts on both actions one key fires, which act on different screens", () => {
    // `Escape` fires `pause` and `back` together. On the board only `pause`
    // has anywhere to act, so the board is held rather than left.
    const { api } = fakeApi(["pause", "back"]);
    const { state } = handleInput(board(), api);
    expect(state.screen).toBe("paused");

    const { api: again } = fakeApi(["pause", "back"]);
    expect(handleInput(state, again).state.screen).toBe("playing");
  });

  it("toggles the engine's mute bit rather than the state", () => {
    const { api, muted } = fakeApi(["mute"]);
    const before = board();
    const { state } = handleInput(before, api);
    expect(muted()).toBe(true);
    expect(state.muted).toBe(before.muted);
  });

  it("reads every edge even where the screen acts on none of them", () => {
    const { api } = fakeApi(["up", "down", "back"]);
    const title = createInitialState();
    const { state } = handleInput(title, api);
    // `up` then `down` on a two-item menu wraps back to where it started.
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
  });

  it("leaves the board to the pointer, so confirm on it takes nothing", () => {
    const { api } = fakeApi(["confirm"]);
    const playing = board();
    const { state } = handleInput(playing, api);
    expect(state.screen).toBe("playing");
    expect(state.selection).toBeNull();
    expect(state.board).toEqual(playing.board);
  });
});

describe("runFrame", () => {
  it("plays the cues its own transitions raised", () => {
    const { api, played } = fakeApi();
    const presentation = new Presentation(scratch);
    const chaining = poseSwap(board(), 3, 1, 3, 2);
    runFrame(chaining, chaining, api, 1 / 60, new AssetStore(), presentation);
    // The pose accepted the swap and played nothing; the swap is still in
    // motion one frame later, so no step has resolved either.
    expect(played).toEqual([]);
  });

  it("plays the cues of a move made inside the frame", () => {
    const { api, played } = fakeApi(
      [],
      [
        sample("down", 604, 216),
        sample("move", 604, 288),
        sample("up", 604, 288),
      ],
    );
    const presentation = new Presentation(scratch);
    const state = board();
    const next = runFrame(
      state,
      state,
      api,
      SWAP_SECONDS + 1 / 60,
      new AssetStore(),
      presentation,
    );

    expect(played).toContain(CUES.select);
    expect(played).toContain(CUES.swap);
    expect(played).toContain(CUES.clear);
    expect(next.chainStep).toBe(1);
  });

  it("carries the device that drove each sample into the state", () => {
    const { api } = fakeApi([], [sample("down", 604, 216, "touch")]);
    const presentation = new Presentation(scratch);
    const state = board();
    const next = runFrame(
      state,
      state,
      api,
      1 / 60,
      new AssetStore(),
      presentation,
    );
    expect(next.pointer.device).toBe("touch");
    expect(next.selection).toEqual({ col: 3, row: 1 });
  });

  it("reads the primary pointer alone, so a second finger changes nothing", () => {
    const second = {
      ...sample("down", 604, 216, "touch"),
      id: 2,
      primary: false,
    };
    const { api } = fakeApi([], [second]);
    const presentation = new Presentation(scratch);
    const state = board();
    const next = runFrame(
      state,
      state,
      api,
      1 / 60,
      new AssetStore(),
      presentation,
    );
    expect(next.selection).toBeNull();
  });

  it("shows the effects of the step the swap in motion resolved", () => {
    const { api } = fakeApi();
    const presentation = new Presentation(scratch);
    const swapping = poseSwap(board(), 3, 1, 3, 2);
    expect(presentation.idle()).toBe(true);

    const assets = new AssetStore();
    runFrame(
      swapping,
      swapping,
      api,
      SWAP_SECONDS + 1 / 60,
      assets,
      presentation,
    );
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
    let state = poseSwap(board(), 3, 1, 3, 2);
    state = runFrame(
      state,
      state,
      fakeApi().api,
      SWAP_SECONDS + 1 / 60,
      assets,
      presentation,
    );
    expect(presentation.idle()).toBe(false);

    for (let frame = 0; frame < 4; frame += 1) {
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

  it("clears the presentation when the next level deals a new board", () => {
    const { api } = fakeApi();
    const presentation = new Presentation(scratch);
    const assets = new AssetStore();
    const swapping = poseSwap(board(), 3, 1, 3, 2);
    const resolved = runFrame(
      swapping,
      swapping,
      api,
      SWAP_SECONDS + 1 / 60,
      assets,
      presentation,
    );
    expect(presentation.idle()).toBe(false);

    // The level's target crossed, the chain settles onto `levelclear`, and
    // CONTINUE deals a board the effects still flying do not belong to.
    const cleared = continueLevel({ ...resolved, screen: "levelclear" });
    runFrame(resolved, cleared, api, 1 / 60, assets, presentation);
    expect(presentation.idle()).toBe(true);
  });

  it("pours a freshly dealt board in from above", () => {
    const { api } = fakeApi();
    const presentation = new Presentation(scratch);
    const title = createInitialState(3);
    const dealt = startRound(title);
    runFrame(title, dealt, api, 1 / 60, new AssetStore(), presentation);
    expect(presentation.pourAge()).toBeGreaterThan(0);
  });

  it("counts a gem at MAX_STRAIN as flawed in what it reports", () => {
    const primed = setGem(board(), 1, 1, `R${MAX_STRAIN}`);
    const { before, after } = firstStep(primed, 3, 1, 3, 2);
    expect(reportFor(before, after)?.cleared.some((gem) => gem.flawed)).toBe(
      true,
    );
  });
});
