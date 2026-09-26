// The kit, driven against an engine of the shape the contract declares.
//
// The fake in `./engine-fake` carries exactly the members all four engines share
// and not one more, so a kit that reached for anything engine-specific fails
// here rather than in a case's validator project three passes from now.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyDriver, type PureDriver } from "../src/engine/driver";
import { DevicePointerEvent, PointerPositionEvent } from "../src/engine/events";
import {
  createEngineCaseHarness,
  type EngineCaseConfig,
  type EngineHarness,
} from "../src/engine/kit";
import { MEDIA_DIR_ENV } from "../src/media";
import {
  FAKE_READINGS,
  FakeEngine,
  FixedClock,
  type FakeOptions,
  type FakeSnapshot,
  type FakeState,
  type FakeSurface,
} from "./engine-fake";

const STAGE = { width: 200, height: 100 };
const PROJECT_ROOT = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

type Driver = PureDriver<Readonly<FakeState>, FakeState, FakeSurface>;
type H = EngineHarness<FakeSnapshot, Driver, FakeEngine>;

function buildKit(
  fake: FakeOptions = {},
  extra: Partial<
    EngineCaseConfig<FakeSnapshot, Driver, FakeEngine, unknown>
  > = {},
) {
  let built: FakeEngine | null = null;
  const kit = createEngineCaseHarness<
    FakeSnapshot,
    Driver,
    FakeEngine,
    unknown
  >({
    slug: "fake",
    projectRoot: PROJECT_ROOT,
    stage: STAGE,
    tickHz: 60,
    surfaceRequirement: "a debug surface beside the state",
    recorder: { measureText: true },
    defaultClock: () => new FixedClock(1000 / 60),
    createEngine: ({ canvas, clock, surface }) => {
      built = new FakeEngine(canvas, clock, surface, {
        stage: STAGE,
        ...fake,
      });
      return built;
    },
    driver: (engine, raw) =>
      applyDriver<Readonly<FakeState>, FakeState, Driver>(engine, raw, {
        readings: FAKE_READINGS,
        // The one place a snapshot is narrowed on this engine, which is what
        // makes `h.snapshot()` and a sweep's reads agree.
        project: (op, value) =>
          op === "snapshot"
            ? { ...(value as FakeSnapshot), frame: engine.frame().count }
            : value,
      }),
    snapshot: (debug) => debug.snapshot(),
    ...extra,
  });
  return { kit, engine: () => built as FakeEngine };
}

/* ---- building ------------------------------------------------------------- */

it("builds an engine over its own canvas and initializes the game", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  expect(h.canvas.width).toBe(STAGE.width);
  expect(h.canvas.height).toBe(STAGE.height);
  expect(h.snapshot()).toEqual({ screen: "title", count: 0, frame: 0 });
  h.dispose();
});

it("reports the window the caller asked for, in device pixels", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness({ cssWidth: 400, cssHeight: 200, dpr: 2 });
  expect(h.shape).toEqual({ cssWidth: 400, cssHeight: 200, dpr: 2 });
  expect(h.canvas.width).toBe(800);
  expect(h.canvas.height).toBe(400);
  h.dispose();
});

it("disposes through the engine's own destroy", async () => {
  const { kit, engine } = buildKit();
  const h = await kit.createHarness();
  h.dispose();
  expect(engine().destroyed).toBe(1);
});

it("hands the case whatever else its harness carries, read fresh each time", async () => {
  const { kit } = buildKit(
    {},
    {
      extend: (_base, engine, initialized) => ({
        get live() {
          return engine.state.count;
        },
        initialized,
      }),
    },
  );
  const h = (await kit.createHarness()) as H & {
    live: number;
    initialized: unknown;
  };
  expect(h.initialized).toBe("initialized");
  expect(h.live).toBe(0);
  h.debug.bump(3);
  expect(h.live).toBe(3);
  h.dispose();
});

/* ---- the frame ------------------------------------------------------------ */

it("counts the frames it drove, in frames and in ticks alike", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  await h.advance(5);
  expect(h.frame()).toBe(5);
  expect(h.tick()).toBe(5);
  expect(h.timeMs()).toBeCloseTo(5 * (1000 / 60), 6);
  h.dispose();
});

it("takes the caller's clock when it is given one", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness({ clock: new FixedClock(100) });
  await h.advance(3);
  expect(h.timeMs()).toBe(300);
  h.dispose();
});

/* ---- the sweep ------------------------------------------------------------ */

it("a sweep whose predicate already holds runs no frames at all", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  const found = await h.until((s) => s.screen === "title");
  expect(found).toEqual({
    hit: true,
    frames: 0,
    ticks: 0,
    snapshot: { screen: "title", count: 0, frame: 0 },
  });
  h.dispose();
});

it("a sweep reports the frames it ran before the sample that ended it", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  const found = await h.until((s) => s.frame >= 4);
  expect(found.hit).toBe(true);
  expect(found.frames).toBe(4);
  expect(found.ticks).toBe(4);
  h.dispose();
});

it("a sweep that never holds stops at its bound, under either spelling", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  expect(await h.until(() => false, { maxFrames: 7 })).toMatchObject({
    hit: false,
    frames: 7,
    ticks: 7,
  });
  expect(await h.until(() => false, { maxTicks: 3 })).toMatchObject({
    hit: false,
    frames: 3,
  });
  h.dispose();
});

it("a polled sweep advances in steps and never overruns its bound", async () => {
  const { kit } = buildKit();
  const h = await kit.createHarness();
  const found = await h.until(() => false, { maxFrames: 10, poll: 4 });
  expect(found.frames).toBe(10);
  expect(h.frame()).toBe(10);
  h.dispose();
});

/* ---- input ---------------------------------------------------------------- */

it("raises key events on the target the engine listens on", async () => {
  const { kit, engine } = buildKit();
  const h = await kit.createHarness();
  h.hold("KeyA");
  h.release("KeyA");
  await h.tap("Space");
  expect(
    engine().received.map((event) => [
      event.type,
      (event as unknown as { code: string }).code,
    ]),
  ).toEqual([
    ["keydown", "KeyA"],
    ["keyup", "KeyA"],
    ["keydown", "Space"],
    ["keyup", "Space"],
  ]);
  // A tap runs the one frame that delivers its edge.
  expect(h.frame()).toBe(1);
  h.dispose();
});

it("maps a logical point out through the fit, exactly, by default", async () => {
  const { kit, engine } = buildKit();
  const h = await kit.createHarness();
  h.pointer("pointerdown", 10.5, 20.5);
  const [event] = engine().received;
  expect(event).toBeInstanceOf(PointerPositionEvent);
  expect((event as PointerPositionEvent).clientX).toBe(10.5);
  expect((event as PointerPositionEvent).clientY).toBe(20.5);
  h.dispose();
});

it("rounds to the device pixel a reading would sample when the case asks", async () => {
  const { kit, engine } = buildKit({}, { pointerPrecision: "device-pixel" });
  const h = await kit.createHarness();
  h.pointer("pointermove", 10.5, 20.4);
  const [event] = engine().received;
  expect((event as PointerPositionEvent).clientX).toBe(11);
  expect((event as PointerPositionEvent).clientY).toBe(20);
  h.dispose();
});

it("carries the device and its buttons when the case dispatches that event", async () => {
  const { kit, engine } = buildKit(
    {},
    {
      pointerEvent: (type, x, y, device) =>
        new DevicePointerEvent(type, x, y, device ?? "mouse"),
    },
  );
  const h = await kit.createHarness();
  h.pointer("pointerdown", 1, 2, "touch");
  h.pointer("pointerup", 1, 2);
  const [down, up] = engine().received as DevicePointerEvent[];
  expect(down?.pointerType).toBe("touch");
  expect(down?.buttons).toBe(1);
  expect(up?.pointerType).toBe("mouse");
  expect(up?.buttons).toBe(0);
  h.dispose();
});

it("maps a point through the case's own projection when one is given", async () => {
  const { kit } = buildKit(
    {},
    { toLogical: (_engine, x, y) => ({ x: x + 100, y: y + 50 }) },
  );
  const h = await kit.createHarness();
  expect(h.device(0, 0)).toEqual({ x: 100, y: 50 });
  h.dispose();
});

it("addresses a pixel through the engine's own fit, at any shape", async () => {
  const { kit } = buildKit({
    render: (ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 1000, 1000);
    },
  });
  const h = await kit.createHarness({ cssWidth: 400, cssHeight: 200, dpr: 1 });
  expect(h.viewport().scale).toBe(2);
  expect(h.device(10, 10)).toEqual({ x: 20, y: 20 });
  await h.advance(1);
  expect(h.pixel(10, 10)).toEqual([255, 0, 0, 255]);
  h.dispose();
});

/* ---- what the frame left -------------------------------------------------- */

it("collects the calls the render made", async () => {
  const { kit } = buildKit({
    render: (ctx, state) => {
      ctx.fillText(`count ${state.count}`, 4, 8);
    },
  });
  const h = await kit.createHarness();
  await h.advance(2);
  expect(h.calls.filter((call) => call.kind === "call")).toHaveLength(2);
  h.dispose();
});

it("stamps every cue with the frame that was running when it sounded", async () => {
  const { kit } = buildKit({ cuePerFrame: "tick" });
  const h = await kit.createHarness();
  await h.advance(3);
  expect(h.cues.map((cue) => cue.frame)).toEqual([1, 2, 3]);
  expect(h.cues.map((cue) => cue.tick)).toEqual([1, 2, 3]);
  expect(h.cues[0]).toMatchObject({ cue: "tick", gain: 1, looped: false });
  h.dispose();
});

it("a cue watcher collects only what sounded after it was armed", async () => {
  const { kit } = buildKit({ cuePerFrame: "tick" });
  const h = await kit.createHarness();
  await h.advance(2);
  const watched = kit.watchCues(h);
  await h.advance(2);
  expect(watched.map((cue) => cue.frame)).toEqual([3, 4]);
  expect(h.cues).toHaveLength(4);
  h.dispose();
});

it("named cues are filtered, and clearing forgets the section before", async () => {
  const { kit } = buildKit({ cuePerFrame: "tick" });
  const h = await kit.createHarness();
  await h.advance(2);
  expect(kit.cuesNamed(h, "tick")).toHaveLength(2);
  expect(kit.cuesNamed(h, "thud")).toHaveLength(0);
  kit.clearCues(h);
  expect(h.cues).toHaveLength(0);
  await h.advance(1);
  expect(kit.cuesNamed(h, "tick")).toHaveLength(1);
  h.dispose();
});

it("subscribes cue:played alone unless the case asks for loops too", async () => {
  const { kit } = buildKit({ cuePerFrame: "tick" });
  const h = await kit.createHarness();
  await h.advance(1);
  // A LOOP IS NOT A PLAY: a case that counts firings would have every count
  // moved by folding the two together.
  expect(kit.config.cueEvents).toBeUndefined();
  expect(h.cues.every((cue) => !cue.looped)).toBe(true);
  h.dispose();
});

it("collects the assets the build failed to load during initialize", async () => {
  const { kit } = buildKit({
    failAsset: { path: "assets/core.png", reason: "404" },
  });
  const h = await kit.createHarness();
  expect(h.assetFailures).toEqual([{ path: "assets/core.png", reason: "404" }]);
  h.dispose();
});

/* ---- the missing surface -------------------------------------------------- */

it("a build that returned no surface fails the CHECK, not the build of the harness", async () => {
  const { kit } = buildKit({ debug: null });
  // The harness is built. Teardown runs. The fault lands where a check reaches.
  const h = await kit.createHarness();
  expect(() => h.snapshot()).toThrow(/engine\.debug holds null/);
  expect(() => h.debug.setScreen("select")).toThrow(
    /a debug surface beside the state/,
  );
  h.dispose();
});

/* ---- evidence ------------------------------------------------------------- */

let mediaDir: string | null = null;

beforeEach(() => {
  mediaDir = mkdtempSync(join(tmpdir(), "case-harness-still-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
});

afterEach(() => {
  delete process.env[MEDIA_DIR_ENV];
  if (mediaDir !== null) rmSync(mediaDir, { recursive: true, force: true });
  mediaDir = null;
});

it("writes a still as a PNG under the suite's own staged address", async () => {
  const { kit } = buildKit({
    render: (ctx) => {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, 200, 100);
    },
  });
  const h = await kit.createHarness();
  await h.advance(1);
  kit.captureStill(h, "posed");

  const at = join(
    mediaDir as string,
    "validation",
    "engine-kit.spec.ts",
    "posed.png",
  );
  const bytes = readFileSync(at);
  // A real PNG, signature and all — the picture the build actually drew.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  h.dispose();
});

it("writes nothing at all when nobody is collecting", async () => {
  delete process.env[MEDIA_DIR_ENV];
  const { kit } = buildKit();
  const h = await kit.createHarness();
  await h.advance(1);
  kit.captureStill(h, "posed");
  expect(readdirSync(mediaDir as string)).toEqual([]);
  h.dispose();
});

it("refuses a project root the running suite is not inside", async () => {
  const { kit } = buildKit(
    {},
    { projectRoot: join(tmpdir(), "somewhere-else") },
  );
  const h = await kit.createHarness();
  await h.advance(1);
  // A wrong root is the one failure the writers cannot report, because they are
  // required not to raise — so it is raised here instead of quietly misplacing
  // every output the run collects.
  expect(() => kit.captureStill(h, "posed")).toThrow(
    /is not inside the validator project/,
  );
  h.dispose();
});

/* ---- the tick arithmetic --------------------------------------------------- */

it("binds the tick arithmetic to the rate the case steps at", () => {
  const { kit } = buildKit();
  expect(kit.TICK_HZ).toBe(60);
  expect(kit.TICK_MS).toBeCloseTo(1000 / 60, 9);
  expect(kit.seconds(30)).toBe(0.5);
  expect(kit.ticksFor(0.5)).toBe(30);
});
