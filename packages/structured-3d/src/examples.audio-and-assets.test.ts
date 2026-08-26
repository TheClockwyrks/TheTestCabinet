import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Actor } from "./actors";
import type { MaterialHandle, MeshHandle } from "./assets";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { MeshComponent, TextComponent } from "./components";
import type { DrawOp, Recording } from "./contract";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import { quatFromAxisAngle } from "./math";
import type { LoadApi } from "./worlds";

/**
 * The documentation's worked example "Audio and Assets", transcribed and run.
 * The page's modules below — the constants, the instance with its module
 * accessor, `src/game.ts` with its `load` function, and `VaultMode` — are
 * copied from the page unchanged. Only what a test environment forces is
 * adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and the engine takes
 *   its measurements from an injected `SurfaceMetrics`.
 * - The page's asset tree is served by whatever hosts the build. There is no
 *   server here, so `fetch` answers from an in-memory tree with the same URLs
 *   the asset root resolves — a real `.glb`, a real material document with its
 *   two `.png` maps, and a real PCM `.wav`, each built byte by byte — and
 *   `textures/banner.png`, which "names a file this workspace holds no copy
 *   of", answers 404. The engine decodes all of it itself, so nothing else
 *   about the load path changes.
 * - `engine.run()` becomes `engine.advance` under a `ConstantClock` worth a
 *   tenth of a second, so the timer's 1.2 seconds is twelve frames exactly and
 *   a check names a duration rather than a tolerance.
 *
 * The assertions are the outcomes the page narrates: the subscription that
 * beats every load because construction runs no game code, the level's `load`
 * awaited before any actor exists, the material folder as one call and one
 * event, the caught optional load whose failure the event still reports, the
 * two kinds of cue and their events, the mute bit, the first-gesture unlock,
 * and the timer running on simulated world time.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — transcribed verbatim                                    */
/* -------------------------------------------------------------------------- */

const LEVEL = "vault";

const PATH = {
  coin: "models/coin.glb",
  gold: "materials/gold/material.json",
  sound: "audio/collect.wav",
  banner: "textures/banner.png",
};

const CUE = { collect: "collect", blip: "blip" } as const;

const COIN = {
  tag: "coin",
  spots: [
    { x: -4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ],
};

/* -------------------------------------------------------------------------- */
/* src/instance.ts — transcribed verbatim                                     */
/* -------------------------------------------------------------------------- */

let built: VaultInstance | null = null;

/** The instance the engine built, reachable from the level's own modules. */
function instance(): VaultInstance {
  if (built === null) throw new Error("the game instance is not built yet");
  return built;
}

class VaultInstance extends GameInstance<null> {
  coin: MeshHandle | null = null;
  gold: MaterialHandle | null = null;
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
/* src/levels/vault-mode.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

class VaultMode extends GameMode {
  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 3, z: 10 };
    this.world.camera.lookAt({ x: 0, y: 0.5, z: 0 });
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
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const coins = COIN.spots.map((spot, index) => ({
  type: Actor,
  transform: {
    position: spot,
    rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, index * (Math.PI / 3)),
  },
  tags: [COIN.tag],
  configure: (actor: Actor) => {
    const game = instance();
    if (game.coin === null) return;
    actor.attach(
      new MeshComponent({
        mesh: game.coin,
        material: game.gold ?? undefined,
      }),
    );
  },
}));

const notice = {
  type: Actor,
  transform: { position: { x: 0, y: 2.5, z: 0 } },
  configure: (actor: Actor) => {
    const text = instance().notice;
    if (text === null) return;
    actor.attach(
      new TextComponent({ text, fill: "#ffb4a2", font: "0.8px sans-serif" }),
    );
  },
};

async function load(api: LoadApi): Promise<void> {
  const game = instance();
  const [coin, gold] = await Promise.all([
    api.assets.loadMesh(PATH.coin),
    api.assets.loadMaterial(PATH.gold),
    api.audio.load(CUE.collect, PATH.sound),
  ]);
  game.coin = coin;
  game.gold = gold;
  await api.assets.loadTexture(PATH.banner).catch(() => null);
}

const vault: GameDefinition<null> = {
  instance: VaultInstance,
  levels: { [LEVEL]: { mode: VaultMode, load, actors: [...coins, notice] } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* The asset tree, built byte by byte and served by a stubbed `fetch`         */
/* -------------------------------------------------------------------------- */

/** PNG chunks behind the signature; the decoder here does not read the CRCs. */
function pngOf(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const size = chunks.reduce((sum, [, body]) => sum + 12 + body.length, 8);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let at = 8;
  for (const [type, body] of chunks) {
    view.setUint32(at, body.length);
    for (let i = 0; i < 4; i += 1) out[at + 4 + i] = type.charCodeAt(i);
    out.set(body, at + 8);
    at += 12 + body.length;
  }
  return out;
}

/** A 1×1 8-bit RGBA PNG of one color, written with a stored deflate block. */
function onePixelPng(
  rgba: readonly [number, number, number, number],
): Uint8Array {
  const raw = Uint8Array.from([0, ...rgba]);
  const zlib = new Uint8Array(2 + 5 + raw.length + 4);
  zlib.set([0x78, 0x01, 1, raw.length & 0xff, 0, ~raw.length & 0xff, 0xff], 0);
  zlib.set(raw, 7);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  zlib.set(
    [(b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff],
    7 + raw.length,
  );

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return pngOf([
    ["IHDR", ihdr],
    ["IDAT", zlib],
    ["IEND", new Uint8Array(0)],
  ]);
}

/** A glTF binary of one triangle, with the bounds the accessor declares. */
function coinGlb(): Uint8Array {
  const data = Float32Array.from([-1, 0, -1, 1, 0, -1, 0, 0, 1]);
  const bin = new Uint8Array(data.buffer.slice(0));
  const json = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "coin", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, 0, -1],
        max: [1, 0, 1],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = (raw.length + 3) & ~3;
  const binPadded = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jsonPadded + 8 + binPadded);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(raw, 20);
  out.fill(0x20, 20 + raw.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  view.setUint32(binStart, binPadded, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}

/** A mono 16-bit integer PCM WAV at 8 kHz — what the tools produce. */
function collectWav(): Uint8Array {
  const samples = Array.from({ length: 64 }, (_, i) =>
    Math.round(Math.sin((i / 64) * Math.PI * 8) * 8_000),
  );
  const dataLength = samples.length * 2;
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataLength, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return out;
}

/**
 * The tree the page lists, keyed by the URL the default asset root resolves.
 * `textures/banner.png` is deliberately absent.
 */
function assetTree(): Record<string, Uint8Array | string> {
  return {
    "assets/models/coin.glb": coinGlb(),
    "assets/materials/gold/material.json": JSON.stringify({
      maps: { baseColor: "basecolor.png", roughness: "roughness.png" },
    }),
    "assets/materials/gold/basecolor.png": onePixelPng([230, 190, 90, 255]),
    "assets/materials/gold/roughness.png": onePixelPng([90, 90, 90, 255]),
    "assets/audio/collect.wav": collectWav(),
  };
}

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the forced adaptations                     */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/** What one frame is worth, chosen so the level's 1.2-second timer is exact. */
const STEP_MS = 100;
const TIMER_FRAMES = 12;

interface Announced {
  event: "asset:loaded" | "asset:failed";
  path: string;
  reason?: string;
}

interface Vault {
  readonly engine: Engine<null>;
  readonly announced: Announced[];
  readonly cues: { event: string; cue?: string; gain?: number; t?: number }[];
  readonly requested: string[];
  gesture(): void;
  dispose(): void;
}

function makeEngine(): {
  engine: Engine<null>;
  announced: Announced[];
  cues: Vault["cues"];
  target: EventTarget;
} {
  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => target,
  };

  const engine = createEngine<null>({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: vault,
    clock: new ConstantClock(STEP_MS),
    surface,
  });

  // The page's own subscription, made on the engine the moment it exists:
  // "Construction performs no loading and runs no game code, so this
  // subscription is in place before the instance is built and before the start
  // level loads anything."
  const announced: Announced[] = [];
  engine.events.on("asset:loaded", ({ path }) =>
    announced.push({ event: "asset:loaded", path }),
  );
  engine.events.on("asset:failed", ({ path, reason }) =>
    announced.push({ event: "asset:failed", path, reason }),
  );

  const cues: Vault["cues"] = [];
  engine.events.on("cue:played", ({ cue, gain, t }) =>
    cues.push({ event: "cue:played", cue, gain, t }),
  );
  engine.events.on("cue:looped", ({ cue, gain }) =>
    cues.push({ event: "cue:looped", cue, gain }),
  );
  engine.events.on("cue:stopped", ({ cue }) =>
    cues.push({ event: "cue:stopped", cue }),
  );
  engine.events.on("audio:unlocked", () =>
    cues.push({ event: "audio:unlocked" }),
  );

  return { engine, announced, cues, target };
}

async function boot(): Promise<Vault> {
  const { engine, announced, cues, target } = makeEngine();
  const requested: string[] = [];
  const tree = assetTree();

  vi.stubGlobal("fetch", (url: string) => {
    requested.push(url);
    const body = tree[url];
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        blob: () => Promise.resolve(new Blob([])),
        text: () => Promise.resolve(""),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as Response);
    }
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : body;
    return Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])),
      text: () => Promise.resolve(new TextDecoder().decode(bytes)),
      arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
    } as unknown as Response);
  });

  await engine.initialize();

  return {
    engine,
    announced,
    cues,
    requested,
    gesture: () =>
      target.dispatchEvent(
        Object.assign(new Event("keydown"), { code: "KeyZ", repeat: false }),
      ),
    dispose: () => engine.destroy(),
  };
}

/** The calls one recorded frame issued, resolved out of the shared table. */
function frameCalls(
  recording: Recording,
  index: number,
): Extract<DrawOp, { op: "call" }>[] {
  const frame = recording.frames[index];
  if (frame === undefined) throw new Error(`no frame ${index}`);
  return frame.ops
    .map((op) => recording.ops[op])
    .filter((op): op is Extract<DrawOp, { op: "call" }> => op?.op === "call");
}

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("examples/audio-and-assets", () => {
  let vaultGame: Vault;

  beforeEach(async () => {
    vaultGame = await boot();
  });

  afterEach(() => {
    vaultGame.dispose();
    vi.unstubAllGlobals();
  });

  it("emits one event per loader call, the material folder included", () => {
    // "Each loader emits exactly one event per call: `asset:loaded` with the
    // path and the URL it resolved to, or `asset:failed` with the reason as
    // well. ... `loadMaterial` is one call and one event even though it
    // fetches every map the document names."
    const { announced, requested } = vaultGame;
    // The three successful loads run under one `Promise.all`, so the set is
    // what the page fixes and not the order they settle in.
    expect(
      announced
        .filter((entry) => entry.event === "asset:loaded")
        .map((entry) => entry.path)
        .sort(),
    ).toEqual([PATH.sound, PATH.coin, PATH.gold].sort());
    expect(announced.filter((entry) => entry.path === PATH.gold)).toHaveLength(
      1,
    );
    // Both of the document's maps were fetched all the same.
    expect(requested).toContain("assets/materials/gold/basecolor.png");
    expect(requested).toContain("assets/materials/gold/roughness.png");
  });

  it("reports the optional load the build caught, before any actor existed", () => {
    // "The banner is optional to this build, so its rejection is caught; the
    // failure itself is reported by the event", and the subscription was made
    // at construction, before the instance was built.
    const { announced } = vaultGame;
    const failures = announced.filter(
      (entry) => entry.event === "asset:failed",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.path).toBe(PATH.banner);
    expect(failures[0]?.reason).toContain("404");

    // "The instance's handler writes the reason onto a field, and the notice
    // actor's `configure` reads that field when the world is built."
    const text = `${PATH.banner} unavailable: ${failures[0]?.reason ?? ""}`;
    expect(instance().notice).toBe(text);
    const label = vaultGame.engine.world
      .actors()
      .flatMap((actor) => actor.componentsOf(TextComponent));
    expect(label).toHaveLength(1);
    expect(label[0]?.text).toBe(text);
  });

  it("awaits the level's load before any actor exists", () => {
    // "The engine awaits `load` before any actor exists, so `configure` reads
    // the mesh as a plain `MeshHandle` and hands it to a `MeshComponent`."
    const world = vaultGame.engine.world;
    const game = instance();
    expect(game.coin?.path).toBe(PATH.coin);
    expect(game.gold?.path).toBe(PATH.gold);
    expect(Object.keys(game.gold?.maps ?? {})).toEqual([
      "baseColor",
      "roughness",
    ]);

    const meshes = world
      .byTag(COIN.tag)
      .flatMap((actor) => actor.componentsOf(MeshComponent));
    expect(meshes).toHaveLength(COIN.spots.length);
    for (const mesh of meshes) {
      expect(mesh.mesh).toBe(game.coin);
      expect(mesh.material).toBe(game.gold);
    }
  });

  it("faces each coin differently, around the world's up axis", () => {
    // "Each coin draws the same mesh at a different facing, built with
    // `quatFromAxisAngle` around the world's up axis."
    const spots = vaultGame.engine.world.byTag(COIN.tag);
    spots.forEach((actor, index) => {
      const expected = quatFromAxisAngle(
        { x: 0, y: 1, z: 0 },
        index * (Math.PI / 3),
      );
      expect(actor.transform.position).toEqual(COIN.spots[index]);
      expect(actor.transform.rotation.x).toBeCloseTo(expected.x, 12);
      expect(actor.transform.rotation.y).toBeCloseTo(expected.y, 12);
      expect(actor.transform.rotation.z).toBeCloseTo(expected.z, 12);
      expect(actor.transform.rotation.w).toBeCloseTo(expected.w, 12);
    });
  });

  it("draws the notice as a billboard 0.8 units of text tall", async () => {
    // "The notice is a `TextComponent`, which draws as a camera-facing
    // billboard at the actor's world position with its font size read as world
    // units of text height, so `0.8px` letters 0.8 units tall over the coins."
    const { engine } = vaultGame;
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const billboards = frameCalls(recording, 0).filter(
      (call) => call.method === "drawBillboard",
    );
    expect(billboards).toHaveLength(1);
    expect(billboards[0].args[1]).toEqual({ x: 0, y: 2.5, z: 0 });
    const text = instance().notice ?? "";
    expect(billboards[0].args[2]).toEqual({
      x: (text.length * 0.8) / 2,
      y: 0.8,
    });
  });

  it("collects on simulated world time, whichever kind of cue it plays", async () => {
    // "A cue is played by name from `world.audio`, whichever kind it is. The
    // timer runs on simulated world time, so a scripted clock collects at the
    // same rate."
    const { engine, cues } = vaultGame;
    const world = engine.world;
    expect(world.byTag(COIN.tag)).toHaveLength(3);

    // 1.2 simulated seconds is twelve frames of a tenth of a second.
    await engine.advance(TIMER_FRAMES);
    expect(world.byTag(COIN.tag)).toHaveLength(2);
    expect(cues.map((entry) => entry.cue)).toEqual([CUE.collect]);
    expect(cues[0]?.t).toBeCloseTo(1200, 6);

    await engine.advance(TIMER_FRAMES);
    expect(world.byTag(COIN.tag)).toHaveLength(1);

    // The third take empties the vault: the file-backed cue and the
    // synthesized one both play, and the match is over.
    await engine.advance(TIMER_FRAMES);
    expect(world.byTag(COIN.tag)).toHaveLength(0);
    expect(cues.map((entry) => entry.cue)).toEqual([
      CUE.collect,
      CUE.collect,
      CUE.collect,
      CUE.blip,
    ]);
    expect(world.mode.phase).toBe("over");
    expect(world.state.phase).toBe("over");
  });

  it("reports a muted play with no gain, and the bit that made it so", async () => {
    // "a play on a muted bus reports that event with `gain: 0`. ...
    // `world.audio.setMuted` sets the mute bit and `world.audio.muted()`
    // reports it."
    const { engine, cues } = vaultGame;
    const world = engine.world;
    expect(world.audio.muted()).toBe(false);

    world.audio.play(CUE.blip);
    expect(cues.at(-1)?.gain).toBeGreaterThan(0);

    world.audio.setMuted(true);
    expect(world.audio.muted()).toBe(true);
    world.audio.play(CUE.collect);
    expect(cues.at(-1)).toEqual({
      event: "cue:played",
      cue: CUE.collect,
      gain: 0,
      t: 0,
    });
  });

  it("loops and stops either kind by name, emitting each event once", async () => {
    // "Either kind is looped by name through `world.audio.loop` and ended
    // through `world.audio.stop`, which emit `cue:looped` and `cue:stopped`
    // once each."
    const { engine, cues } = vaultGame;
    const world = engine.world;

    world.audio.loop(CUE.collect);
    world.audio.loop(CUE.collect);
    expect(world.audio.looping(CUE.collect)).toBe(true);
    world.audio.stop(CUE.collect);
    world.audio.stop(CUE.collect);
    expect(world.audio.looping(CUE.collect)).toBe(false);

    expect(cues.map((entry) => entry.event)).toEqual([
      "cue:looped",
      "cue:stopped",
    ]);
  });

  it("opens the audio context on the first gesture it sees", async () => {
    // "The engine opens the audio context on the first pointer or key event it
    // sees and emits `audio:unlocked` at that moment."
    const { cues } = vaultGame;
    expect(cues).toEqual([]);

    vaultGame.gesture();
    vaultGame.gesture();

    expect(cues).toEqual([{ event: "audio:unlocked" }]);
  });

  it("keeps a cue defined from InitApi playable after a transition", async () => {
    // "A cue defined here belongs to the engine rather than to a world, so
    // `blip` is playable from every level and survives every transition."
    const { engine, cues } = vaultGame;
    engine.world.open(LEVEL);
    await engine.advance(1);

    const reopened = engine.world;
    expect(reopened.level).toBe(LEVEL);
    reopened.audio.play(CUE.blip);
    expect(cues.at(-1)?.cue).toBe(CUE.blip);
    // The file-backed cue the level loaded is declared on the same bus, and
    // the reopened level loaded it again.
    reopened.audio.play(CUE.collect);
    expect(cues.at(-1)?.cue).toBe(CUE.collect);
    expect(engine.instance).toBe(instance());
  });
});
