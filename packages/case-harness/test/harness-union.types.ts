// The union interface, exercised in each of the four cases' vocabularies.
//
// A TYPE-LEVEL fixture, not a suite: it runs nothing and asserts nothing at run
// time, it is compiled by `npm run typecheck` and by nothing else, and its whole
// job is to fail that command if the shared `Harness` ever stops accepting a call
// one of the four cases already writes. `packages/case-harness/src` is otherwise
// compiled against no consumer at all — the staged validator trees are type-
// checked by nothing — so without this the six name splits the union reconciles
// (`frame`/`tick`, `advance`/`step`/`skip`, `until`/`stepUntil`/`skipUntil`,
// `maxFrames`/`maxTicks`, `frames`/`ticks`, `cue.frame`/`cue.tick`) could regress
// green and land as a few hundred `undefined`s at run time.
//
// Named `.types.ts` rather than `.spec.ts` deliberately: `vitest.config.ts`
// collects only `test/**/*.spec.ts`, and this is not a test.
import {
  createHarnessFactory,
  captureReplay,
  captureStill,
  watchCues,
  type Harness as BaseHarness,
  type UntilResult as BaseUntilResult,
} from "../src/harness";
import { BASE_REQUIRED_OPS } from "../src/config";

interface RefractSnapshot {
  screen: "title" | "playing";
  simTime: number;
}
interface RefractDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  snapshot(): Promise<RefractSnapshot>;
}

export type Harness = BaseHarness<RefractSnapshot, RefractDebugApi>;
export type UntilResult = BaseUntilResult<RefractSnapshot>;

export const createHarness = createHarnessFactory<
  RefractSnapshot,
  RefractDebugApi
>({
  slug: "refract",
  handle: "__refract",
  requiredOps: [...BASE_REQUIRED_OPS, "advance"],
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: 1280, height: 720 },
  projectRoot: "/tmp/refract",
  arm: { kind: "click", x: 2, y: 2 },
  tickHz: 60,
});

export async function refractShapes(h: Harness): Promise<void> {
  await h.advance(3);
  const r: UntilResult = await h.until((s) => s.screen === "playing", {
    maxFrames: 240,
  });
  const n: number = r.frames;
  const f: number = h.frame();
  const cues = watchCues(h);
  const at: number = cues[0]!.frame;
  await h.tap("Enter");
  await captureStill(h, "still");
  const got: number = await captureReplay(h, "run", async () => {
    await h.advance(2);
    return 1;
  });
  void [n, f, at, got, h.css(1, 1), await h.sounds(), await h.debug.snapshot()];
}

interface VoluteSnapshot {
  screen: "title" | "playing";
}
interface VoluteDebugApi {
  step(ticks: number): Promise<void>;
}
type VoluteHarness = BaseHarness<VoluteSnapshot, VoluteDebugApi>;

export async function voluteShapes(h: VoluteHarness): Promise<void> {
  const s: VoluteSnapshot = await h.step(1);
  const r = await h.stepUntil((x) => x.screen === "playing", {
    maxTicks: 4000,
  });
  const t: number = r.ticks;
  const seen: VoluteSnapshot[] = await h.stepWatching(
    10,
    (x) => x.screen === "title",
  );
  const tick: number = h.tick();
  const cue = watchCues(h)[0];
  await h.holdFor("KeyA", 5);
  await h.clickPointer(1, 2, "right");
  const rect = await h.pixelRect(0, 0, 4, 4);
  void [
    s,
    t,
    seen,
    tick,
    cue?.tick,
    rect.width,
    h.openingScreen,
    h.cssPoint(1, 1),
  ];
}

interface FathomSnapshot {
  screen: string;
}
type FathomHarness = BaseHarness<FathomSnapshot, { reset(): Promise<void> }>;

export async function fathomShapes(h: FathomHarness): Promise<void> {
  await h.advance(4);
  await h.skip(100);
  const r = await h.skipUntil((s) => s.screen === "playing", { maxTicks: 900 });
  const line = await h.scanDevice("row", 12);
  void [r.ticks, r.hit, line.length, h.tick()];
}

/** A free helper over any bound harness, as the cases write them. */
export function anyHarness(h: BaseHarness<unknown, object>): Promise<number> {
  return h.sounds();
}
export function acceptsBound(h: Harness): Promise<number> {
  return anyHarness(h);
}
export function acceptsPick(h: Pick<Harness, "pixels">): unknown {
  return h.pixels([{ x: 1, y: 1 }]);
}

/**
 * A drive widened from `Promise<void>` to `Promise<S>` is still fine to AWAIT and
 * fine to hand to a scenario, which is how every one of the ~450 call sites in
 * the four cases uses it. The one shape it would break — `return h.advance(1)`
 * from a helper explicitly annotated `Promise<void>` — appears nowhere in them.
 */
export async function awaited(h: Harness): Promise<void> {
  await h.advance(1);
  await captureReplay(h, "flight", () => h.advance(4));
}
