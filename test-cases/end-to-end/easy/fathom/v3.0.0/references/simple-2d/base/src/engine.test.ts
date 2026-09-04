// Fathom under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` at the
// simulation's own rate — which makes a duration a tick count and the arithmetic
// asserted here the arithmetic the specification names. What is read back is the
// game's own state, the debug surface the game returned beside it, the engine's
// events, and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose on the surface takes a state and returns the next
// one and is driven through `engine.apply`; a reading is handed `engine.state`.
// `h.pose` and `h.snapshot` are those two moves, named.
//
// The seeded art cannot be fetched or decoded in this host, so every sheet frame
// is `null` here and the render falls back to the shapes it draws in code. That
// is deliberate: it is the same code path a browser with a missing file takes,
// and it keeps these checks about the game rather than about the art.

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
  ALERT_TIME,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  CUES,
  DEN_RELEASE_GAP,
  FLARE_RADIUS,
  FORAGER_SPEED,
  GLOAMFIN_CHASE_SPEED,
  GRID_COLS,
  GRID_ROWS,
  INK_COOLDOWN,
  INK_RADIUS,
  LAYOUT,
  PREDATOR_SPEED,
  SCORE_CLEAR,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
  SONAR_MARK_TIME,
  SONAR_RANGE_BASE,
  SONAR_WAVE_SPEED,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  TICK_HZ,
  TILE,
  VISION_MIN,
  type PredatorKind,
} from "./constants";
import { COUNTDOWN_TIME } from "./flow";
import {
  BACKGROUND,
  game,
  type FathomDebugApi,
  type FathomSnapshot,
  type FathomState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

// ---- The harness --------------------------------------------------------

/** One tick, in milliseconds: the clock runs at the simulation's own rate. */
const TICK_MS = 1000 / TICK_HZ;

/** A duration in seconds, as a tick count. */
function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

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
  readonly engine: Engine<FathomState, FathomDebugApi>;
  readonly state: DeepReadonly<FathomState>;
  readonly debug: FathomDebugApi;
  pose(transition: (state: DeepReadonly<FathomState>) => FathomState): void;
  snapshot(): FathomSnapshot;
  readonly cues: CuePlay[];
  readonly assetPaths: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  advance(seconds: number): Promise<void>;
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
  const engine = createEngine<FathomState, FathomDebugApi>({
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
      engine.apply(transition);
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
      return [data[0], data[1], data[2], data[3]];
    },
    advance: (seconds) => engine.advance(ticks(seconds)),
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

// ---- Fixtures -----------------------------------------------------------

/** A board of rock with `inner` stamped in from row `top`. */
function board(inner: readonly string[], top: number): string[] {
  const rows: string[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) rows.push("#".repeat(GRID_COLS));
  inner.forEach((row, i) => {
    rows[top + i] = (row + "#".repeat(GRID_COLS)).slice(0, GRID_COLS);
  });
  return rows;
}

/** A single open hall, one tile high, clear of both borders. */
const HALL = `#${".".repeat(30)}${"#".repeat(5)}`;
const HALL_ROW = 6;

/** A hall with a den chamber under it, its single gate on the row between. */
function denBoard(): string[] {
  const rows: string[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) rows.push("#".repeat(GRID_COLS));
  rows[HALL_ROW] = HALL;
  rows[HALL_ROW + 1] = `${"#".repeat(17)}g${"#".repeat(GRID_COLS - 18)}`;
  rows[HALL_ROW + 2] = `${"#".repeat(15)}dddddd${"#".repeat(GRID_COLS - 21)}`;
  return rows;
}

/**
 * Live play on `rows`, in a world holding nothing but the forager at rest on
 * `(tx, ty)`.
 *
 * Every predator and every drifter is taken off the board, the plankton is
 * cleared and the fog is put back to unrevealed, so a check adds back exactly
 * what its requirement is about and nothing it did not ask for can move. Each
 * pose sets one thing, so the arrangement is spelled out here rather than
 * bundled into one operation.
 */
function poseBoard(rows: readonly string[], tx: number, ty: number): void {
  h.pose((s) => h.debug.setScreen(s, "playing"));
  h.pose((s) => h.debug.setMaze(s, rows));
  h.pose((s) => h.debug.clearPredators(s));
  h.pose((s) => h.debug.clearDrifters(s));
  h.pose((s) => h.debug.clearPlankton(s));
  h.pose((s) => h.debug.clearFog(s));
  h.pose((s) => h.debug.setForagerTile(s, tx, ty));
}

/** A plankton on every corridor tile of `rows`, as a fresh maze opens with. */
function stockPlankton(rows: readonly string[]): void {
  rows.forEach((row, ty) => {
    [...row].forEach((tile, tx) => {
      if (tile === ".") h.pose((s) => h.debug.setPlankton(s, tx, ty, true));
    });
  });
}

/** The center of tile `(tx, ty)`, in logical units. */
function center(tx: number, ty: number): [number, number] {
  return [64 + tx * TILE + TILE / 2, 80 + ty * TILE + TILE / 2];
}

/** How bright a pixel reads, on the same 0-255 scale its channels are on. */
function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---- The build's own wiring ---------------------------------------------

describe("the wiring the engine expects", () => {
  it("returns the debug surface beside the opening state", () => {
    expect(h.debug.version).toBe(1);
    const snapshot = h.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.lives).toBe(START_LIVES);
    expect(snapshot.depth).toBe(1);
    expect(snapshot.brightHold).toBe(0);
    // Every creature opens with its own mind and its own travel running.
    expect(snapshot.predators.every((p) => p.mind)).toBe(true);
    expect(snapshot.predators.every((p) => p.travel)).toBe(true);
    // The plankton layer and the count it carries are the same fact.
    const stocked = snapshot.plankton.join("").split("*").length - 1;
    expect(stocked).toBe(snapshot.planktonRemaining);
  });

  it("asks its loader for every frame of every seeded sheet", () => {
    const wanted = [
      ...Array.from({ length: 8 }, (_, i) => `glimmerfin/${i}.png`),
      ...Array.from({ length: 16 }, (_, i) => `lanternjaw/${i}.png`),
      ...Array.from({ length: 8 }, (_, i) => `gloamfin/${i}.png`),
      ...Array.from({ length: 8 }, (_, i) => `flarefish/${i}.png`),
      ...Array.from({ length: 8 }, (_, i) => `drifter/${i}.png`),
      ...Array.from({ length: 8 }, (_, i) => `flare-bloom/${i}.png`),
      ...Array.from({ length: 19 }, (_, i) => `trench-walls/${i}.png`),
    ];
    expect([...h.assetPaths].sort()).toEqual([...wanted].sort());
  });

  it("plays a named cue for each of the events that raise one", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    stockPlankton(board([HALL], HALL_ROW));
    h.tap("Space");
    await h.advance(0.05);
    h.tap("ShiftLeft");
    await h.advance(0.05);
    const played = h.cues.map((play) => play.cue);
    expect(played).toContain(CUES.sonar);
    expect(played).toContain(CUES.ink);
    expect(played).toContain(CUES.eat);
  });

  it("mirrors the engine's mute bit into the state from any screen", async () => {
    h.tap("KeyM");
    await h.advance(TICK_MS / 1000);
    expect(h.snapshot().muted).toBe(true);
    // A muted cue still reports itself, at no gain.
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.tap("Space");
    await h.advance(0.05);
    const sonar = h.cues.filter((play) => play.cue === CUES.sonar);
    expect(sonar.length).toBe(1);
    expect(sonar[0].gain).toBe(0);
  });
});

// ---- The screens --------------------------------------------------------

describe("the screens", () => {
  it("walks the title menu into a dive with the keyboard alone", async () => {
    // One press moves the selection or accepts it, so each is its own frame.
    h.tap("ArrowDown");
    await h.advance(0.05);
    expect(h.snapshot().screen).toBe("title");

    h.tap("Enter");
    await h.advance(0.05);
    expect(h.snapshot().screen).toBe("howto");

    h.tap("Escape");
    await h.advance(0.05);
    expect(h.snapshot().screen).toBe("title");
    // The return lands on the entry the player left the title by, which
    // confirming HOW TO PLAY recorded (`specs/ui.md`).
    expect(h.snapshot().menuIndex).toBe(1);
    expect(h.snapshot().titleIndex).toBe(1);

    h.tap("ArrowUp");
    await h.advance(0.05);
    h.tap("Enter");
    await h.advance(0.05);
    expect(h.snapshot().screen).toBe("countdown");

    await h.advance(COUNTDOWN_TIME);
    expect(h.snapshot().screen).toBe("playing");
  });

  it("pauses live play over a frozen maze and resumes where it left off", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.hold("ArrowRight");
    await h.advance(0.5);
    const moving = h.snapshot().forager.x;

    h.tap("KeyP");
    await h.advance(0.5);
    const paused = h.snapshot();
    expect(paused.screen).toBe("paused");
    expect(paused.forager.x).toBe(moving);
    // `simTime` accumulates on every screen, the paused screen included.
    expect(paused.simTime).toBeGreaterThan(0.5);

    h.tap("Escape");
    await h.advance(0.25);
    const resumed = h.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.forager.x).toBeGreaterThan(moving);
  });

  it("holds the den shut for the whole countdown", async () => {
    // A dive as it opens: the depth-1 roster in the den, and the countdown
    // running. The schedule is timed from live play alone, so it counts against
    // nothing here.
    h.pose((s) => h.debug.reset(s));
    h.pose((s) => h.debug.setScreen(s, "countdown"));
    await h.advance(COUNTDOWN_TIME * 0.9);
    const waiting = h.snapshot();
    expect(waiting.screen).toBe("countdown");
    expect(waiting.predators.every((p) => !p.released)).toBe(true);
    // The forager's light still falls on the maze around it while it holds.
    expect(waiting.visibility.join("")).toContain("l");
  });
});

// ---- The forager --------------------------------------------------------

describe("the forager", () => {
  it("travels at FORAGER_SPEED while a movement action is held", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    const [x0] = center(5, HALL_ROW);
    h.hold("ArrowRight");
    await h.advance(1);
    const moved = h.snapshot().forager;
    expect(moved.moving).toBe(true);
    expect(moved.x - x0).toBeCloseTo(FORAGER_SPEED, 0);

    h.release("ArrowRight");
    await h.advance(0.5);
    const rested = h.snapshot().forager;
    expect(rested.moving).toBe(false);
    expect(rested.x).toBeCloseTo(moved.x, 5);
  });

  it("turns onto a perpendicular direction at a tile center", async () => {
    // A cross: one long hall with a shaft leading up out of column 10.
    const rows = board([HALL], HALL_ROW);
    for (let ty = HALL_ROW - 3; ty < HALL_ROW; ty++) {
      rows[ty] = `${rows[ty].slice(0, 10)}.${rows[ty].slice(11)}`;
    }
    poseBoard(rows, 6, HALL_ROW);
    h.hold("ArrowRight");
    await h.advance(0.5);
    h.release("ArrowRight");
    h.hold("ArrowUp");
    await h.advance(1.5);
    const turned = h.snapshot().forager;
    expect(turned.tx).toBe(10);
    expect(turned.ty).toBeLessThan(HALL_ROW);
    expect(turned.dir).toBe("up");
  });

  it("eats a plankton on its own tile, brightens, and scores", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setPlankton(s, 6, HALL_ROW, true));
    // A second plankton the forager never reaches, so eating the first is a
    // mouthful rather than the one that clears the maze.
    h.pose((s) => h.debug.setPlankton(s, 25, HALL_ROW, true));
    h.hold("ArrowRight");
    await h.advance(0.3);
    const eaten = h.snapshot();
    expect(eaten.score).toBe(SCORE_PLANKTON);
    expect(eaten.planktonRemaining).toBe(1);
    expect(eaten.brightness).toBeCloseTo(BRIGHT_PER_EAT, 5);
    // The hold keeps `G` steady for its full second before any decay.
    h.release("ArrowRight");
    await h.advance(BRIGHT_HOLD / 2);
    expect(h.snapshot().brightness).toBeCloseTo(BRIGHT_PER_EAT, 5);
    await h.advance(BRIGHT_HOLD);
    expect(h.snapshot().brightness).toBeLessThan(BRIGHT_PER_EAT);
  });

  it("crosses the wrap tunnel as one ordinary step", async () => {
    // A row pierced at both borders is the tunnel a posed layout reports.
    poseBoard(board([".".repeat(GRID_COLS)], HALL_ROW), 0, HALL_ROW);
    const [left] = center(0, HALL_ROW);
    const [right] = center(GRID_COLS - 1, HALL_ROW);
    h.hold("ArrowLeft");
    // One tile of travel takes it from one mouth's center to the other's.
    await h.advance(TILE / FORAGER_SPEED);
    const crossed = h.snapshot().forager;
    expect(crossed.tx).toBe(GRID_COLS - 1);
    expect(crossed.x).toBeCloseTo(right, 3);
    expect(crossed.x).toBeGreaterThan(left);
    expect(crossed.x).toBeLessThanOrEqual(64 + GRID_COLS * TILE);
  });
});

// ---- Sensing ------------------------------------------------------------

describe("sensing the dark", () => {
  it("lights a pocket of the maze around the forager and remembers it", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setBrightness(s, 0));
    await h.advance(0.05);
    const near = h.snapshot();
    // V is 96 at G = 0, so the three tiles either side are lit and the fifth is not.
    expect(near.visionRadius).toBe(VISION_MIN);
    expect(near.visibility[HALL_ROW][5]).toBe("l");
    expect(near.visibility[HALL_ROW][8]).toBe("l");
    expect(near.visibility[HALL_ROW][10]).toBe("u");

    h.pose((s) => h.debug.setForagerTile(s, 12, HALL_ROW));
    await h.advance(0.05);
    const away = h.snapshot();
    // What the light has left is remembered rather than forgotten.
    expect(away.visibility[HALL_ROW][5]).toBe("r");
    expect(away.visibility[HALL_ROW][12]).toBe("l");
  });

  it("floods the corridors with a sonar wavefront at the stated speed", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.tap("Space");
    await h.advance(0.05);
    const cast = h.snapshot();
    expect(cast.pulses.length).toBe(1);
    expect(cast.pulses[0].source).toBe("forager");
    expect(cast.pulses[0].tint).toBe("cyan");
    expect(cast.pulses[0].range).toBe(SONAR_RANGE_BASE);
    expect(cast.sonar.ready).toBe(false);
    expect(cast.sonar.cooldown).toBeCloseTo(SONAR_COOLDOWN - 0.05, 2);

    await h.advance(0.45);
    const traveled = h.snapshot();
    expect(traveled.pulses[0].front).toBeCloseTo(SONAR_WAVE_SPEED * 0.5, 1);
    // The front reveals the corridor as it arrives, near tiles before far ones.
    expect(traveled.visibility[HALL_ROW][11]).not.toBe("u");
    expect(traveled.visibility[HALL_ROW][20]).toBe("u");

    await h.advance(SONAR_RANGE_BASE / SONAR_WAVE_SPEED);
    const spent = h.snapshot();
    expect(spent.pulses.length).toBe(0);
    expect(spent.visibility[HALL_ROW][14]).not.toBe("u");
  });

  it("marks a Gloamfin the front reaches and hands it a fix", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 10, HALL_ROW));
    expect(h.snapshot().predators[0].kind).toBe("gloamfin");
    expect(h.snapshot().predators[0].state).toBe("wander");
    h.tap("Space");

    // The Gloamfin patrols while the front travels, so the window is watched
    // rather than one tick of it sampled. It stays well inside the pulse's
    // range wherever its patrol takes it in that time.
    let alerted = false;
    let marked = false;
    let chaseSpeed = 0;
    for (let i = 0; i < 24; i++) {
      await h.advance(0.05);
      const p = h.snapshot().predators[0];
      alerted ||= p.alert;
      marked ||= p.lit;
      if (p.state === "chase") {
        chaseSpeed = p.speed;
        break;
      }
    }
    expect(chaseSpeed).toBeCloseTo(GLOAMFIN_CHASE_SPEED, 0);
    expect(alerted).toBe(true);
    expect(marked).toBe(true);

    // The mark and the alert are consequences rather than decisions, so they run
    // out on their own windows with the hunter held exactly where it stands.
    h.pose((s) => h.debug.setPredatorMind(s, 0, false));
    await h.advance(SONAR_MARK_TIME + ALERT_TIME);
    expect(h.snapshot().predators[0].alert).toBe(false);
  });

  it("blinds a Lanternjaw with ink", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    // A brightness the hold keeps steady, which is the pair eating a plankton
    // arms, so the Lanternjaw's sense of the light does not fade under it.
    h.pose((s) => h.debug.setBrightness(s, 1));
    h.pose((s) => h.debug.setBrightHold(s, BRIGHT_HOLD));
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 9, HALL_ROW));
    await h.advance(0.05);
    expect(h.snapshot().predators[0].state).toBe("chase");

    h.tap("ShiftLeft");
    await h.advance(0.05);
    const inked = h.snapshot();
    expect(inked.inkClouds.length).toBe(1);
    expect(inked.inkClouds[0].radius).toBe(INK_RADIUS);
    expect(inked.ink.ready).toBe(false);
    expect(inked.ink.cooldown).toBeCloseTo(INK_COOLDOWN - 0.05, 2);
    // The cloud lies on the line between the two, so the fix drops at once.
    expect(inked.predators[0].state).toBe("wander");
  });
});

// ---- The predators ------------------------------------------------------

describe("the predators", () => {
  it("releases the den on the staggered schedule, from the moment play begins", async () => {
    // A dive as it opens: the depth-1 roster in the den, waiting its slots.
    h.pose((s) => h.debug.reset(s));
    h.pose((s) => h.debug.setScreen(s, "countdown"));
    await h.advance(COUNTDOWN_TIME * 0.9);
    expect(h.snapshot().predators.map((p) => p.released)).toEqual([
      false,
      false,
      false,
    ]);

    // The schedule runs on live play alone, so its origin is the moment `screen`
    // becomes `"playing"` and the countdown counted against nothing.
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.advance(TICK_MS / 1000);
    expect(h.snapshot().predators[0].released).toBe(true);
    expect(h.snapshot().predators[1].released).toBe(false);
    expect(h.snapshot().predators[0].state).toBe("den");

    await h.advance(DEN_RELEASE_GAP);
    expect(h.snapshot().predators[1].released).toBe(true);
    expect(h.snapshot().predators[2].released).toBe(false);

    await h.advance(DEN_RELEASE_GAP);
    expect(h.snapshot().predators[2].released).toBe(true);
  });

  it("holds a den predator out of play on a layout with no den chamber", async () => {
    // A predator standing in the den chamber, and then a layout that has no
    // chamber at all posed under it. `setMaze` sets the layout and nothing else,
    // so the predator keeps the tile it stands on, which is now rock.
    poseBoard(denBoard(), 1, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 5, HALL_ROW));
    h.pose((s) => h.debug.setPredatorTile(s, 0, 17, HALL_ROW + 2));
    h.pose((s) => h.debug.setPredatorState(s, 0, "den"));
    h.pose((s) => h.debug.setMaze(s, board([HALL], HALL_ROW)));

    const before = h.snapshot().predators[0];
    expect(before.released).toBe(true);
    await h.advance(DEN_RELEASE_GAP * 3);
    const held = h.snapshot().predators[0];
    expect(held.state).toBe("den");
    expect(held.tx).toBe(before.tx);
    expect(held.ty).toBe(before.ty);
    expect(held.lit).toBe(false);
    // Undrawn and out of play, it cannot cost a life, whatever tile it holds.
    expect(h.snapshot().lives).toBe(START_LIVES);
  });

  it("costs a life on contact and sets the maze up for another attempt", async () => {
    poseBoard(board([HALL], HALL_ROW), 10, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 14, HALL_ROW));
    h.pose((s) => h.debug.setPredatorState(s, 0, "chase"));
    const before = h.snapshot();
    expect(before.lives).toBe(START_LIVES);
    expect(before.predators[0].state).toBe("chase");

    await h.advance(3);
    const caught = h.snapshot();
    expect(caught.lives).toBe(START_LIVES - 1);
    expect(caught.screen).toBe("countdown");
    expect(caught.brightness).toBe(0);
    expect(caught.predators.every((p) => !p.released)).toBe(true);
    expect(h.cues.map((play) => play.cue)).toContain(CUES.caught);
  });

  it("rounds the rock between it and its fix", async () => {
    // A spine the hunter has to go around to reach the forager's row: two open
    // rows joined by one gap at column 6.
    const top = `#${".".repeat(6)}${"#".repeat(29)}`;
    const wall = `${"#".repeat(6)}.${"#".repeat(29)}`;
    const bottom = `#${".".repeat(6)}${"#".repeat(29)}`;
    poseBoard(board([top, wall, bottom], HALL_ROW), 1, HALL_ROW + 2);
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 1, HALL_ROW));
    h.pose((s) => h.debug.setPredatorState(s, 0, "chase"));

    const visited = new Set<string>();
    let reached = false;
    for (let i = 0; i < 60; i++) {
      await h.advance(0.05);
      const p = h.snapshot().predators[0];
      visited.add(`${p.tx},${p.ty}`);
      reached ||= p.ty === HALL_ROW + 2;
    }
    // Every tile it stood on was one it may enter, and it took the way around.
    const tiles = h.snapshot().tiles;
    for (const at of visited) {
      const [tx, ty] = at.split(",").map(Number);
      expect(tiles[ty][tx]).not.toBe("#");
    }
    expect(visited.has(`6,${HALL_ROW + 1}`)).toBe(true);
    expect(reached).toBe(true);
  });

  it("stays on a tile with no open neighbor", async () => {
    const top = `#${".".repeat(6)}${"#".repeat(29)}`;
    const boxed = `${"#".repeat(20)}.${"#".repeat(15)}`;
    poseBoard(board([top, boxed], HALL_ROW), 1, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 20, HALL_ROW + 1));
    const before = h.snapshot().predators[0];
    await h.advance(3);
    const after = h.snapshot().predators[0];
    expect(after.tx).toBe(before.tx);
    expect(after.ty).toBe(before.ty);
  });

  it("holds one predator where it stands and leaves the rest hunting", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 12, HALL_ROW));
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 25, HALL_ROW));
    h.pose((s) => h.debug.setPredatorMind(s, 0, false));

    const before = h.snapshot();
    expect(before.predators[0].mind).toBe(false);
    expect(before.predators[1].mind).toBe(true);
    await h.advance(3);
    const after = h.snapshot();
    expect(after.predators[0].mind).toBe(false);
    expect(after.predators[0].x).toBe(before.predators[0].x);
    expect(after.predators[0].dir).toBe(before.predators[0].dir);
    expect(after.predators[0].state).toBe("wander");
    // The predator beside it, with its mind on, carries on patrolling.
    expect(after.predators[1].x).not.toBe(before.predators[1].x);
    // Everything else continues: the cooldowns still run down.
    h.pose((s) => h.debug.setSonarCooldown(s, 1));
    await h.advance(0.5);
    expect(h.snapshot().sonar.cooldown).toBeCloseTo(0.5, 2);
  });

  it("holds one drifter where it stands and leaves the rest wandering", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.spawnDrifter(s, 20, HALL_ROW));
    h.pose((s) => h.debug.spawnDrifter(s, 28, HALL_ROW));
    h.pose((s) => h.debug.setDrifterMind(s, 0, false));

    const before = h.snapshot();
    expect(before.drifters[0].mind).toBe(false);
    expect(before.drifters[1].mind).toBe(true);
    await h.advance(3);
    const after = h.snapshot();
    expect(after.drifters[0].x).toBe(before.drifters[0].x);
    expect(after.drifters[0].y).toBe(before.drifters[0].y);
    expect(after.drifters[1].x).not.toBe(before.drifters[1].x);
  });

  it("runs a held predator's senses while its body holds its tile", async () => {
    // A brightness the hold keeps steady, so the Lanternjaw's sense of the light
    // does not fade under the check.
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setBrightness(s, 1));
    h.pose((s) => h.debug.setBrightHold(s, BRIGHT_HOLD));
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 9, HALL_ROW));
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 20, HALL_ROW));
    h.pose((s) => h.debug.setPredatorTravel(s, 0, false));

    const before = h.snapshot();
    expect(before.predators[0].travel).toBe(false);
    expect(before.predators[1].travel).toBe(true);
    expect(before.predators[0].state).toBe("wander");
    await h.advance(0.5);

    const after = h.snapshot();
    // Its mind ran in full: it saw the light, took the fix, and reports the rate
    // its state carries.
    expect(after.predators[0].state).toBe("chase");
    expect(after.predators[0].speed).toBeCloseTo(PREDATOR_SPEED, 0);
    // Its body held the tile it stood on.
    expect(after.predators[0].x).toBe(before.predators[0].x);
    expect(after.predators[0].y).toBe(before.predators[0].y);
    expect(after.predators[0].tx).toBe(9);
    // The hunter beside it, its travel running, closes on the forager.
    expect(after.predators[1].x).toBeLessThan(before.predators[1].x);
  });

  it("fires a held Gloamfin's alert and hands it a fix", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 10, HALL_ROW));
    h.pose((s) => h.debug.setPredatorTravel(s, 0, false));
    const before = h.snapshot().predators[0];

    // The front covers the five tiles between them in well under the window the
    // alert stays open for.
    h.tap("Space");
    await h.advance(0.5);

    const held = h.snapshot().predators[0];
    expect(held.state).toBe("chase");
    expect(held.alert).toBe(true);
    expect(held.speed).toBeCloseTo(GLOAMFIN_CHASE_SPEED, 0);
    expect(held.x).toBe(before.x);
    expect(held.y).toBe(before.y);
  });

  it("keeps a held predator in the den its slot let it out of", async () => {
    poseBoard(denBoard(), 1, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 5, HALL_ROW));
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 5, HALL_ROW));
    h.pose((s) => h.debug.setPredatorTile(s, 0, 17, HALL_ROW + 2));
    h.pose((s) => h.debug.setPredatorTile(s, 1, 18, HALL_ROW + 2));
    h.pose((s) => h.debug.setPredatorState(s, 0, "den"));
    h.pose((s) => h.debug.setPredatorState(s, 1, "den"));
    h.pose((s) => h.debug.setPredatorTravel(s, 0, false));

    const before = h.snapshot().predators[0];
    expect(before.released).toBe(true);
    await h.advance(3);

    // Crossing the chamber to the gate is travel, so a held predator whose slot
    // has come stays in the chamber.
    const held = h.snapshot().predators[0];
    expect(held.state).toBe("den");
    expect(held.x).toBe(before.x);
    expect(held.y).toBe(before.y);
    // The one beside it, its travel running, swims out of the same chamber.
    expect(h.snapshot().predators[1].state).toBe("wander");
  });

  it("holds one drifter's body and leaves the rest wandering", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.spawnDrifter(s, 20, HALL_ROW));
    h.pose((s) => h.debug.spawnDrifter(s, 28, HALL_ROW));
    h.pose((s) => h.debug.setDrifterTravel(s, 0, false));

    const before = h.snapshot();
    expect(before.drifters[0].travel).toBe(false);
    expect(before.drifters[1].travel).toBe(true);
    await h.advance(3);
    const after = h.snapshot();
    expect(after.drifters[0].mind).toBe(true);
    expect(after.drifters[0].x).toBe(before.drifters[0].x);
    expect(after.drifters[0].y).toBe(before.drifters[0].y);
    expect(after.drifters[1].x).not.toBe(before.drifters[1].x);
  });

  it("takes every predator off the board and adds back only what is asked for", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    expect(h.snapshot().predators).toEqual([]);

    h.pose((s) => h.debug.addPredator(s, "flarefish", 20, HALL_ROW));
    const roster = h.snapshot().predators;
    expect(roster.length).toBe(1);
    expect(roster[0].kind).toBe("flarefish");
    expect(roster[0].state).toBe("wander");
    expect(roster[0].released).toBe(true);
    expect(roster[0].mind).toBe(true);
    expect(roster[0].dir).toBe("up");
    expect(roster[0].tx).toBe(20);

    // A second one goes at the end of the list, so an index is stable.
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 24, HALL_ROW));
    expect(h.snapshot().predators.map((p) => p.kind)).toEqual([
      "flarefish",
      "gloamfin",
    ]);

    // With an empty roster no release schedule runs, because there is nobody
    // left to run one.
    h.pose((s) => h.debug.clearPredators(s));
    await h.advance(DEN_RELEASE_GAP * 3);
    expect(h.snapshot().predators).toEqual([]);
  });

  it("poses the released flag without moving the predator or its state", () => {
    poseBoard(denBoard(), 1, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 5, HALL_ROW));
    h.pose((s) => h.debug.setPredatorTile(s, 0, 17, HALL_ROW + 2));
    h.pose((s) => h.debug.setPredatorState(s, 0, "den"));
    const before = h.snapshot().predators[0];

    h.pose((s) => h.debug.setPredatorReleased(s, 0, false));
    const waiting = h.snapshot().predators[0];
    expect(waiting.released).toBe(false);
    expect(waiting.state).toBe("den");
    expect(waiting.tx).toBe(before.tx);
    expect(waiting.ty).toBe(before.ty);

    h.pose((s) => h.debug.setPredatorReleased(s, 0, true));
    expect(h.snapshot().predators[0].released).toBe(true);
    expect(h.snapshot().predators[0].state).toBe("den");
  });
});

// ---- The run ------------------------------------------------------------

describe("the run", () => {
  it("scores a bonus drifter the forager swims onto", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.spawnDrifter(s, 8, HALL_ROW));
    // Held where it was put, so the forager meets it rather than chasing it.
    h.pose((s) => h.debug.setDrifterMind(s, 0, false));
    h.hold("ArrowRight");
    await h.advance(1);
    const eaten = h.snapshot();
    expect(eaten.drifters.length).toBe(0);
    expect(eaten.score).toBe(SCORE_DRIFTER);
  });

  it("clears the maze on the last plankton and descends a depth", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    // An emptied maze the forager has not just eaten from stays in live play.
    await h.advance(0.5);
    expect(h.snapshot().screen).toBe("playing");

    h.pose((s) => h.debug.setPlankton(s, 6, HALL_ROW, true));
    h.hold("ArrowRight");
    await h.advance(0.3);
    const cleared = h.snapshot();
    expect(cleared.screen).toBe("cleared");
    expect(cleared.score).toBe(SCORE_PLANKTON + SCORE_CLEAR);
    expect(h.cues.map((play) => play.cue)).toContain(CUES.descend);

    await h.advance(3);
    const next = h.snapshot();
    expect(next.depth).toBe(2);
    expect(next.screen).toBe("countdown");
    expect(next.planktonRemaining).toBeGreaterThan(0);
    // The next maze's fog opens fully unrevealed.
    expect(next.visibility.join("")).not.toContain("r");
  });

  it("ends the run when contact costs the last life", async () => {
    poseBoard(board([HALL], HALL_ROW), 10, HALL_ROW);
    h.pose((s) => h.debug.setLives(s, 0));
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 12, HALL_ROW));
    h.pose((s) => h.debug.setPredatorState(s, 0, "chase"));
    await h.advance(3);
    const over = h.snapshot();
    expect(over.screen).toBe("gameover");
    expect(over.lives).toBe(0);
  });

  it("reaches the same state from the same seed and the same calls", async () => {
    const run = async (): Promise<FathomSnapshot> => {
      h.pose((s) => h.debug.reset(s, 4242));
      h.pose((s) => h.debug.setScreen(s, "playing"));
      h.hold("ArrowRight");
      await h.advance(6);
      h.release("ArrowRight");
      return h.snapshot();
    };
    const first = await run();
    const second = await run();
    expect({ ...second, simTime: 0 }).toEqual({ ...first, simTime: 0 });
  });
});

// ---- The rendering ------------------------------------------------------

describe("the rendering", () => {
  it("draws an unrevealed tile as flat darkness", async () => {
    h.pose((s) => h.debug.reset(s, 9));
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.advance(0.25);
    const shown = h.snapshot();

    let brightest = 0;
    for (let ty = 0; ty < GRID_ROWS; ty++) {
      for (let tx = 0; tx < GRID_COLS; tx++) {
        if (shown.visibility[ty][tx] !== "u") continue;
        brightest = Math.max(brightest, luminance(h.pixel(...center(tx, ty))));
      }
    }
    // No brighter than a tenth of full brightness, however close the light passes.
    expect(brightest).toBeLessThanOrEqual(25.5);
  });

  it("tells rock from open water where the maze is revealed", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    await h.advance(0.25);
    const floor = luminance(h.pixel(...center(6, HALL_ROW)));
    const rock = luminance(h.pixel(...center(6, HALL_ROW - 1)));
    expect(rock).toBeGreaterThan(floor);
    expect(Math.abs(rock - floor)).toBeGreaterThan(4);
  });

  it("draws the forager, and the HUD outside the fog", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    await h.advance(0.25);
    const forager = h.pixel(...center(5, HALL_ROW));
    expect(luminance(forager)).toBeGreaterThan(60);

    // The score sits in the strip above the maze region, always fully lit.
    let hud = 0;
    for (let x = 40; x < 200; x += 2) {
      hud = Math.max(hud, luminance(h.pixel(x, 40)));
    }
    expect(hud).toBeGreaterThan(120);
  });

  it("draws an ink cloud darker than the water it stands in", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    await h.advance(0.25);
    const before = luminance(h.pixel(...center(7, HALL_ROW)));
    h.tap("ShiftLeft");
    await h.advance(0.25);
    const after = luminance(h.pixel(...center(7, HALL_ROW)));
    expect(after).toBeLessThan(before);
  });

  it("draws every screen without touching the state", async () => {
    // A grazed board with nothing on it but the forager, so the only thing that
    // could move the score or the lives is the render itself. Each screen is
    // entered fresh, so the two timed ones still have their own time to run and
    // a frame draws them rather than giving way to what follows them.
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    const screens: FathomState["screen"][] = [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ];
    for (const screen of screens) {
      h.pose((s) => h.debug.setScreen(s, screen));
      const before = h.snapshot();
      await h.engine.advance(1);
      const after = h.snapshot();
      expect(after.screen).toBe(screen);
      expect(after.score).toBe(before.score);
      expect(after.lives).toBe(before.lives);
    }
  });
});

// ---- The surface's domains ----------------------------------------------

describe("the surface refuses an argument outside its domain", () => {
  it("names what it expected", () => {
    const s = h.state;
    expect(() => h.debug.setDepth(s, 0)).toThrow(/at least 1/);
    expect(() => h.debug.setBrightness(s, 2)).toThrow(/\[0, 1\]/);
    expect(() => h.debug.setBrightHold(s, BRIGHT_HOLD * 2)).toThrow(/at most/);
    expect(() => h.debug.setSonarCooldown(s, -1)).toThrow(/at least 0/);
    expect(() => h.debug.setInkCooldown(s, Number.NaN)).toThrow(/at least 0/);
    expect(() => h.debug.setScore(s, -1)).toThrow(/whole number/);
    expect(() => h.debug.setLives(s, 1.5)).toThrow(/whole number/);
    expect(() =>
      h.debug.setScreen(s, "diving" as FathomState["screen"]),
    ).toThrow(/expected one of/);
    expect(() => h.debug.addPredator(s, "shark" as PredatorKind, 1, 1)).toThrow(
      /expected one of/,
    );
    expect(() => h.debug.setPredatorTile(s, 99, 1, 1)).toThrow(/roster holds/);
    expect(() => h.debug.setPredatorMind(s, 99, false)).toThrow(/roster holds/);
    expect(() => h.debug.setDrifterMind(s, 0, false)).toThrow(
      /maze holds 0 drifters/,
    );
    expect(() => h.debug.setMaze(s, ["##"])).toThrow(/expected 18 rows/);
    expect(() =>
      h.debug.setMaze(s, Array<string>(18).fill("x".repeat(36))),
    ).toThrow(/unknown tile character/);
    expect(() =>
      h.debug.setMaze(
        s,
        Array<string>(18).fill(`${"d".repeat(2)}${"#".repeat(34)}`),
      ),
    ).toThrow(/exactly one gate/);
  });

  it("refuses a tile the body it moves may not stand on", () => {
    h.pose((s) => h.debug.setMaze(s, board([HALL], HALL_ROW)));
    const s = h.state;
    expect(() => h.debug.setForagerTile(s, 0, 0)).toThrow(/open corridor tile/);
    expect(() => h.debug.spawnDrifter(s, 0, 0)).toThrow(/open corridor tile/);
    expect(() => h.debug.setPlankton(s, 0, 0, true)).toThrow(
      /open corridor tile/,
    );
    expect(() => h.debug.setPredatorTile(s, 0, 0, 0)).toThrow(/den gate/);
  });

  it("refuses a state the predator is not standing where it can be posed in", () => {
    poseBoard(denBoard(), 1, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 5, HALL_ROW));
    // Loose in the corridor, so the den is not a state it stands in.
    expect(() => h.debug.setPredatorState(h.state, 0, "den")).toThrow(
      /neither a den tile nor the den gate/,
    );

    h.pose((s) => h.debug.setPredatorTile(s, 0, 17, HALL_ROW + 2));
    expect(() => h.debug.setPredatorState(h.state, 0, "wander")).toThrow(
      /not an open corridor tile/,
    );
  });
});

// ---- The hunters' own senses --------------------------------------------

describe("each hunter hunts by its own sense", () => {
  it("gives the Gloamfin a fix when its own ping's front reaches the forager", async () => {
    // One Gloamfin on an otherwise empty board, so nothing else can ping.
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 11, HALL_ROW));

    let pinged = false;
    let acquired = false;
    for (let i = 0; i < 160; i++) {
      // The Gloamfin patrols, and where it patrols to is its own business, so
      // the scenario keeps it six tiles off — past its close hearing and well
      // inside the range of a ping — by posing its tile and nothing else.
      h.pose((s) => h.debug.setPredatorTile(s, 0, 11, HALL_ROW));
      await h.advance(0.05);
      const shown = h.snapshot();
      pinged ||= shown.pulses.some((pulse) => pulse.source === "gloamfin");
      if (shown.predators[0].state === "chase") {
        acquired = true;
        // The fix cannot have come from close hearing at six tiles.
        expect(pinged).toBe(true);
        expect(shown.predators[0].hearingLock).toBe(false);
        expect(shown.predators[0].alert).toBe(true);
        break;
      }
    }
    expect(pinged).toBe(true);
    expect(acquired).toBe(true);
    expect(h.cues.map((play) => play.cue)).toContain(CUES.predatorPing);
  });

  it("takes the Gloamfin to a search when it reaches an empty fixed tile", async () => {
    poseBoard(board([HALL], HALL_ROW), 20, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 24, HALL_ROW));
    h.pose((s) => h.debug.setPredatorState(s, 0, "chase"));
    // The forager leaves the tile the fix names before the hunter arrives.
    h.pose((s) => h.debug.setForagerTile(s, 3, HALL_ROW));

    let searched = false;
    for (let i = 0; i < 60; i++) {
      await h.advance(0.05);
      searched ||= h.snapshot().predators[0].state === "search";
      if (searched) break;
    }
    expect(searched).toBe(true);
  });

  it("charges and blooms on the Flarefish's own timer", async () => {
    // A pocket sealed off from the hall by one course of rock: the Flarefish
    // cannot move out of it and cannot see past the rock, and the forager is
    // parked far enough away that nothing it does reaches him.
    const pocket = `${"#".repeat(10)}.${"#".repeat(25)}`;
    poseBoard(
      board([HALL, "#".repeat(GRID_COLS), pocket], HALL_ROW),
      28,
      HALL_ROW,
    );
    h.pose((s) => h.debug.addPredator(s, "flarefish", 10, HALL_ROW + 2));

    let charged = 0;
    let bloomed = 0;
    let radius = 0;
    for (let i = 0; i < 220; i++) {
      await h.advance(0.05);
      const p = h.snapshot().predators[0];
      if (p.flareCharging === true) charged++;
      if (p.flaring === true) {
        bloomed++;
        radius = p.flareRadius ?? 0;
      }
    }
    // The charge-up runs for FLARE_CHARGE and the bloom for FLARE_BLOOM, so a
    // window of eleven seconds holds one whole flare with room to spare.
    expect(charged).toBeGreaterThan(0);
    expect(bloomed).toBeGreaterThan(0);
    expect(bloomed).toBeGreaterThan(charged);
    expect(radius).toBe(FLARE_RADIUS);
    expect(h.cues.map((play) => play.cue)).toContain(CUES.flare);

    // Outside a flare it reports nothing at all, and it never chased.
    const after = h.snapshot().predators[0];
    expect(after.state).toBe("wander");
    expect(after.flaring).toBe(false);
    expect(after.flareRadius).toBe(0);
  });

  it("locks on through rock when its bloom reaches the forager", async () => {
    const pocket = `${"#".repeat(10)}.${"#".repeat(25)}`;
    // Two tiles apart with rock between: inside the bloom's reach, and outside
    // the light sense, which the rock blocks.
    poseBoard(
      board([HALL, "#".repeat(GRID_COLS), pocket], HALL_ROW),
      10,
      HALL_ROW,
    );
    h.pose((s) => h.debug.addPredator(s, "flarefish", 10, HALL_ROW + 2));
    expect(h.snapshot().predators[0].state).toBe("wander");

    let locked = false;
    let alerted = false;
    for (let i = 0; i < 220; i++) {
      await h.advance(0.05);
      const p = h.snapshot().predators[0];
      alerted ||= p.alert;
      if (p.state === "chase") {
        locked = true;
        break;
      }
    }
    expect(locked).toBe(true);
    expect(alerted).toBe(true);
    // The bloom ends the moment it locks on, and its light is over with it.
    const after = h.snapshot().predators[0];
    expect(after.flaring).toBe(false);
    expect(after.flareRadius).toBe(0);
  });

  it("keeps the Lanternjaw's bulb showing while its body stays dark", async () => {
    poseBoard(board([HALL], HALL_ROW), 3, HALL_ROW);
    h.pose((s) => h.debug.setBrightness(s, 0));
    // Well past the light pocket, on a tile the fog has never revealed, and held
    // there so it is the drawing rather than a patrol that is measured.
    h.pose((s) => h.debug.addPredator(s, "lanternjaw", 12, HALL_ROW));
    h.pose((s) => h.debug.setPredatorMind(s, 0, false));
    await h.advance(0.25);

    const shown = h.snapshot();
    expect(shown.predators[0].kind).toBe("lanternjaw");
    expect(shown.predators[0].lit).toBe(false);
    expect(shown.visibility[HALL_ROW][12]).toBe("u");
    // The amber bulb is drawn across the fog all the same.
    const [bx, by] = center(12, HALL_ROW);
    expect(luminance(h.pixel(bx, by))).toBeGreaterThan(80);
  });

  it("draws a predator's body where the forager's light falls on it", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.addPredator(s, "gloamfin", 7, HALL_ROW));
    h.pose((s) => h.debug.setPredatorMind(s, 0, false));
    await h.advance(0.25);
    const shown = h.snapshot();
    expect(shown.predators[0].lit).toBe(true);
    expect(
      luminance(h.pixel(shown.predators[0].x, shown.predators[0].y)),
    ).toBeGreaterThan(luminance(h.pixel(...center(9, HALL_ROW))));
  });
});

// ---- The rest of the surface --------------------------------------------

describe("the rest of the surface", () => {
  it("turns the forager without moving it", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    const before = h.snapshot().forager;
    h.pose((s) => h.debug.setForagerDir(s, "left"));
    const turned = h.snapshot().forager;
    expect(turned.dir).toBe("left");
    expect(turned.x).toBe(before.x);
    expect(turned.moving).toBe(false);
    await h.advance(0.25);
    expect(h.snapshot().forager.x).toBe(before.x);
  });

  it("turns a predator and recomputes what depth scales", () => {
    h.pose((s) => h.debug.setPredatorDir(s, 0, "down"));
    expect(h.snapshot().predators[0].dir).toBe("down");

    h.pose((s) => h.debug.setDepth(s, 4));
    const deep = h.snapshot();
    expect(deep.depth).toBe(4);
    expect(deep.sonar.range).toBe(6);
    expect(deep.predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
      "flarefish",
    ]);
    expect(deep.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
  });

  it("gives a change of depth its own roster and leaves the board alone", () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    stockPlankton(board([HALL], HALL_ROW));
    const before = h.snapshot();

    h.pose((s) => h.debug.setDepth(s, 3));
    const deeper = h.snapshot();
    expect(deeper.predators.length).toBe(5);
    expect(
      deeper.predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
    // The maze, the plankton, the fog and the screen are all left as they stand.
    expect(deeper.tiles).toEqual(before.tiles);
    expect(deeper.plankton).toEqual(before.plankton);
    expect(deeper.planktonRemaining).toBe(before.planktonRemaining);
    expect(deeper.visibility).toEqual(before.visibility);
    expect(deeper.screen).toBe(before.screen);
  });

  it("admits a bonus drifter at the den gate while plankton remain", async () => {
    // A board with a den chamber, its gate on the top edge, and one corridor
    // above it for a drifter to be admitted onto.
    const rows: string[] = [];
    for (let ty = 0; ty < GRID_ROWS; ty++) rows.push("#".repeat(GRID_COLS));
    rows[6] = `#${".".repeat(30)}${"#".repeat(5)}`;
    rows[7] = `${"#".repeat(17)}g${"#".repeat(18)}`;
    rows[8] = `${"#".repeat(15)}dddddd${"#".repeat(15)}`;
    poseBoard(rows, 1, 6);
    stockPlankton(rows);
    expect(h.snapshot().drifters.length).toBe(0);

    await h.advance(26);
    const admitted = h.snapshot();
    expect(admitted.drifters.length).toBe(1);
    expect(admitted.drifters[0].mind).toBe(true);
    // Twenty-six seconds of simulation with the whole grid drawn on every tick
    // runs to a few seconds of wall clock, which is close enough to the default
    // ceiling to fail on a busy machine. The bound is here to stop a hang.
  }, 30_000);

  it("poses a cooldown that then runs down on the ordinary curve", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setSonarCooldown(s, 0.5));
    h.pose((s) => h.debug.setInkCooldown(s, 0.25));
    expect(h.snapshot().sonar.ready).toBe(false);
    await h.advance(0.25);
    const half = h.snapshot();
    expect(half.sonar.cooldown).toBeCloseTo(0.25, 2);
    expect(half.ink.ready).toBe(true);
    await h.advance(0.5);
    expect(h.snapshot().sonar.ready).toBe(true);
  });

  it("takes plankton off the board without scoring or clearing it", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    stockPlankton(board([HALL], HALL_ROW));
    const before = h.snapshot();
    expect(before.planktonRemaining).toBeGreaterThan(0);
    // The layer and the count report the same fact.
    expect(before.plankton[HALL_ROW][8]).toBe("*");

    h.pose((s) => h.debug.clearPlankton(s));
    await h.advance(0.5);
    const bare = h.snapshot();
    expect(bare.planktonRemaining).toBe(0);
    expect(bare.plankton.join("")).not.toContain("*");
    expect(bare.score).toBe(before.score);
    expect(bare.screen).toBe("playing");

    // One put back on a named tile, and taken off again.
    h.pose((s) => h.debug.setPlankton(s, 25, HALL_ROW, true));
    expect(h.snapshot().plankton[HALL_ROW][25]).toBe("*");
    expect(h.snapshot().planktonRemaining).toBe(1);
    h.pose((s) => h.debug.setPlankton(s, 25, HALL_ROW, false));
    expect(h.snapshot().planktonRemaining).toBe(0);
  });

  it("poses the score and the lives play then carries on from", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setScore(s, 400));
    h.pose((s) => h.debug.setLives(s, 1));
    expect(h.snapshot().score).toBe(400);
    expect(h.snapshot().lives).toBe(1);

    // Play carries on from that figure: the next plankton eaten adds to it.
    h.pose((s) => h.debug.setPlankton(s, 6, HALL_ROW, true));
    h.pose((s) => h.debug.setPlankton(s, 25, HALL_ROW, true));
    h.hold("ArrowRight");
    await h.advance(0.3);
    expect(h.snapshot().score).toBe(400 + SCORE_PLANKTON);
  });

  it("poses the brightness and its hold as two separate things", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    // The brightness alone: the hold stands where it was, spent, so `G` decays
    // from the posed value at once.
    h.pose((s) => h.debug.setBrightness(s, 1));
    expect(h.snapshot().brightness).toBe(1);
    expect(h.snapshot().brightHold).toBe(0);
    await h.advance(0.5);
    expect(h.snapshot().brightness).toBeLessThan(1);

    // The pair eating a plankton arms: steady for the whole hold, then decaying.
    h.pose((s) => h.debug.setBrightness(s, 1));
    h.pose((s) => h.debug.setBrightHold(s, BRIGHT_HOLD));
    await h.advance(BRIGHT_HOLD / 2);
    expect(h.snapshot().brightness).toBe(1);
    expect(h.snapshot().brightHold).toBeCloseTo(BRIGHT_HOLD / 2, 2);
    await h.advance(BRIGHT_HOLD);
    expect(h.snapshot().brightness).toBeLessThan(1);
  });

  it("puts the fog back to unrevealed without moving anything", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    await h.advance(0.25);
    const lit = h.snapshot();
    expect(lit.visibility.join("")).toContain("l");

    h.pose((s) => h.debug.clearFog(s));
    const dark = h.snapshot();
    expect(dark.visibility.join("")).not.toContain("l");
    expect(dark.visibility.join("")).not.toContain("r");
    expect(dark.forager.x).toBe(lit.forager.x);
    expect(dark.forager.y).toBe(lit.forager.y);

    // The light falls again as soon as the simulation advances.
    await h.advance(0.05);
    expect(h.snapshot().visibility.join("")).toContain("l");
  });

  it("takes every drifter off the maze without scoring", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.spawnDrifter(s, 20, HALL_ROW));
    h.pose((s) => h.debug.spawnDrifter(s, 25, HALL_ROW));
    const before = h.snapshot();
    expect(before.drifters.length).toBe(2);

    h.pose((s) => h.debug.clearDrifters(s));
    await h.advance(0.5);
    const bare = h.snapshot();
    expect(bare.drifters).toEqual([]);
    expect(bare.score).toBe(before.score);
  });

  it("sets the screen and nothing else", () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    h.pose((s) => h.debug.setScore(s, 700));
    const before = h.snapshot();

    h.pose((s) => h.debug.setScreen(s, "paused"));
    const paused = h.snapshot();
    expect(paused.screen).toBe("paused");
    expect(paused.score).toBe(before.score);
    expect(paused.lives).toBe(before.lives);
    expect(paused.depth).toBe(before.depth);
    expect(paused.tiles).toEqual(before.tiles);
    expect(paused.plankton).toEqual(before.plankton);
    expect(paused.forager).toEqual(before.forager);
  });

  it("reads its diagnostic sources without disturbing the simulation", async () => {
    poseBoard(board([HALL], HALL_ROW), 5, HALL_ROW);
    // The engine owns the overlay and its key; showing it is what calls the
    // sources the game registered.
    h.tap("Backquote");
    await h.advance(0.05);
    const shown = h.snapshot();
    await h.advance(0.05);
    const after = h.snapshot();
    expect(after.forager.x).toBe(shown.forager.x);
    expect(after.score).toBe(shown.score);
    // The panel is drawn in device pixels over the top-left of the canvas.
    expect(luminance(h.pixel(20, 20))).toBeGreaterThan(0);
  });
});
