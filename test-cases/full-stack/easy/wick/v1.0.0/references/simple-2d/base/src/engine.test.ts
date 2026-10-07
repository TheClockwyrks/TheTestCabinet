// Wick under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and
// a `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock`. Keys are driven by dispatching keyboard-shaped events at
// the surface's event target, the same listener a player's key reaches, and
// what is read back is the game's own state, the debug surface `initialize`
// returned beside it, the engine's cue events, and the pixels the render
// produced.
//
// The pointer is driven the same way, by dispatching pointer- and wheel-shaped
// events at that target; the surface is the stage's own size at a device pixel
// ratio of one, so a client position is a stage position.
//
// Nothing in this process can fetch a file, so every produced asset fails to
// load here. That is deliberate: it is the check that a build whose assets
// are unavailable still initializes, still ticks, still takes input, and
// still draws a legible night.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spriteCount } from "./assets";
import {
  ALMANAC_ROWS,
  CUES,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  WHEEL_ROW,
} from "./constants";
import { entriesOf } from "./almanac";
import {
  BACKGROUND,
  game,
  type WickDebugApi,
  type WickRect,
  type WickState,
} from "./game";
import { SWITCH_NAMES } from "./state";

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

class PointerEventShape extends Event {
  readonly pointerId = 1;
  readonly isPrimary = true;
  readonly pointerType = "mouse";
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointermove" | "pointerdown" | "pointerup",
    readonly clientX: number,
    readonly clientY: number,
  ) {
    super(type);
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = type === "pointerdown" ? 1 : 0;
  }
}

class WheelEventShape extends Event {
  readonly deltaX = 0;
  readonly deltaMode = 0;

  constructor(readonly deltaY: number) {
    super("wheel");
  }
}

/** The middle of a rectangle the debug surface reported. */
function middle(rect: WickRect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

interface Harness {
  readonly engine: Engine<WickState, WickDebugApi>;
  readonly state: DeepReadonly<WickState>;
  readonly debug: WickDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: string[];
  readonly loops: string[];
  readonly stops: string[];
  tap(code: string, repeat?: boolean): void;
  down(code: string): void;
  up(code: string): void;
  hover(x: number, y: number): void;
  click(x: number, y: number): void;
  scroll(travel: number): void;
  pose(transition: (state: DeepReadonly<WickState>) => WickState): void;
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

async function createHarness(stepMs = FRAME_MS): Promise<Harness> {
  const { element, ctx } = canvasOf();
  const events = new EventTarget();

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<WickState, WickDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(stepMs),
    surface: surfaceOf(events),
  });

  const cues: string[] = [];
  const loops: string[] = [];
  const stops: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));
  engine.events.on("cue:stopped", ({ cue }) => stops.push(cue));

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
    stops,
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    down: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    up: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    hover: (x, y) =>
      events.dispatchEvent(new PointerEventShape("pointermove", x, y)),
    click: (x, y) => {
      events.dispatchEvent(new PointerEventShape("pointermove", x, y));
      events.dispatchEvent(new PointerEventShape("pointerdown", x, y));
      events.dispatchEvent(new PointerEventShape("pointerup", x, y));
    },
    scroll: (travel) => events.dispatchEvent(new WheelEventShape(travel)),
    pose: (transition) => void engine.apply(transition),
    dispose: () => engine.destroy(),
  };
}

function litPixels(ctx: SKRSContext2D): number {
  const painted = ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
  let lit = 0;
  for (let i = 0; i < painted.length; i += 4) {
    if (painted[i]! + painted[i + 1]! + painted[i + 2]! > 90) lit += 1;
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

function snap() {
  return h.debug.snapshot(h.engine.state);
}

/**
 * A fresh run on `h`: the pose to `playing`, then Taper in the first slot,
 * which is the sequence `specs/instrumentation.md` names now that `setScreen`
 * sets the screen and nothing else.
 */
function startRun(): void {
  h.pose((s) => h.debug.setScreen(s, "playing"));
  h.pose((s) => h.debug.setWeapon(s, 0, "taper", 1));
}

describe("initialization", () => {
  it("opens on the title with the surface beside the state", () => {
    expect(h.state.screen).toBe("title");
    expect(h.debug.version).toBe(1);
    expect(snap().screen).toBe("title");
    expect(snap().run.level).toBe(1);
    for (const name of SWITCH_NAMES) expect(snap()[name]).toBe(true);
  });

  it("initializes and draws even though no produced file could load", async () => {
    expect(spriteCount()).toBe(0);
    await h.engine.advance(1);
    expect(litPixels(h.ctx)).toBeGreaterThan(0);
  });
});

describe("the keyboard", () => {
  it("moves the title highlight with wrap, playing menu-move", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(snap().menuIndex).toBe(1);
    h.tap("KeyW");
    await h.engine.advance(1);
    expect(snap().menuIndex).toBe(0);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(2);
  });

  it("raises nothing for an auto-repeat", async () => {
    h.tap("ArrowDown", true);
    await h.engine.advance(1);
    expect(snap().menuIndex).toBe(0);
  });

  it("starts a run on LIGHT THE LAMP and loops the music", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    expect(snap().run.tick).toBe(1);
    expect(h.cues).toContain(CUES.menuConfirm);
    expect(h.loops).toEqual([CUES.music]);
  });

  it("moves the lamplighter while a movement key is held, and faces it", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.setWeaponFire(s, false));
    h.pose((s) => h.debug.setSpawning(s, false));
    h.down("KeyA");
    await h.engine.advance(60);
    h.up("KeyA");
    expect(snap().run.player.x).toBeCloseTo(-180, 6);
    expect(snap().run.player.facing).toBe("left");
    h.down("ArrowUp");
    h.down("ArrowRight");
    await h.engine.advance(60);
    h.up("ArrowUp");
    h.up("ArrowRight");
    expect(snap().run.player.x).toBeCloseTo(-180 + 180 / Math.SQRT2, 6);
    expect(snap().run.player.y).toBeCloseTo(-180 / Math.SQRT2, 6);
    expect(snap().run.player.facing).toBe("right");
  });

  it("pauses with KeyP or Escape, and both resume", async () => {
    h.tap("Enter");
    await h.engine.advance(5);
    h.tap("KeyP");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    expect(snap().run.tick).toBe(5);
    await h.engine.advance(10);
    expect(snap().run.tick).toBe(5);
    h.tap("KeyP");
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    expect(snap().run.tick).toBe(6);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    // MAIN MENU is the way out of the night from here. Each press is its own
    // frame, since every edge is read against the screen its frame began on.
    h.tap("KeyP");
    await h.engine.advance(1);
    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(snap().screen).toBe("title");
    expect(h.stops).toContain(CUES.music);
  });

  it("toggles the engine's mute bit with KeyM and mirrors it", async () => {
    expect(snap().muted).toBe(false);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(snap().muted).toBe(true);
    h.tap("Enter");
    await h.engine.advance(1);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(snap().muted).toBe(false);
  });
});

describe("the pointer", () => {
  it("moves the title highlight to the item it rests on, sounding menu-move", async () => {
    h.hover(...middle(h.debug.menuRects(h.engine.state)[1]));
    await h.engine.advance(1);
    expect(snap().menuIndex).toBe(1);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(1);
    await h.engine.advance(1);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(1);
  });

  it("changes nothing while it rests off every rectangle", async () => {
    h.hover(4, 4);
    h.click(4, 4);
    await h.engine.advance(1);
    expect(snap().menuIndex).toBe(0);
    expect(snap().screen).toBe("title");
    expect(h.cues).toEqual([]);
  });

  it("takes the item it clicks, from the title through the almanac", async () => {
    h.click(...middle(h.debug.menuRects(h.engine.state)[1]));
    await h.engine.advance(1);
    expect(snap().screen).toBe("almanac");
    expect(h.cues).toContain(CUES.menuConfirm);
    expect(snap().run.tick).toBe(0);

    // An entry carries no confirm, so a click on one only moves the highlight.
    h.click(...middle(h.debug.menuRects(h.engine.state)[2]));
    await h.engine.advance(1);
    expect(snap().screen).toBe("almanac");
    expect(snap().menuIndex).toBe(2);

    // A click inside a tab shows that tab, back at its first entry.
    h.click(...middle(h.debug.tabRects(h.engine.state)[2]));
    await h.engine.advance(1);
    expect(snap().almanacTab).toBe(2);
    expect(snap().menuIndex).toBe(0);
    expect(snap().almanacScroll).toBe(0);
  });

  it("scrolls the almanac's list by the wheel, held within it", async () => {
    h.pose((s) => h.debug.setScreen(s, "almanac"));
    h.scroll(WHEEL_ROW);
    await h.engine.advance(1);
    expect(snap().almanacScroll).toBe(1);
    expect(snap().menuIndex).toBe(0);
    h.scroll(WHEEL_ROW * 100);
    await h.engine.advance(1);
    expect(snap().almanacScroll).toBe(entriesOf(0).length - ALMANAC_ROWS);
    h.scroll(-WHEEL_ROW * 100);
    await h.engine.advance(1);
    expect(snap().almanacScroll).toBe(0);
  });

  it("starts a run from the title and resumes from the pause menu", async () => {
    h.click(...middle(h.debug.menuRects(h.engine.state)[0]));
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    expect(snap().run.tick).toBe(1);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    h.click(...middle(h.debug.menuRects(h.engine.state)[0]));
    await h.engine.advance(1);
    expect(snap().screen).toBe("playing");
    expect(snap().run.tick).toBe(2);
  });
});

describe("the clock the engine owns", () => {
  it("resolves sixty ticks in a second of frames", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.engine.advance(60);
    expect(snap().run.tick).toBe(60);
    expect(snap().accumulator).toBeLessThan(1e-9);
    expect(snap().simTime).toBeCloseTo(1, 9);
  });

  it("poses a partial frame under a shorter clock and reaches the same tick", async () => {
    const fine = await createHarness(10);
    try {
      fine.pose((s) => fine.debug.setScreen(s, "playing"));
      await fine.engine.advance(5);
      const snapped = fine.debug.snapshot(fine.engine.state);
      expect(snapped.run.tick).toBe(3);
      expect(snapped.accumulator).toBeCloseTo(0.05 - 3 * TICK_DT, 9);
      await fine.engine.advance(95);
      expect(fine.debug.snapshot(fine.engine.state).run.tick).toBe(60);
    } finally {
      fine.dispose();
    }
  });

  it("counts simTime on every screen and ticks nothing off playing", async () => {
    await h.engine.advance(30);
    expect(snap().simTime).toBeCloseTo(0.5, 9);
    expect(snap().run.tick).toBe(0);
    expect(snap().accumulator).toBe(0);
  });
});

describe("the cue bus", () => {
  it("loops the hum while Halo is held on playing, and stops it when it is gone", async () => {
    startRun();
    h.pose((s) => h.debug.setWeapon(s, 1, "halo", 1));
    await h.engine.advance(1);
    expect(h.loops).toEqual([CUES.music, CUES.hum]);
    h.pose((s) => h.debug.setScreen(s, "paused"));
    await h.engine.advance(1);
    expect(h.stops).toEqual([CUES.hum]);
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.removeWeapon(s, 1));
    await h.engine.advance(1);
    expect(h.loops).toEqual([CUES.music, CUES.hum]);
    expect(h.stops).toEqual([CUES.hum]);
  });

  it("plays hit and kill on the tick a projectile kills, once each", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.setSpawning(s, false));
    h.pose((s) => h.debug.setWeaponFire(s, false));
    h.pose((s) => h.debug.spawnEnemy(s, "moth", 200, 0));
    h.pose((s) => h.debug.spawnEnemy(s, "moth", 200, 4));
    h.pose((s) => h.debug.spawnProjectile(s, "ember", 200, 0, 0, 0, 3));
    h.cues.length = 0;
    await h.engine.advance(1);
    expect(h.cues.filter((cue) => cue === CUES.hit)).toHaveLength(1);
    expect(h.cues.filter((cue) => cue === CUES.kill)).toHaveLength(1);
    expect(snap().run.kills).toBe(2);
  });

  it("plays fallen on the ending tick and stops the music", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.engine.advance(1);
    h.pose((s) => h.debug.setHp(s, 0));
    await h.engine.advance(1);
    expect(snap().screen).toBe("fallen");
    expect(h.cues).toContain(CUES.fallen);
    expect(h.stops).toContain(CUES.music);
  });

  it("sounds nothing for a pose, and the tick after sounds what it would", async () => {
    startRun();
    await h.engine.advance(1);
    h.cues.length = 0;
    h.pose((s) => h.debug.setPendingLevelUps(s, 1));
    expect(h.cues).toEqual([]);
    await h.engine.advance(1);
    expect(h.cues).toEqual([CUES.levelUp]);
    expect(snap().screen).toBe("levelup");
    h.cues.length = 0;
    h.pose((s) => h.debug.choose(s, 0));
    await h.engine.advance(1);
    expect(h.cues).toEqual([]);
    expect(snap().screen).toBe("playing");
  });
});

describe("the endings through the tick", () => {
  it("reaches dawn on the tick after 35999", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    h.pose((s) => h.debug.setTick(s, 35999));
    await h.engine.advance(1);
    expect(snap().screen).toBe("dawn");
    expect(snap().run.tick).toBe(36000);
    expect(h.cues).toContain(CUES.dawn);
    await h.engine.advance(5);
    expect(snap().run.tick).toBe(36000);
  });
});

describe("drawing through the engine's context", () => {
  it("leaves the state exactly as update left it", async () => {
    h.pose((s) => h.debug.setScreen(s, "playing"));
    await h.engine.advance(1);
    const before = JSON.stringify(snap());
    game.render(h.engine.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
      frame: () => h.engine.frame(),
      viewport: () => h.engine.viewport(),
    });
    expect(JSON.stringify(snap())).toBe(before);
  });

  it("paints the paused overlay over the frozen world", async () => {
    h.tap("Enter");
    await h.engine.advance(5);
    h.tap("KeyP");
    await h.engine.advance(1);
    expect(snap().screen).toBe("paused");
    expect(litPixels(h.ctx)).toBeGreaterThan(0);
  });
});

describe("the diagnostics", () => {
  it("report the facts the snapshot reports, read off the state current at the read", async () => {
    const names = h.engine.diagnostics().map((reading) => reading.name);
    for (const name of [
      "screen",
      "clock",
      "level",
      "hp",
      "kills",
      "lamplighter",
      "enemies",
      "effects",
      "gems",
      "weapons",
      "passives",
      "pending",
      ...SWITCH_NAMES,
      "muted",
    ]) {
      expect(names).toContain(name);
    }
    const read = (): Map<string, unknown> =>
      new Map(h.engine.diagnostics().map((r) => [r.name, r.value]));
    expect(read().get("screen")).toBe("title");
    expect(read().get("weapons")).toBe("none");
    startRun();
    h.pose((s) => h.debug.setSpawning(s, false));
    await h.engine.advance(90);
    const live = read();
    expect(live.get("screen")).toBe("playing");
    expect(live.get("clock")).toBe("0:01 (tick 90)");
    expect(live.get("spawning")).toBe(false);
    expect(live.get("weapons")).toMatch(/^taper L1 /);
    expect(h.engine.diagnostics().every((r) => r.error === undefined)).toBe(
      true,
    );
  });
});

describe("a stretch of the night", () => {
  it("runs the director, the weapons, and the drops for ten seconds without a throw", async () => {
    startRun();
    await h.engine.advance(600);
    const s = snap();
    expect(["playing", "fallen", "levelup"]).toContain(s.screen);
    expect(s.run.nextId).toBeGreaterThan(10);
    expect(s.run.enemies.length + s.run.kills).toBeGreaterThan(0);
  });
});
