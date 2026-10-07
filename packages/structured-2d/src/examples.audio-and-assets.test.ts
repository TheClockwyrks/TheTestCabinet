import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Engine,
  EngineEventMap,
  GameDefinition,
  InitApi,
  LoadApi,
} from "./contract";
import {
  Actor,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  SpriteComponent,
  TextComponent,
} from "./index";

/**
 * The documentation's "Audio and Assets" example, transcribed and asserted.
 *
 * The code under test is the worked example at
 * `docs/engines/structured-2d/examples/audio-and-assets.md` — the Vault build:
 * a level that loads a sprite sheet and a produced `.wav` before its world is
 * built, an instance that defines a synthesized cue, a mode that plays both
 * while the match runs, and a missing banner reported on screen. The example's
 * modules are transcribed verbatim below, one section per source file, and the
 * suite asserts the outcomes the page narrates.
 *
 * Three adaptations, all forced by the test environment and none touching the
 * example's own code: the canvas is a fake (jsdom yields no 2D context), the
 * engine takes a `ConstantClock` and a `SurfaceMetrics` and is stepped with
 * `advance` instead of `run` (the pattern the validating-a-game and
 * scripted-clocks pages show), and `src/levels/vault-mode.ts` is transcribed
 * before `src/game.ts` because in a single module the class must exist by the
 * time the definition's object literal names it.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures: the environment the example's page would have supplied           */
/* -------------------------------------------------------------------------- */

/** A canvas reduced to what the engine reads, logging every context call. */
function fakeCanvas(log: string[]): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
  };
  const method =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(`ctx:${name}(${args.map(String).join(",")})`);
    };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "save",
    "restore",
    "clip",
  ]) {
    ctx[name] = method(name);
  }
  canvas["getContext"] = (kind: string): unknown =>
    kind === "2d" ? ctx : null;
  return canvas as unknown as HTMLCanvasElement;
}

/** The bitmap the sheet decodes to, checked back by identity. */
const SHEET = {
  width: 96,
  height: 32,
  close: () => {},
} as unknown as ImageBitmap;

/** The buffer the produced `.wav` decodes to. */
const WAV = { duration: 0.4 } as unknown as AudioBuffer;

/** A body whose bytes can be read, which jsdom's own `Blob` cannot promise. */
function body(): Blob {
  return {
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as Blob;
}

/**
 * The example's asset directory, served over a scripted `fetch`: the two files
 * the page lists exist, and `sprites/banner.png` — the file the workspace holds
 * no copy of — is the 404 the notice reports.
 */
function serve(url: string): Promise<Response> {
  const held =
    url === "assets/sprites/coins.png" || url === "assets/audio/collect.wav";
  if (!held) {
    return Promise.resolve({
      ok: false,
      status: 404,
      blob: () => Promise.resolve(body()),
    } as unknown as Response);
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(body()),
  } as unknown as Response);
}

/** The Web Audio the host lacks: decodes to `WAV`, resumes without complaint. */
class FakeAudioContext {
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve(WAV);
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/* -------------------------------------------------------------------------- */
/* src/constants.ts — verbatim                                                */
/* -------------------------------------------------------------------------- */

const LEVEL = "vault";

const PATH = {
  sheet: "sprites/coins.png",
  sound: "audio/collect.wav",
  banner: "sprites/banner.png",
};

const CUE = { collect: "collect", blip: "blip" } as const;

const COIN = {
  tag: "coin",
  frame: { width: 32, height: 32 },
  spots: [
    { x: 160, y: 200 },
    { x: 320, y: 160 },
    { x: 480, y: 200 },
  ],
};

/* -------------------------------------------------------------------------- */
/* src/instance.ts — verbatim                                                 */
/* -------------------------------------------------------------------------- */

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

class VaultInstance extends GameInstance<null> {
  sheet: ImageBitmap | null = null;
  notice: string | null = null;

  constructor() {
    super();
    built = this;
  }

  override initialize(api: InitApi): null {
    api.audio.define(CUE.blip, {
      wave: "square",
      freq: 660,
      freqTo: 990,
      gain: 0.2,
      durationMs: 90,
    });

    api.events.on("asset:failed", (event) => {
      this.notice = `${event.path} unavailable: ${event.reason}`;
    });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/vault-mode.ts — verbatim                                        */
/* -------------------------------------------------------------------------- */

class VaultMode extends GameMode {
  override beginPlay(): void {
    this.world.every(1.2, () => this.take());
    this.setPhase("playing");
  }

  private take(): void {
    const coins = this.world.byTag(COIN.tag);
    const coin = coins[0];
    if (coin === undefined) return;

    coin.destroy();
    this.world.audio.play(CUE.collect);
    if (coins.length === 1) {
      this.world.audio.play(CUE.blip);
      this.setPhase("over");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — verbatim                                                     */
/* -------------------------------------------------------------------------- */

const coins = COIN.spots.map((spot, index) => ({
  type: Actor,
  transform: spot,
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const image = instance().sheet;
    if (image === null) return;
    actor.attach(
      new SpriteComponent({
        image,
        source: { x: index * COIN.frame.width, y: 0, ...COIN.frame },
        width: 48,
        height: 48,
      }),
    );
  },
}));

const notice = {
  type: Actor,
  transform: { x: 320, y: 40 },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(new TextComponent({ text, fill: "#ffb4a2" }));
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [sheet] = await Promise.all([
    api.assets.loadImage(PATH.sheet),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.sheet = sheet;
  await api.assets.loadImage(PATH.banner).catch(() => null);
}

const vault: GameDefinition<null> = {
  instance: VaultInstance,
  levels: { [LEVEL]: { mode: VaultMode, load, actors: [...coins, notice] } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — adapted only where the environment forces it                 */
/* -------------------------------------------------------------------------- */

interface Booted {
  engine: Engine<null>;
  /** Every context call the fake canvas saw. */
  log: string[];
  /** The event target the surface hands the engine — a keyboard's seam. */
  target: EventTarget;
  /** What main.ts's own `asset:failed` subscription would have warned. */
  warned: string[];
}

let fetcher: ReturnType<typeof vi.fn>;
let engines: Engine<null>[];

beforeEach(() => {
  fetcher = vi.fn(serve);
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve(SHEET)),
  );
  vi.stubGlobal("AudioContext", FakeAudioContext);
  engines = [];
});

afterEach(() => {
  for (const engine of engines) engine.destroy();
  vi.unstubAllGlobals();
});

/**
 * main.ts, line for line where the environment allows: the engine is created
 * over the example's own options, `asset:failed` is subscribed before
 * `initialize`, and `initialize` is awaited. `run` is replaced by the scripted
 * clock and `advance`, and `before` runs between construction and
 * initialization — exactly where the page says a subscription is in place
 * before the instance is built and before the start level loads anything.
 */
async function boot(before?: (engine: Engine<null>) => void): Promise<Booted> {
  const log: string[] = [];
  const target = new EventTarget();
  const canvas = fakeCanvas(log);

  const engine = createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: vault,
    clock: new ConstantClock(100),
    surface: {
      cssWidth: () => 640,
      cssHeight: () => 360,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(engine);

  const warned: string[] = [];
  engine.events.on("asset:failed", (event) => {
    warned.push(`asset failed: ${event.path} (${event.reason})`);
  });

  before?.(engine);
  await engine.initialize();
  return { engine, log, target, warned };
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

type Announced =
  | { event: "loaded"; payload: EngineEventMap["asset:loaded"] }
  | { event: "failed"; payload: EngineEventMap["asset:failed"] };

describe("the audio-and-assets example", () => {
  it("loads the level's files under the asset root and reports the missing banner, one event per call", async () => {
    const announced: Announced[] = [];
    const { warned } = await boot((engine) => {
      // Construction performed no loading and ran no game code.
      expect(fetcher).not.toHaveBeenCalled();
      engine.events.on("asset:loaded", (payload) =>
        announced.push({ event: "loaded", payload }),
      );
      engine.events.on("asset:failed", (payload) =>
        announced.push({ event: "failed", payload }),
      );
    });

    // Every path resolved under the default root, in the order `load` named
    // them; the banner only after the two the level waits on.
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "assets/sprites/coins.png",
      "assets/audio/collect.wav",
      "assets/sprites/banner.png",
    ]);

    // Exactly one event per loader call: two arrivals, then the one failure,
    // each failure carrying the resolved URL and the reason.
    expect(announced).toHaveLength(3);
    expect(announced.slice(0, 2)).toEqual(
      expect.arrayContaining([
        {
          event: "loaded",
          payload: {
            path: "sprites/coins.png",
            url: "assets/sprites/coins.png",
          },
        },
        {
          event: "loaded",
          payload: {
            path: "audio/collect.wav",
            url: "assets/audio/collect.wav",
          },
        },
      ]),
    );
    expect(announced[2]).toEqual({
      event: "failed",
      payload: {
        path: "sprites/banner.png",
        url: "assets/sprites/banner.png",
        reason: expect.stringContaining("404"),
      },
    });

    // main.ts's own subscription, in place before the level loaded anything.
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/^asset failed: sprites\/banner\.png \(/);
    expect(warned[0]).toContain("404");

    // The instance holds what the level filled: the decoded sheet itself, and
    // the notice the instance's handler wrote from the failure.
    expect(instance().sheet).toBe(SHEET);
    expect(instance().notice).toMatch(/^sprites\/banner\.png unavailable: /);
    expect(instance().notice).toContain("404");
  });

  it("builds each coin from its own frame of the sheet and puts the notice on screen", async () => {
    const { engine, log } = await boot();
    const world = engine.world;

    // The world opened posed: three coins at their spots, the mode playing.
    const placed = world.byTag(COIN.tag);
    expect(placed).toHaveLength(3);
    expect(
      placed.map((coin) => ({ x: coin.transform.x, y: coin.transform.y })),
    ).toEqual(COIN.spots);
    expect(world.mode.phase).toBe("playing");

    // One frame drawn, before the first 1.2-second collection.
    await engine.advance(1);

    // Each coin blits a different 32x32 frame of the same image at 48x48,
    // centered on its transform — the destination carries the coin's world
    // position in the operation's own arguments.
    const draws = log.filter((entry) => entry.startsWith("ctx:drawImage("));
    expect(draws).toEqual(
      COIN.spots.map(
        (spot, index) =>
          `ctx:drawImage([object Object],${index * 32},0,32,32,${spot.x - 24},${spot.y - 24},48,48)`,
      ),
    );

    // The failed load is reported on screen: the notice actor drew its text.
    const texts = log.filter((entry) => entry.startsWith("ctx:fillText("));
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("sprites/banner.png unavailable:");
  });

  it("collects a coin every 1.2 seconds of simulated time, playing both kinds of cue", async () => {
    const played: Array<{ cue: string; t: number; gain: number }> = [];
    const phases: string[] = [];
    const { engine } = await boot((booting) => {
      booting.events.on("cue:played", (event) => played.push(event));
      booting.events.on("match:phase", ({ phase }) => phases.push(phase));
    });

    // Four seconds under a 100 ms scripted clock: collections at 1.2, 2.4, and
    // 3.6 seconds, the last one also playing the blip and ending the match.
    await engine.advance(40);

    expect(played.map((event) => event.cue)).toEqual([
      CUE.collect,
      CUE.collect,
      CUE.collect,
      CUE.blip,
    ]);
    // A file-backed cue reports unity gain; the synthesized blip its spec's.
    expect(played.map((event) => event.gain)).toEqual([1, 1, 1, 0.2]);

    // The timer runs on simulated world time, so each instant is the stated
    // period within one step of the clock.
    const bands: Array<[number, number]> = [
      [1200, 1300],
      [2400, 2500],
      [3600, 3700],
    ];
    for (const [index, [from, to]] of bands.entries()) {
      expect(played[index]?.t).toBeGreaterThanOrEqual(from);
      expect(played[index]?.t).toBeLessThanOrEqual(to);
    }
    // The blip plays in the same frame as the last collection.
    expect(played[3]?.t).toBe(played[2]?.t);

    expect(engine.world.byTag(COIN.tag)).toHaveLength(0);
    expect(engine.world.mode.phase).toBe("over");
    expect(phases).toEqual(["playing", "over"]);
  });

  it("emits a muted play at gain zero, and loops and stops either kind of cue once each", async () => {
    const { engine } = await boot();
    const world = engine.world;
    const events: Array<{ event: string; cue: string; gain?: number }> = [];
    engine.events.on("cue:played", ({ cue, gain }) =>
      events.push({ event: "played", cue, gain }),
    );
    engine.events.on("cue:looped", ({ cue, gain }) =>
      events.push({ event: "looped", cue, gain }),
    );
    engine.events.on("cue:stopped", ({ cue }) =>
      events.push({ event: "stopped", cue }),
    );

    // A play on a muted bus still reports its event, with `gain: 0`.
    world.audio.setMuted(true);
    expect(world.audio.muted()).toBe(true);
    world.audio.play(CUE.collect);
    expect(events).toEqual([{ event: "played", cue: CUE.collect, gain: 0 }]);
    world.audio.setMuted(false);
    expect(world.audio.muted()).toBe(false);

    // Either kind is looped by name and ended by name, each announced once —
    // a repeated request in either direction announces nothing.
    events.length = 0;
    world.audio.loop(CUE.collect);
    world.audio.loop(CUE.blip);
    world.audio.loop(CUE.collect);
    world.audio.stop(CUE.collect);
    world.audio.stop(CUE.blip);
    world.audio.stop(CUE.collect);
    expect(events).toEqual([
      { event: "looped", cue: CUE.collect, gain: 1 },
      { event: "looped", cue: CUE.blip, gain: 0.2 },
      { event: "stopped", cue: CUE.collect },
      { event: "stopped", cue: CUE.blip },
    ]);
  });

  it("opens the audio context on the first pointer or key event, announcing the unlock once", async () => {
    let unlocks = 0;
    const { target } = await boot((engine) => {
      engine.events.on("audio:unlocked", () => {
        unlocks += 1;
      });
    });

    expect(unlocks).toBe(0);
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(unlocks).toBe(1);
  });

  it("fails a refused path with an empty URL, and a missing file with the resolved one", async () => {
    const { engine } = await boot();
    const failures: EngineEventMap["asset:failed"][] = [];
    engine.events.on("asset:failed", (payload) => failures.push(payload));

    await expect(engine.world.assets.load("../outside.png")).rejects.toThrow(
      /escapes the asset root/,
    );
    await expect(
      engine.world.assets.load("sprites/banner.png"),
    ).rejects.toThrow(/404/);

    expect(failures).toEqual([
      {
        path: "../outside.png",
        url: "",
        reason: expect.stringContaining("escapes the asset root"),
      },
      {
        path: "sprites/banner.png",
        url: "assets/sprites/banner.png",
        reason: expect.stringContaining("404"),
      },
    ]);
  });
});
