// Wireworm under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`, which
// makes a duration an exact number of frames. What is read back is the game's
// own state, the debug surface the game returned beside it, the engine's cue
// events, and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose takes a state and returns the next one and is
// driven through `engine.apply`; a reading is handed `engine.state`. `h.pose`
// and `h.snapshot` are those two moves, named.
//
// The seeded art cannot be fetched or decoded in this host, so every frame is
// `null` here and the render falls back to the shapes it draws in code. That is
// deliberate: it is the same path a browser with a missing file takes, and it
// keeps these checks about the game rather than about the art.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARC_LIFE,
  BANNER_TIME,
  BOLT_SPEED,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  DROPPER_SPEED,
  DROPPER_SPEED_HIT,
  FIRE_INTERVAL,
  GLITCH_H_SPEED,
  LAYOUT,
  MAX_BOLTS,
  RESPAWN_INVULN,
  RESPAWN_TIME,
  SCORE_BODY,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_LEVEL_CLEAR,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  tileCX,
  tileCY,
  wormLength,
  wormStepInterval,
} from "./constants";
import {
  BACKGROUND,
  game,
  type WirewormDebugApi,
  type WirewormSnapshot,
  type WirewormState,
} from "./game";
import { BAND_CENTER_X, BAND_CENTER_Y } from "./flow";
import type { DeepReadonly } from "ts-essentials";

// ---- The harness --------------------------------------------------------

/** Frames per second the scripted clock runs at, so a second is 60 frames. */
const FPS = 60;
const TICK_MS = 1000 / FPS;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface Harness {
  readonly engine: Engine<WirewormState, WirewormDebugApi>;
  readonly state: DeepReadonly<WirewormState>;
  readonly debug: WirewormDebugApi;
  pose(
    transition: (
      state: DeepReadonly<WirewormState>,
      debug: WirewormDebugApi,
    ) => WirewormState,
  ): void;
  snapshot(): WirewormSnapshot;
  readonly cues: CuePlay[];
  readonly assetPaths: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  advance(seconds: number): Promise<void>;
  frames(count: number): Promise<void>;
  setStep(seconds: number): void;
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx as SKRSContext2D,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<WirewormState, WirewormDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed before any game code runs, so what the game asked its loader for
  // is visible whether or not this host could serve it.
  const assetPaths: string[] = [];
  engine.events.on("asset:failed", ({ path }) => assetPaths.push(path));
  engine.events.on("asset:loaded", ({ path }) => assetPaths.push(path));
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  // Read off the engine rather than built here: `initialize` returns the surface
  // beside the state, so reaching it this way is what makes that return
  // load-bearing.
  const debug = engine.debug;

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    pose: (transition) => {
      engine.apply((s) => transition(s, debug));
    },
    snapshot: () => debug.snapshot(engine.state),
    cues,
    assetPaths,
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    pixel: (x, y) => {
      const view: Viewport = engine.viewport();
      const { data } = ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        1,
        1,
      );
      return [
        data[0] as number,
        data[1] as number,
        data[2] as number,
        data[3] as number,
      ];
    },
    advance: (seconds) => engine.advance(Math.round(seconds * FPS)),
    frames: (count) => engine.advance(count),
    setStep: (seconds) => {
      engine.setClock(new ConstantClock(seconds * 1000));
    },
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * The frames that carry a worm through exactly `count` steps at `level`.
 *
 * The clock runs at a fixed 60 frames a second and a step interval is not a
 * whole number of frames, so a duration is turned into frames by aiming at the
 * middle of the step after the one wanted: the count is unambiguous whichever
 * way the arithmetic rounds.
 */
function stepFrames(count: number, level = 1): number {
  return Math.floor((count + 0.5) * wormStepInterval(level) * FPS);
}

/** The last entry of a list, which is where the surface appends what it adds. */
function last<T>(list: readonly T[]): T {
  return list[list.length - 1] as T;
}

/**
 * An empty, quiet board in live play: no nodes, no worms, no foes, no bolts,
 * with the level's own spawners, its worm entry and the cursor's contact test
 * all off, so nothing a check did not ask for arrives.
 */
function startPlaying(level = 1): void {
  h.pose((s, d) => d.clearNodes(s));
  h.pose((s, d) => d.clearWorms(s));
  h.pose((s, d) => d.clearFoes(s));
  h.pose((s, d) => d.clearBolts(s));
  h.pose((s, d) => d.setFoeSpawning(s, false));
  h.pose((s, d) => d.setWormEntry(s, false));
  h.pose((s, d) => d.setCursorContact(s, false));
  h.pose((s, d) => d.setScreen(s, "playing"));
  h.pose((s, d) => d.setPhase(s, "active"));
  h.pose((s, d) => d.setPhaseTimer(s, 0));
  h.pose((s, d) => d.setLevel(s, level));
  h.pose((s, d) => d.setCursor(s, BAND_CENTER_X, BAND_CENTER_Y));
  h.pose((s, d) => d.setCursorInvulnerable(s, 0));
  h.pose((s, d) => d.setFireCooldown(s, 0));
}

/** A worm of `length` segments laid along a row from `(c, r)` leftward. */
function poseWorm(c: number, r: number, length: number): number {
  h.pose((s, d) => d.addWorm(s, c, r));
  const id = last(h.snapshot().worms).id;
  for (let i = 1; i < length; i++) {
    h.pose((s, d) => d.appendSegment(s, id, c - i, r));
  }
  return id;
}

/** The worm with that id, as the snapshot reports it. */
function worm(id: number): WirewormSnapshot["worms"][number] | undefined {
  return h.snapshot().worms.find((candidate) => candidate.id === id);
}

/** The charge on `(c, r)`, or `null` where the tile is empty. */
function chargeAt(c: number, r: number): number | null {
  const node = h.snapshot().nodes.find((n) => n.c === c && n.r === r);
  return node?.charge ?? null;
}

// ---- The surface --------------------------------------------------------

describe("the debug surface", () => {
  it("is returned beside the state and reports its version", () => {
    expect(h.debug.version).toBe(WIREWORM_DEBUG_VERSION);
    expect(typeof h.debug.snapshot).toBe("function");
    expect(typeof h.debug.reset).toBe("function");
  });

  it("reads every pose back through the snapshot", () => {
    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setPhase(s, "respawn"));
    h.pose((s, d) => d.setPhaseTimer(s, 0.75));
    h.pose((s, d) => d.setMenuIndex(s, 2));
    h.pose((s, d) => d.setScore(s, 4321));
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setLevel(s, 7));
    h.pose((s, d) => d.setReachedLevel(s, 9));
    h.pose((s, d) => d.setFoeSpawning(s, false));
    h.pose((s, d) => d.setWormEntry(s, false));
    h.pose((s, d) => d.setCursorContact(s, false));
    h.pose((s, d) => d.setCursor(s, 300, 690));
    h.pose((s, d) => d.setCursorInvulnerable(s, 1.5));
    h.pose((s, d) => d.setFireCooldown(s, 0.1));

    const snap = h.snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.phase).toBe("respawn");
    expect(snap.phaseTimer).toBeCloseTo(0.75, 6);
    expect(snap.menuIndex).toBe(2);
    expect(snap.score).toBe(4321);
    expect(snap.lives).toBe(2);
    expect(snap.level).toBe(7);
    expect(snap.reachedLevel).toBe(9);
    expect(snap.foeSpawning).toBe(false);
    expect(snap.wormEntry).toBe(false);
    expect(snap.cursor.contact).toBe(false);
    expect(snap.cursor.x).toBeCloseTo(300, 6);
    expect(snap.cursor.y).toBeCloseTo(690, 6);
    expect(snap.cursor.invulnerable).toBeCloseTo(1.5, 6);
    expect(snap.fireCooldown).toBeCloseTo(0.1, 6);
  });

  it("derives the level's step interval and worm length", () => {
    h.pose((s, d) => d.setLevel(s, 12));
    const snap = h.snapshot();
    expect(snap.wormStepInterval).toBeCloseTo(wormStepInterval(12), 9);
    expect(snap.wormLength).toBe(wormLength(12));
  });

  it("restores the title values on reset and leaves muting alone", async () => {
    startPlaying(5);
    h.pose((s, d) => d.setScore(s, 900));
    h.pose((s, d) => d.setNode(s, 4, 4, 3));
    poseWorm(10, 5, 3);
    h.pose((s, d) => d.addFoe(s, "glitch", 400, 300));
    h.pose((s, d) => d.addBolt(s, 400, 500));
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);

    h.pose((s, d) => d.reset(s));
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBe("banner");
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(START_LIVES);
    expect(snap.level).toBe(1);
    expect(snap.reachedLevel).toBe(1);
    expect(snap.nodes).toHaveLength(0);
    expect(snap.worms).toHaveLength(0);
    expect(snap.foes).toHaveLength(0);
    expect(snap.bolts).toHaveLength(0);
    expect(snap.cursor).toEqual({
      x: BAND_CENTER_X,
      y: BAND_CENTER_Y,
      invulnerable: 0,
      contact: true,
    });
    expect(snap.foeSpawning).toBe(true);
    expect(snap.wormEntry).toBe(true);
    expect(snap.simTime).toBe(0);
    // Muting is the runtime's, and a reset is not a player pressing M.
    expect(snap.muted).toBe(true);
  });

  it("seeds the run's randomness", () => {
    const scatter = (seed: number): string => {
      h.pose((s, d) => d.reset(s, { seed }));
      h.pose((s, d) => d.setScreen(s, "title"));
      h.pose((s, d) => d.setMenuIndex(s, 0));
      h.tap("Enter");
      h.pose((s) => s);
      return "";
    };
    void scatter;

    h.pose((s, d) => d.reset(s, { seed: 7 }));
    h.tap("Enter");
    // The confirm is read on the next update, which is when the run opens.
    return h.frames(1).then(async () => {
      const first = h
        .snapshot()
        .nodes.map((n) => `${n.c},${n.r}`)
        .join(" ");

      h.pose((s, d) => d.reset(s, { seed: 7 }));
      h.tap("Enter");
      await h.frames(1);
      const again = h
        .snapshot()
        .nodes.map((n) => `${n.c},${n.r}`)
        .join(" ");

      h.pose((s, d) => d.reset(s, { seed: 8 }));
      h.tap("Enter");
      await h.frames(1);
      const other = h
        .snapshot()
        .nodes.map((n) => `${n.c},${n.r}`)
        .join(" ");

      expect(again).toBe(first);
      expect(other).not.toBe(first);
      expect(first.length).toBeGreaterThan(0);
    });
  });

  it("clears one roster at a time", () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 3, 3, 1));
    poseWorm(10, 5, 2);
    h.pose((s, d) => d.addFoe(s, "dropper", 200, 200));
    h.pose((s, d) => d.addBolt(s, 200, 400));

    h.pose((s, d) => d.clearNodes(s));
    let snap = h.snapshot();
    expect(snap.nodes).toHaveLength(0);
    expect(snap.worms).toHaveLength(1);
    expect(snap.foes).toHaveLength(1);
    expect(snap.bolts).toHaveLength(1);

    h.pose((s, d) => d.clearWorms(s));
    snap = h.snapshot();
    expect(snap.worms).toHaveLength(0);
    expect(snap.foes).toHaveLength(1);
    expect(snap.bolts).toHaveLength(1);

    h.pose((s, d) => d.clearFoes(s));
    snap = h.snapshot();
    expect(snap.foes).toHaveLength(0);
    expect(snap.bolts).toHaveLength(1);

    h.pose((s, d) => d.clearBolts(s));
    expect(h.snapshot().bolts).toHaveLength(0);
  });

  it("gives every entity a distinct id and appends it to its roster", () => {
    startPlaying();
    const first = poseWorm(10, 5, 1);
    const second = poseWorm(20, 5, 1);
    h.pose((s, d) => d.addFoe(s, "glitch", 100, 300));
    h.pose((s, d) => d.addBolt(s, 100, 500));
    const snap = h.snapshot();

    expect(snap.worms.map((w) => w.id)).toEqual([first, second]);
    const ids = [
      ...snap.worms.map((w) => w.id),
      ...snap.foes.map((f) => f.id),
      ...snap.bolts.map((b) => b.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("grants no bonus life when the score is posed across a boundary", () => {
    startPlaying();
    h.pose((s, d) => d.setLives(s, 3));
    h.pose((s, d) => d.setScore(s, 24_500));
    expect(h.snapshot().lives).toBe(3);
  });
});

// ---- The deterministic core ---------------------------------------------

describe("the simulation", () => {
  it("reaches the same state however the second was divided", async () => {
    const runFor = async (step: number, frames: number): Promise<string> => {
      h.pose((s, d) => d.reset(s));
      startPlaying();
      const id = poseWorm(20, 5, 1);
      h.pose((s, d) => d.setWormBody(s, id, false));
      h.setStep(step);
      await h.frames(frames);
      const snap = h.snapshot();
      const head = snap.worms[0]?.segments[0];
      return `${snap.simTime.toFixed(6)} ${head?.c},${head?.r}`;
    };

    const asOne = await runFor(1, 1);
    const asSixty = await runFor(1 / 60, 60);
    expect(asOne).toBe(asSixty);
    expect(asOne.startsWith("1.000000")).toBe(true);
  });

  it("accumulates simulated time on every screen", async () => {
    h.pose((s, d) => d.setScreen(s, "title"));
    await h.advance(1);
    expect(h.snapshot().simTime).toBeCloseTo(1, 6);
  });
});

// ---- The worm ------------------------------------------------------------

describe("the data-worm", () => {
  it("winds one tile per step at the level's interval", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    await h.frames(stepFrames(10));
    expect(worm(id)?.segments[0]).toEqual({ c: 30, r: 5 });
  });

  it("holds still with stepping off", async () => {
    startPlaying();
    const still = poseWorm(20, 5, 1);
    const moving = poseWorm(20, 8, 1);
    h.pose((s, d) => d.setWormStepping(s, still, false));
    h.pose((s, d) => d.setWormBody(s, moving, false));
    await h.frames(stepFrames(10));
    expect(worm(still)?.segments[0]).toEqual({ c: 20, r: 5 });
    expect(worm(moving)?.segments[0]).toEqual({ c: 30, r: 8 });
  });

  it("holds its trailing segments with the body off", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 3);
    h.pose((s, d) => d.setWormBody(s, id, false));
    await h.frames(stepFrames(1));
    expect(worm(id)?.segments).toEqual([
      { c: 21, r: 5 },
      { c: 19, r: 5 },
      { c: 18, r: 5 },
    ]);
  });

  it("brings the body along the head's path", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 3);
    await h.frames(stepFrames(2));
    expect(worm(id)?.segments).toEqual([
      { c: 22, r: 5 },
      { c: 21, r: 5 },
      { c: 20, r: 5 },
    ]);
  });

  it("charges the node that blocks it, drops a row and reverses", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setNode(s, 21, 5, 0));
    await h.frames(stepFrames(1));
    expect(chargeAt(21, 5)).toBe(1);
    expect(worm(id)?.segments[0]).toEqual({ c: 20, r: 6 });
    expect(worm(id)?.dh).toBe(-1);
  });

  it("charges nothing when the side edge turns it", async () => {
    startPlaying();
    const id = poseWorm(39, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    await h.frames(stepFrames(1));
    expect(h.snapshot().nodes).toHaveLength(0);
    expect(worm(id)?.segments[0]).toEqual({ c: 39, r: 6 });
    expect(worm(id)?.dh).toBe(-1);
  });

  it("caps a bumped node at critical", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setWormDescent(s, id, -1));
    h.pose((s, d) => d.setNode(s, 21, 5, 3));
    h.pose((s, d) => d.setNode(s, 19, 5, 3));
    await h.frames(stepFrames(4));
    expect(chargeAt(21, 5)).toBe(3);
  });

  it("dives on a critical node and ends the dive at the band", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setNode(s, 21, 5, 3));
    await h.frames(stepFrames(1));
    expect(worm(id)?.diving).toBe(true);
    expect(worm(id)?.segments[0]).toEqual({ c: 20, r: 6 });

    await h.frames(stepFrames(13) - stepFrames(1));
    expect(worm(id)?.diving).toBe(false);
    expect(worm(id)?.segments[0]?.r).toBe(18);
    expect(worm(id)?.segments[0]?.c).toBe(20);
  });

  it("flips its descent at the floor and at the entry row", async () => {
    startPlaying();
    const id = poseWorm(39, 19, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    await h.frames(stepFrames(1));
    expect(worm(id)?.segments[0]).toEqual({ c: 39, r: 18 });
    expect(worm(id)?.dv).toBe(-1);
  });

  it("passes a drop through whatever stands in the tile below", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setNode(s, 21, 5, 0));
    h.pose((s, d) => d.setNode(s, 20, 6, 2));
    await h.frames(stepFrames(1));
    expect(worm(id)?.segments[0]).toEqual({ c: 20, r: 6 });
    expect(chargeAt(20, 6)).toBe(2);
  });

  it("ends a dive posed onto a head already in the band", async () => {
    startPlaying();
    const id = poseWorm(20, 19, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setWormDiving(s, id, true));
    await h.frames(stepFrames(1));
    expect(worm(id)?.diving).toBe(false);
    expect(worm(id)?.segments[0]).toEqual({ c: 21, r: 19 });
  });

  it("enters along the entry row at the level's length", async () => {
    startPlaying(3);
    h.pose((s, d) => d.setWormEntry(s, true));
    h.pose((s, d) => d.setPhase(s, "banner"));
    h.pose((s, d) => d.setPhaseTimer(s, BANNER_TIME));
    await h.advance(BANNER_TIME + 0.05);
    const entered = h.snapshot().worms[0];
    expect(entered).toBeDefined();
    expect(entered?.segments).toHaveLength(wormLength(3));
    expect(entered?.segments.every((tile) => tile.r === 0)).toBe(true);
    expect(entered?.dv).toBe(1);
  });
});

// ---- Bolts, nodes and the discharge --------------------------------------

describe("bolts and the field", () => {
  it("clears an inert node and de-energizes a charged one", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 15, 0));
    h.pose((s, d) => d.setNode(s, 12, 15, 2));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    h.pose((s, d) => d.addBolt(s, tileCX(12), tileCY(17)));
    await h.advance(0.2);
    expect(chargeAt(10, 15)).toBeNull();
    expect(chargeAt(12, 15)).toBe(1);
  });

  it("resolves against exactly one thing and leaves flight", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 15, 0));
    h.pose((s, d) => d.setNode(s, 10, 13, 0));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(chargeAt(10, 15)).toBeNull();
    expect(chargeAt(10, 13)).toBe(0);
    expect(h.snapshot().bolts).toHaveLength(0);
  });

  it("resolves against the segment where a segment and a node share a tile", async () => {
    startPlaying();
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.setNode(s, 10, 15, 2));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(h.snapshot().worms).toHaveLength(0);
    expect(chargeAt(10, 15)).toBe(2);
  });

  it("leaves a fresh inert node where a bolt killed a segment", async () => {
    startPlaying();
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(chargeAt(10, 15)).toBe(0);
  });

  it("shortens a worm on an end hit, one segment at a time", async () => {
    startPlaying();
    const id = poseWorm(12, 15, 3);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.setScore(s, 0));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(worm(id)?.segments).toEqual([
      { c: 12, r: 15 },
      { c: 11, r: 15 },
    ]);
    expect(h.snapshot().score).toBe(SCORE_BODY);
  });

  it("splits a worm shot through the middle and keeps the head's id", async () => {
    startPlaying();
    const id = poseWorm(12, 15, 5);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    const snap = h.snapshot();
    expect(snap.worms).toHaveLength(2);
    expect(snap.worms[0]?.id).toBe(id);
    expect(snap.worms[0]?.segments).toEqual([
      { c: 12, r: 15 },
      { c: 11, r: 15 },
    ]);
    expect(snap.worms[1]?.id).not.toBe(id);
    expect(snap.worms[1]?.segments).toEqual([
      { c: 9, r: 15 },
      { c: 8, r: 15 },
    ]);
  });

  it("vanishes at the top of the board", async () => {
    startPlaying();
    h.pose((s, d) => d.addBolt(s, 400, 700));
    await h.advance(1);
    expect(h.snapshot().bolts).toHaveLength(0);
  });

  it("climbs at its stated speed", async () => {
    startPlaying();
    h.pose((s, d) => d.addBolt(s, 400, 700));
    await h.advance(0.2);
    expect(h.snapshot().bolts[0]?.y).toBeCloseTo(700 - BOLT_SPEED * 0.2, 3);
  });

  it("detonates a critical node and chains through the cluster", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 12, 3));
    h.pose((s, d) => d.setNode(s, 12, 10, 1));
    h.pose((s, d) => d.setNode(s, 20, 10, 1));
    h.pose((s, d) => d.setNode(s, 11, 11, 0));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(15)));
    await h.advance(0.2);
    expect(chargeAt(10, 12)).toBeNull();
    expect(chargeAt(12, 10)).toBeNull();
    expect(chargeAt(20, 10)).toBe(1);
    // An inert node inside the blast stands, and does not conduct.
    expect(chargeAt(11, 11)).toBe(0);
  });

  it("reports one arc per conducted link, for the arc's life", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 12, 3));
    h.pose((s, d) => d.setNode(s, 12, 10, 1));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(15)));
    await h.advance(0.12);
    const arcs = h.snapshot().arcs;
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toEqual({ from: { c: 10, r: 12 }, to: { c: 12, r: 10 } });
    await h.advance(ARC_LIFE);
    expect(h.snapshot().arcs).toHaveLength(0);
  });

  it("fries the segments in reach and leaves nothing behind", async () => {
    startPlaying();
    const near = poseWorm(11, 11, 1);
    const far = poseWorm(10, 8, 1);
    h.pose((s, d) => d.setWormStepping(s, near, false));
    h.pose((s, d) => d.setWormStepping(s, far, false));
    h.pose((s, d) => d.setNode(s, 10, 12, 3));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(15)));
    await h.advance(0.2);
    expect(worm(near)).toBeUndefined();
    expect(worm(far)).toBeDefined();
    expect(chargeAt(11, 11)).toBeNull();
  });
});

// ---- The cursor ----------------------------------------------------------

describe("the cursor", () => {
  it("travels at its stated rate and stays in the band", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursor(s, 400, 688));
    h.hold("ArrowRight");
    await h.advance(1);
    h.release("ArrowRight");
    expect(h.snapshot().cursor.x).toBeCloseTo(400 + CURSOR_SPEED, 0);
  });

  it("splits the rate across a held diagonal", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursor(s, 400, 688));
    h.hold("ArrowRight");
    h.hold("ArrowUp");
    await h.advance(1);
    h.release("ArrowRight");
    h.release("ArrowUp");
    const moved = h.snapshot().cursor.x - 400;
    expect(moved).toBeGreaterThan((CURSOR_SPEED / Math.SQRT2) * 0.95);
    expect(moved).toBeLessThan((CURSOR_SPEED / Math.SQRT2) * 1.05);
  });

  it("rests exactly on each bound a movement is held against", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursor(s, CURSOR_X_MIN + 120, CURSOR_Y_MAX));
    h.hold("KeyA");
    h.hold("KeyW");
    await h.advance(1);
    h.release("KeyA");
    h.release("KeyW");
    expect(h.snapshot().cursor.x).toBeCloseTo(CURSOR_X_MIN, 6);
    expect(h.snapshot().cursor.y).toBeCloseTo(CURSOR_Y_MIN, 6);

    h.hold("KeyD");
    h.hold("KeyS");
    await h.advance(6);
    h.release("KeyD");
    h.release("KeyS");
    expect(h.snapshot().cursor.x).toBeCloseTo(CURSOR_X_MAX, 6);
    expect(h.snapshot().cursor.y).toBeCloseTo(CURSOR_Y_MAX, 6);
  });

  it("fires on its interval, up to the cap in flight", async () => {
    startPlaying();
    h.hold("Space");
    await h.advance(FIRE_INTERVAL * 0.5);
    expect(h.snapshot().bolts).toHaveLength(1);
    await h.advance(FIRE_INTERVAL);
    expect(h.snapshot().bolts).toHaveLength(2);
    await h.advance(FIRE_INTERVAL * 4);
    h.release("Space");
    expect(h.snapshot().bolts.length).toBeLessThanOrEqual(MAX_BOLTS);
  });

  it("costs a life on contact, and none while invulnerable", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursorContact(s, true));
    h.pose((s, d) => d.setLives(s, 3));
    h.pose((s, d) => d.setCursor(s, tileCX(20), BAND_CENTER_Y));
    const id = poseWorm(20, 19, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.setCursorInvulnerable(s, 1));
    await h.advance(0.1);
    expect(h.snapshot().lives).toBe(3);

    h.pose((s, d) => d.setCursorInvulnerable(s, 0));
    await h.advance(0.1);
    expect(h.snapshot().lives).toBe(2);
    expect(h.snapshot().phase).toBe("respawn");
  });
});

// ---- The foes ------------------------------------------------------------

describe("the foes", () => {
  it("lets a glitch eat the node under it with no motion at all", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 10, 3));
    h.pose((s, d) => d.addFoe(s, "glitch", tileCX(10), tileCY(10)));
    const id = last(h.snapshot().foes).id;
    h.pose((s, d) => d.setFoeTravel(s, id, false));
    await h.advance(0.05);
    expect(chargeAt(10, 10)).toBeNull();
    // A critical node eaten this way sets off no discharge.
    expect(h.snapshot().arcs).toHaveLength(0);
  });

  it("leaves the field alone with a glitch's mind off", async () => {
    startPlaying();
    for (let c = 4; c < 12; c++) h.pose((s, d) => d.setNode(s, c, 10, 0));
    h.pose((s, d) => d.addFoe(s, "glitch", tileCX(4), tileCY(10)));
    const id = last(h.snapshot().foes).id;
    h.pose((s, d) => d.setFoeMind(s, id, false));
    await h.advance(0.5);
    expect(h.snapshot().nodes).toHaveLength(8);
  });

  it("reverses a glitch's horizontal direction at each dart", async () => {
    startPlaying();
    h.pose((s, d) => d.addFoe(s, "glitch", 600, tileCY(10)));
    const id = last(h.snapshot().foes).id;
    const vx = (): number =>
      h.snapshot().foes.find((f) => f.id === id)?.vx as number;
    expect(vx()).toBeCloseTo(GLITCH_H_SPEED, 6);
    await h.advance(0.33);
    expect(vx()).toBeCloseTo(-GLITCH_H_SPEED, 6);
    await h.advance(0.32);
    expect(vx()).toBeCloseTo(GLITCH_H_SPEED, 6);
  });

  it("lays a node under a dropper on an empty tile alone", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 6, 2));
    h.pose((s, d) => d.addFoe(s, "dropper", tileCX(10), tileCY(4)));
    await h.advance(0.6);
    expect(chargeAt(10, 4)).toBe(0);
    expect(chargeAt(10, 6)).toBe(2);
  });

  it("speeds a dropper up on its first bolt and kills it on its second", async () => {
    startPlaying();
    h.pose((s, d) => d.addFoe(s, "dropper", tileCX(10), tileCY(4)));
    const id = last(h.snapshot().foes).id;
    h.pose((s, d) => d.setFoeTravel(s, id, false));
    h.pose((s, d) => d.setFoeMind(s, id, false));
    expect(h.snapshot().foes[0]?.vy).toBeCloseTo(DROPPER_SPEED, 6);

    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(8)));
    await h.advance(0.2);
    expect(h.snapshot().foes).toHaveLength(1);
    expect(h.snapshot().foes[0]?.hit).toBe(true);
    expect(h.snapshot().foes[0]?.vy).toBeCloseTo(DROPPER_SPEED_HIT, 6);

    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(8)));
    await h.advance(0.2);
    expect(h.snapshot().foes).toHaveLength(0);
  });

  it("slams the node under a corruptor to critical", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 3, 1));
    h.pose((s, d) => d.addFoe(s, "corruptor", tileCX(10), tileCY(3)));
    const id = last(h.snapshot().foes).id;
    h.pose((s, d) => d.setFoeTravel(s, id, false));
    await h.advance(0.05);
    expect(chargeAt(10, 3)).toBe(3);
  });

  it("keeps the level's foes away while foe spawning is off", async () => {
    startPlaying(5);
    await h.advance(60);
    expect(h.snapshot().foes).toHaveLength(0);

    h.pose((s, d) => d.setFoeSpawning(s, true));
    await h.advance(30);
    expect(h.snapshot().foes.length).toBeGreaterThan(0);
  });

  it("brings in no foe at level one", async () => {
    startPlaying(1);
    h.pose((s, d) => d.setFoeSpawning(s, true));
    await h.advance(60);
    expect(h.snapshot().foes).toHaveLength(0);
  });
});

// ---- The run -------------------------------------------------------------

describe("the run", () => {
  it("clears a level on the step that removes the last segment", async () => {
    startPlaying();
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.setScore(s, 0));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    const snap = h.snapshot();
    expect(snap.level).toBe(2);
    expect(snap.reachedLevel).toBe(2);
    expect(snap.phase).toBe("banner");
    expect(snap.score).toBe(SCORE_HEAD + SCORE_LEVEL_CLEAR * 1);
  });

  it("plays on over an empty board that never held a segment", async () => {
    startPlaying();
    await h.advance(5);
    const snap = h.snapshot();
    expect(snap.level).toBe(1);
    expect(snap.screen).toBe("playing");
    expect(snap.phase).toBe("active");
  });

  it("wins the run when level twelve is swept", async () => {
    startPlaying(TOTAL_LEVELS);
    h.pose((s, d) => d.setLives(s, 2));
    h.pose((s, d) => d.setScore(s, 0));
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(h.snapshot().screen).toBe("victory");
    expect(h.snapshot().score).toBe(
      SCORE_HEAD + SCORE_LEVEL_CLEAR * TOTAL_LEVELS + 250 * 2,
    );
  });

  it("respawns with the field standing and the cursor invulnerable", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursorContact(s, true));
    h.pose((s, d) => d.setNode(s, 5, 5, 2));
    h.pose((s, d) => d.setCursor(s, tileCX(20), BAND_CENTER_Y));
    const id = poseWorm(20, 19, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    await h.advance(0.05);
    expect(h.snapshot().phase).toBe("respawn");
    expect(h.snapshot().worms).toHaveLength(0);
    expect(chargeAt(5, 5)).toBe(2);
    expect(h.snapshot().cursor.x).toBeCloseTo(BAND_CENTER_X, 6);

    await h.advance(RESPAWN_TIME + 0.05);
    expect(h.snapshot().phase).toBe("active");
    expect(h.snapshot().cursor.invulnerable).toBeGreaterThan(
      RESPAWN_INVULN - 0.2,
    );
  });

  it("ends the run when a contact takes the lives to zero", async () => {
    startPlaying();
    h.pose((s, d) => d.setCursorContact(s, true));
    h.pose((s, d) => d.setLives(s, 1));
    h.pose((s, d) => d.setReachedLevel(s, 4));
    h.pose((s, d) => d.setCursor(s, tileCX(20), BAND_CENTER_Y));
    const id = poseWorm(20, 19, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    await h.advance(0.05);
    const snap = h.snapshot();
    expect(snap.screen).toBe("gameover");
    expect(snap.lives).toBe(0);
    expect(snap.reachedLevel).toBe(4);
  });

  it("grants a bonus life at every multiple the score crosses", async () => {
    startPlaying();
    h.pose((s, d) => d.setScore(s, 11_950));
    h.pose((s, d) => d.setLives(s, 3));
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(h.snapshot().lives).toBe(4);
  });
});

// ---- Screens, controls and audio -----------------------------------------

describe("the screens", () => {
  it("opens on the title with the first item highlighted", () => {
    const snap = h.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(0);
  });

  it("wraps the title menu at both ends and sounds each move", async () => {
    h.tap("ArrowUp");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(1);
    h.tap("ArrowDown");
    await h.frames(1);
    expect(h.snapshot().menuIndex).toBe(0);
    expect(h.cues.filter((cue) => cue.cue === "menu")).toHaveLength(2);
  });

  it("descends from the title and pauses back out of play", async () => {
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("playing");
    expect(h.snapshot().phase).toBe("banner");
    expect(h.snapshot().lives).toBe(START_LIVES);

    h.tap("KeyP");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("paused");

    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("playing");
  });

  it("freezes the board while paused", async () => {
    startPlaying();
    const id = poseWorm(20, 5, 1);
    h.pose((s, d) => d.setWormBody(s, id, false));
    h.pose((s, d) => d.setScreen(s, "paused"));
    await h.advance(1);
    expect(worm(id)?.segments[0]).toEqual({ c: 20, r: 5 });
  });

  it("reaches the how-to screen and comes back", async () => {
    h.tap("ArrowDown");
    await h.frames(1);
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
    // The return selects the entry it left from (specs/ui.md).
    expect(h.snapshot().menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("plays again and returns to the menu from an end screen", async () => {
    h.pose((s, d) => d.setScreen(s, "gameover"));
    h.pose((s, d) => d.setMenuIndex(s, 0));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("playing");
    expect(h.snapshot().level).toBe(1);

    h.pose((s, d) => d.setScreen(s, "victory"));
    h.pose((s, d) => d.setMenuIndex(s, 1));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");

    h.pose((s, d) => d.setScreen(s, "victory"));
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("does nothing to the title screen on back", async () => {
    h.tap("Escape");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });

  it("carries the field into the next level", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 4, 4, 2));
    h.pose((s, d) => d.setNode(s, 30, 9, 3));
    const id = poseWorm(10, 15, 1);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(h.snapshot().level).toBe(2);
    expect(chargeAt(4, 4)).toBe(2);
    expect(chargeAt(30, 9)).toBe(3);
  });

  it("lays a fresh scatter when a run opens", async () => {
    h.tap("Enter");
    await h.frames(1);
    const snap = h.snapshot();
    expect(snap.nodes.length).toBeGreaterThanOrEqual(68);
    expect(snap.nodes.length).toBeLessThanOrEqual(102);
    expect(snap.nodes.every((node) => node.charge === 0)).toBe(true);
    expect(snap.nodes.every((node) => node.r >= 1 && node.r <= 17)).toBe(true);
  });

  it("restarts and quits from the pause menu", async () => {
    startPlaying(5);
    h.pose((s, d) => d.setScore(s, 500));
    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setMenuIndex(s, 1));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("playing");
    expect(h.snapshot().level).toBe(1);
    expect(h.snapshot().score).toBe(0);

    h.pose((s, d) => d.setScreen(s, "paused"));
    h.pose((s, d) => d.setMenuIndex(s, 2));
    h.tap("Enter");
    await h.frames(1);
    expect(h.snapshot().screen).toBe("title");
  });
});

describe("the controls", () => {
  it("drives every movement action from both of its keys", async () => {
    startPlaying();
    for (const [code, axis] of [
      ["ArrowLeft", -1],
      ["KeyA", -1],
      ["ArrowRight", 1],
      ["KeyD", 1],
    ] as const) {
      h.pose((s, d) => d.setCursor(s, 640, BAND_CENTER_Y));
      h.hold(code);
      await h.advance(0.2);
      h.release(code);
      const moved = h.snapshot().cursor.x - 640;
      expect(Math.sign(moved)).toBe(axis);
    }
  });

  it("fires from Space and mutes from M", async () => {
    startPlaying();
    h.hold("Space");
    await h.frames(1);
    h.release("Space");
    expect(h.snapshot().bolts).toHaveLength(1);

    expect(h.snapshot().muted).toBe(false);
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(true);
    h.tap("KeyM");
    await h.frames(1);
    expect(h.snapshot().muted).toBe(false);
  });
});

describe("the audio", () => {
  it("plays one cue per event on the frame it happens", async () => {
    startPlaying();
    const id = poseWorm(10, 15, 2);
    h.pose((s, d) => d.setWormStepping(s, id, false));
    h.cues.length = 0;
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(17)));
    await h.advance(0.2);
    expect(h.cues.map((cue) => cue.cue)).toContain("cut");
  });

  it("sounds a discharge and a foe's death under their own names", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 10, 12, 3));
    h.pose((s, d) => d.addFoe(s, "glitch", tileCX(20), tileCY(12)));
    const id = last(h.snapshot().foes).id;
    h.pose((s, d) => d.setFoeTravel(s, id, false));
    h.pose((s, d) => d.setFoeMind(s, id, false));
    h.cues.length = 0;
    h.pose((s, d) => d.addBolt(s, tileCX(10), tileCY(15)));
    h.pose((s, d) => d.addBolt(s, tileCX(20), tileCY(15)));
    await h.advance(0.2);
    const names = h.cues.map((cue) => cue.cue);
    expect(names).toContain("discharge");
    expect(names).toContain("foe");
    expect(h.snapshot().score).toBeGreaterThanOrEqual(SCORE_GLITCH);
  });

  it("silences every cue while muted", async () => {
    startPlaying();
    h.tap("KeyM");
    await h.frames(1);
    h.cues.length = 0;
    h.hold("Space");
    await h.advance(0.1);
    h.release("Space");
    const fired = h.cues.filter((cue) => cue.cue === "fire");
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((cue) => cue.gain === 0)).toBe(true);
  });
});

// ---- What the frame draws ------------------------------------------------

describe("the render", () => {
  it("asks the loader for every seeded frame under its own path", () => {
    expect(h.assetPaths).toContain("node/0.png");
    expect(h.assetPaths).toContain("worm/5.png");
    expect(h.assetPaths).toContain("cursor/0.png");
    expect(h.assetPaths).toContain("corruptor/3.png");
    expect(h.assetPaths).toHaveLength(21);
  });

  it("tints the player band apart from the board above it", async () => {
    startPlaying();
    await h.frames(1);
    const band = h.pixel(640, 700);
    const board = h.pixel(640, 400);
    const distance =
      Math.abs(band[0] - board[0]) +
      Math.abs(band[1] - board[1]) +
      Math.abs(band[2] - board[2]);
    expect(distance).toBeGreaterThan(8);
  });

  it("draws the four charge states apart from one another", async () => {
    startPlaying();
    for (let charge = 0; charge <= 3; charge++) {
      h.pose((s, d) => d.setNode(s, 4 + charge * 3, 8, charge));
    }
    await h.frames(1);
    const shades = [0, 1, 2, 3].map((charge) =>
      h
        .pixel(tileCX(4 + charge * 3), tileCY(8))
        .slice(0, 3)
        .join(","),
    );
    expect(new Set(shades).size).toBe(4);
  });

  it("draws a bolt apart from the board along its column", async () => {
    startPlaying();
    h.pose((s, d) => d.addBolt(s, tileCX(20), tileCY(8)));
    await h.frames(1);
    const flying = h.snapshot().bolts[0];
    expect(flying).toBeDefined();
    const bolt = h.pixel(flying?.x as number, flying?.y as number);
    const board = h.pixel(tileCX(24), flying?.y as number);
    expect(bolt.slice(0, 3).join(",")).not.toBe(board.slice(0, 3).join(","));
  });

  it("keeps play out of the HUD bar", async () => {
    startPlaying();
    h.pose((s, d) => d.setNode(s, 20, 0, 3));
    await h.frames(1);
    // Row 0 begins at y = 80, so the bar above it is the HUD's alone.
    const above = h.pixel(tileCX(20), 40);
    const node = h.pixel(tileCX(20), tileCY(0));
    expect(above.slice(0, 3).join(",")).not.toBe(node.slice(0, 3).join(","));
  });

  it("draws every screen without throwing", async () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      h.pose((s, d) => d.setScreen(s, screen));
      await h.frames(1);
    }
    expect(h.snapshot().screen).toBe("gameover");
  });
});
