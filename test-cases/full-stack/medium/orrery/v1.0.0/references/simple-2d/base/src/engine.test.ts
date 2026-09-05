// Orrery under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock` of one frame per tick. Keys are driven by dispatching
// keyboard-shaped events at the surface's event target and the pointer by
// dispatching pointer-shaped ones — the same listeners a player reaches — and
// what is read back is the game's own state, the debug surface `initialize`
// returned beside it, the engine's cue events, and the pixels the render
// produced.
//
// Nothing in this process can fetch or decode a file, so every produced asset
// fails to load here. That is deliberate: it is the check that a build whose
// assets are unavailable still initializes, still ticks, still takes keyboard
// and pointer input, and still draws a legible field (specs/assets.md).
//
// The surface is sized exactly to the stage at a device pixel ratio of one, so
// the viewport's scale is `1` and its letterbox bars are empty: a client
// position dispatched here is a logical stage position, which is what lets a
// press be aimed at a hex center by name.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { challengeCount } from "./challenges";
import {
  CAMPAIGN_REFERENCE_CYCLES,
  CUES,
  LAYOUT,
  SPEEDS,
  STAGE_H,
  STAGE_W,
} from "./constants";
import {
  BACKGROUND,
  game,
  type OrreryDebugApi,
  type OrreryState,
} from "./game";
import { hexX, hexY } from "./hex";
import { menuItemRect } from "./progress";

const FRAME_MS = 1000 / 60;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

class PointEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly isPrimary = true;
  readonly pointerType = "mouse";

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

interface Harness {
  readonly engine: Engine<OrreryState, OrreryDebugApi>;
  readonly state: DeepReadonly<OrreryState>;
  readonly debug: OrreryDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: string[];
  readonly loops: string[];
  tap(code: string, repeat?: boolean): void;
  press(x: number, y: number): void;
  move(x: number, y: number): void;
  release(x: number, y: number): void;
  pose(transition: (state: DeepReadonly<OrreryState>) => OrreryState): void;
  snap(): Record<string, unknown>;
  dispose(): void;
}

function surfaceOf(events: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };
}

function canvasOf(): { element: HTMLCanvasElement; ctx: SKRSContext2D } {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;
  return { element, ctx };
}

async function createHarness(): Promise<Harness> {
  const { element, ctx } = canvasOf();
  const events = new EventTarget();

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<OrreryState, OrreryDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface: surfaceOf(events),
  });

  const cues: string[] = [];
  const loops: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));

  await engine.initialize();

  return {
    engine,
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface beside its state fails here.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    press: (x, y) => events.dispatchEvent(new PointEvent("pointerdown", x, y)),
    move: (x, y) => events.dispatchEvent(new PointEvent("pointermove", x, y)),
    release: (x, y) => events.dispatchEvent(new PointEvent("pointerup", x, y)),
    pose: (transition) => void engine.apply(transition),
    snap: () => engine.debug.snapshot(engine.state),
    dispose: () => engine.destroy(),
  };
}

/** How many pixels of the frame are lit above the sky. */
function litPixels(ctx: SKRSContext2D): number {
  const painted = ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
  let lit = 0;
  for (let i = 0; i < painted.length; i += 4) {
    if (painted[i] + painted[i + 1] + painted[i + 2] > 120) lit += 1;
  }
  return lit;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("initialization", () => {
  it("opens on the title with the surface beside the state", () => {
    expect(h.state.screen).toBe("title");
    expect(h.debug.version).toBe(1);
    expect(h.snap().screen).toBe("title");
    expect(h.snap().completion).toBe(true);
  });

  it("initializes and draws even though no produced file could load", async () => {
    await h.engine.advance(1);
    // Every screen's copy is drawn in code, so the stage is not blank.
    expect(litPixels(h.ctx)).toBeGreaterThan(0);
  });

  it("registers the diagnostics the overlay shows", () => {
    const names = h.engine.diagnostics().map((line) => line.name);
    expect(names).toContain("screen");
    expect(names).toContain("period");
    expect(names).toContain("pointer");
    for (const line of h.engine.diagnostics()) {
      expect(line.error, line.name).toBeUndefined();
    }
  });
});

describe("the keyboard the engine drives", () => {
  it("moves the title highlight with wrap and takes the item", async () => {
    h.tap("ArrowUp");
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(2);
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(0);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("select");
    expect(h.snap().mode).toBe("campaign");
  });

  it("raises nothing for an auto-repeat", async () => {
    h.tap("ArrowDown", true);
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(0);
  });

  it("mutes and unmutes from any screen, and the state mirrors the bit", async () => {
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(true);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(false);
  });
});

describe("the pointer the engine maps into stage units", () => {
  /** Extras 1, opened, with the tray showing. */
  async function editing(): Promise<void> {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    await h.engine.advance(1);
  }

  it("places a part by dragging a tray entry onto a hex", async () => {
    await editing();
    // The first tray slot: `arm`, at the top of the tray region.
    h.press(100, 71);
    await h.engine.advance(1);
    expect(h.snap().editor).toMatchObject({
      drag: { kind: "place", part: "arm" },
    });
    h.move(hexX(1, -1), hexY(1, -1));
    h.release(hexX(1, -1), hexY(1, -1));
    await h.engine.advance(1);
    const editor = h.snap().editor as {
      parts: { kind: string; q: number; r: number }[];
      drag: unknown;
    };
    expect(editor.drag).toBeNull();
    expect(editor.parts).toHaveLength(1);
    expect(editor.parts[0]).toMatchObject({ kind: "arm", q: 1, r: -1 });
    expect(h.cues).toContain(CUES.place);
  });

  it("mirrors the pointer's position and press into the state", async () => {
    await editing();
    h.press(400, 300);
    await h.engine.advance(1);
    expect(h.state.pointer).toMatchObject({ x: 400, y: 300, down: true });
    h.release(400, 300);
    await h.engine.advance(1);
    expect(h.state.pointer.down).toBe(false);
  });

  it("lays a track through every hex the pointer crossed in one frame", async () => {
    await editing();
    h.pose((s) => h.debug.placeTrack(s, 0, 0));
    const track = (h.snap().editor as { parts: { id: number }[] }).parts[0].id;
    // Grab the track's one cell, then sweep across two more before the frame.
    h.press(hexX(0, 0), hexY(0, 0));
    h.move(hexX(1, 0), hexY(1, 0));
    h.move(hexX(2, 0), hexY(2, 0));
    h.release(hexX(2, 0), hexY(2, 0));
    await h.engine.advance(1);
    const parts = (
      h.snap().editor as { parts: { id: number; cells: unknown[] }[] }
    ).parts;
    const laid = parts.find((part) => part.id === track);
    expect(laid?.cells).toHaveLength(3);
  });
});

describe("the clock the engine owns", () => {
  /** Extras 1 with its reference solution loaded and running. */
  async function running(): Promise<void> {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    h.pose((s) =>
      h.debug.loadSolution(s, h.debug.referenceSolution(s, "extras", 0)),
    );
    h.pose((s) => h.debug.startRun(s));
    await h.engine.advance(1);
  }

  it("advances the run at the speed step's cycles per second", async () => {
    await running();
    h.pose((s) => h.debug.setCycle(s, 0));
    const before = (h.snap().sim as { cycle: number }).cycle;
    // One second of game time at SPEEDS[1] is three whole cycles.
    await h.engine.advance(60);
    const after = (h.snap().sim as { cycle: number }).cycle;
    expect(after - before).toBe(SPEEDS[1]);
  });

  it("reaches the same cycle however the second was divided into frames", async () => {
    // The property specs/instrumentation.md rests the surface on: one second
    // of game time reaches the same state as sixty sixtieths of one. Both
    // harnesses are posed identically and neither runs a warm-up frame, so the
    // only difference between them is the clock.
    const prepare = (bench: Harness): void => {
      bench.pose((s) => bench.debug.openChallenge(s, "extras", 0));
      bench.pose((s) =>
        bench.debug.loadSolution(
          s,
          bench.debug.referenceSolution(s, "extras", 0),
        ),
      );
      bench.pose((s) => bench.debug.startRun(s));
    };

    prepare(h);
    await h.engine.advance(60);
    const fine = JSON.stringify(h.snap().sim);

    const coarse = await createHarness();
    coarse.engine.setClock(new ConstantClock(1000));
    prepare(coarse);
    await coarse.engine.advance(1);
    expect(JSON.stringify(coarse.snap().sim)).toBe(fine);
    coarse.dispose();
  });

  it("accumulates simTime whatever the screen", async () => {
    await h.engine.advance(60);
    expect(h.state.simTime).toBeCloseTo(1, 6);
  });
});

describe("the cue bus", () => {
  it("loops the bed from the first frame, and only once", async () => {
    await h.engine.advance(5);
    expect(h.loops).toEqual([CUES.music]);
  });

  it("plays the start cue on the frame the run begins", async () => {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    h.pose((s) => h.debug.placeRise(s, 0, -3, 0, 0));
    h.pose((s) => h.debug.placeSet(s, 0, 3, 0, 0));
    await h.engine.advance(1);
    h.cues.length = 0;
    h.tap("Space");
    await h.engine.advance(1);
    expect(h.cues).toEqual([CUES.start]);
    await h.engine.advance(1);
    expect(h.cues).toEqual([CUES.start]);
  });

  it("sounds nothing at a pose, and sounds it on the next frame", async () => {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    await h.engine.advance(1);
    h.cues.length = 0;
    h.pose((s) => h.debug.pointerDown(s, 100, 71));
    h.pose((s) => h.debug.pointerMove(s, hexX(0, 0), hexY(0, 0)));
    h.pose((s) => h.debug.pointerUp(s));
    expect(h.cues).toEqual([]);
    await h.engine.advance(1);
    expect(h.cues).toContain(CUES.place);
  });
});

describe("the debug surface the engine hands back", () => {
  it("poses through apply and reads through snapshot", () => {
    h.pose((s) => h.debug.setScreen(s, "howto"));
    h.pose((s) => h.debug.setHowtoPage(s, 3));
    expect(h.snap().howtoPage).toBe(3);
  });

  it("leaves the state it was handed exactly as it stood", () => {
    const before = h.engine.state;
    const after = h.debug.setMode(before, "extras");
    expect(after.mode).toBe("extras");
    expect(before.mode).toBe("campaign");
    expect(h.engine.state.mode).toBe("campaign");
  });

  it("drives a whole machine with no frame between the calls", () => {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    h.pose((s) => h.debug.pointerDown(s, 100, 71));
    h.pose((s) => h.debug.pointerMove(s, hexX(-1, 0), hexY(-1, 0)));
    h.pose((s) => h.debug.pointerUp(s));
    h.pose((s) => h.debug.pointerDown(s, 100, 71));
    h.pose((s) => h.debug.pointerMove(s, hexX(1, 0), hexY(1, 0)));
    h.pose((s) => h.debug.pointerUp(s));
    expect((h.snap().editor as { parts: unknown[] }).parts).toHaveLength(2);
    expect(h.engine.frame().count).toBe(0);
  });
});

describe("every challenge, completed on the engine's own clock", () => {
  // The requirement both mode files state, proved through the whole stack this
  // engine drives: the frame loop, `update`, the state held by value, and the
  // debug surface's poses. `src/solutions.test.ts` proves the same runs over
  // the transition alone; this proves the engine reaches them too.
  const modes = [
    ["campaign", challengeCount("campaign")],
    ["extras", challengeCount("extras")],
  ] as const;

  for (const [mode, count] of modes) {
    for (let index = 0; index < count; index += 1) {
      it(`completes ${mode} ${index + 1}`, async () => {
        const bench = await createHarness();
        // One frame is worth a whole second, and the fastest speed step runs
        // SPEEDS[3] cycles in one, so the 600 cycles specs/modes/campaign.md
        // allows fit inside twenty frames.
        bench.engine.setClock(new ConstantClock(1000));
        bench.pose((s) => bench.debug.openChallenge(s, mode, index));
        bench.pose((s) =>
          bench.debug.loadSolution(
            s,
            bench.debug.referenceSolution(s, mode, index),
          ),
        );
        bench.pose((s) => bench.debug.startRun(s));
        bench.pose((s) => bench.debug.setSpeed(s, SPEEDS.length - 1));
        const frames = Math.ceil(CAMPAIGN_REFERENCE_CYCLES / SPEEDS[3]);
        for (let frame = 0; frame < frames; frame += 1) {
          if ((bench.snap().sim as { status: string }).status !== "running") {
            break;
          }
          await bench.engine.advance(1);
        }
        const sim = bench.snap().sim as {
          status: string;
          cycle: number;
          metrics: { cost: number; cycles: number; area: number } | null;
        };
        expect(sim.status, `${mode} ${index + 1}`).toBe("complete");
        expect(sim.metrics).not.toBeNull();
        expect(sim.cycle).toBeLessThanOrEqual(CAMPAIGN_REFERENCE_CYCLES);
        // Completing records the challenge as solved, and the campaign
        // unlocks the next one (specs/modes/campaign.md).
        const progress = bench.snap()[mode] as {
          solved: number[];
          records: unknown[];
        };
        expect(progress.solved).toContain(index);
        expect(progress.records[index]).not.toBeNull();
        bench.dispose();
      });
    }
  }
});

describe("drawing through the engine's context", () => {
  it("leaves the state exactly as update left it", async () => {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    h.pose((s) => h.debug.startRun(s));
    await h.engine.advance(1);
    const before = JSON.stringify(h.snap());
    game.render(h.engine.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
      frame: () => h.engine.frame(),
      viewport: () => h.engine.viewport(),
    });
    expect(JSON.stringify(h.snap())).toBe(before);
  });

  it("paints the editor over the field it opened on", async () => {
    h.pose((s) => h.debug.openChallenge(s, "extras", 0));
    await h.engine.advance(1);
    expect(litPixels(h.ctx)).toBeGreaterThan(0);
  });
});

describe("one frame's keyboard edges beside its pointer samples", () => {
  /** The middle of the region the current menu reports for `index`. */
  function middleOf(index: number): { x: number; y: number } {
    const rect = menuItemRect(h.state as OrreryState, index);
    if (rect === null) throw new Error(`no region for menu item ${index}`);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  it("leaves the highlight on the item the pointer named", async () => {
    const onExtras = middleOf(1);
    h.tap("ArrowDown");
    h.move(onExtras.x, onExtras.y);
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    expect(h.snap().screen).toBe("title");
  });

  it("takes the keyboard's item alone when a click lands on the same frame", async () => {
    h.pose((s) => h.debug.setMenuIndex(s, 1));
    // An ordinary click on a title item, whose region overlaps a row of the
    // select screen EXTRAS opens: the rows run from y 120 down the stage.
    const onExtras = middleOf(1);
    h.tap("Enter");
    h.press(onExtras.x, onExtras.y);
    h.release(onExtras.x, onExtras.y);
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("select");
    expect(h.snap().mode).toBe("extras");
    // The click moved the highlight down the list it landed on, as any sample
    // does, and took nothing: no challenge was opened.
    expect(h.snap().challenge).toBeNull();
  });

  it("takes that same click one frame later, so the click is a live one", async () => {
    h.pose((s) => h.debug.setMenuIndex(s, 1));
    const onExtras = middleOf(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("select");

    h.press(onExtras.x, onExtras.y);
    h.release(onExtras.x, onExtras.y);
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("editor");
    expect(h.snap().challenge).not.toBeNull();
  });
});
