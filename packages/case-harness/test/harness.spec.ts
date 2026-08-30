// The harness itself: the reach into the page, the driven frame, and the
// readings a check makes off it.
//
// Everything here is checked against the fixture build rather than against a
// game, so a failure names the harness. The four cases' own `harness.test.ts`
// files could only ever ask "did the reference do something plausible"; these ask
// "did the harness do exactly what it says", against a build whose answers are
// arithmetic.

import { afterEach, beforeEach, expect, it } from "vitest";
import { callsTo, type DrawCall } from "../src/index";
import {
  CUE_EVERY,
  FIXTURE_DEBUG_VERSION,
  LANDMARK,
  REQUIRED_OPS,
  STAGE,
  TICK_MS,
  createHarness,
  watchCues,
  type Harness,
} from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the surface the specification requires, whole", async () => {
  expect(h.surfaceFault).toBeNull();
  const probed = await h.probe(REQUIRED_OPS);
  expect(probed.version).toBe(FIXTURE_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) expect(probed.ops[op], op).toBe("function");
});

it("opens the game off its own clock, at what it opened on", async () => {
  // `openingSnapshot` is read BEFORE the opening reset, which is the only moment
  // the state a fresh game stands itself up in is visible at all.
  expect(h.openingScreen).toBe("title");
  expect(h.openingSnapshot?.screen).toBe("title");

  const snapshot = await h.snapshot();
  expect(snapshot.auto).toBe(false);
  expect(snapshot.frames).toBe(0);
  expect(h.frame()).toBe(0);
});

it("counts a driven frame under both of its names", async () => {
  // `advance` answers nothing — three of the four cases declare it that way and
  // their suites hand it to helpers typed `() => Promise<void>` — so the frames
  // it ran are read back off the game and off the harness's own counters.
  const nothing = await h.advance(3);
  expect(nothing).toBeUndefined();
  expect((await h.snapshot()).frames).toBe(3);
  expect(h.frame()).toBe(3);
  expect(h.tick()).toBe(3);
  expect(h.timeMs()).toBeCloseTo(3 * TICK_MS, 9);

  // `step` is the same drive under the other of the two house names, and it is
  // the half of the pair that answers the state the frames left.
  expect((await h.step(2)).frames).toBe(5);
  expect(h.frame()).toBe(5);
});

it("runs the same frames for a skipped march as for a driven one", async () => {
  await h.advance(4);
  const nothing = await h.skip(20);

  // What `skip` saves is the recording, not the simulation: the game's own frame
  // count moved by all twenty-four, and so did the harness's. Like `advance` it
  // answers nothing, which is what the one case that spells it this way declares.
  expect(nothing).toBeUndefined();
  expect((await h.snapshot()).frames).toBe(24);
  expect(h.frame()).toBe(24);
  expect(h.timeMs()).toBeCloseTo(24 * TICK_MS, 9);
});

it("accepts either spelling of a sweep's bound, and answers in both", async () => {
  // 97 call sites across two of the four cases spell the bound `maxTicks` and
  // read the count back as `ticks`; the other two spell both the other way. They
  // are one bound and one count, so a sweep has to answer to all four names.
  const byFrames = await h.until((s) => s.frames >= 3, { maxFrames: 50 });
  expect(byFrames.hit).toBe(true);
  expect(byFrames.frames).toBe(3);
  expect(byFrames.ticks).toBe(3);

  // The count is what THIS sweep drove, so three more reach six.
  const byTicks = await h.stepUntil((s) => s.frames >= 6, { maxTicks: 50 });
  expect(byTicks.hit).toBe(true);
  expect(byTicks.frames).toBe(3);
  expect(byTicks.ticks).toBe(3);
  expect(h.frame()).toBe(6);

  // And the bound really bounds, under the spelling the package would otherwise
  // silently ignore in favour of its 600-frame default.
  const bounded = await h.stepUntil(() => false, { maxTicks: 5 });
  expect(bounded.hit).toBe(false);
  expect(bounded.ticks).toBe(5);
  expect(h.frame()).toBe(11);

  // A sweep that marches instead of driving runs the same frames.
  const marched = await h.skipUntil((s) => s.frames >= 20, { maxTicks: 50 });
  expect(marched.hit).toBe(true);
  expect((await h.snapshot()).frames).toBeGreaterThanOrEqual(20);
});

it("reports a hit at zero frames when the predicate already held", async () => {
  // The honest answer, and the trap the docblock names: a sweep samples before it
  // drives, so a check that sweeps for a state without first establishing it was
  // not already in it passes vacuously.
  const swept = await h.until((s) => s.screen === "title");
  expect(swept.hit).toBe(true);
  expect(swept.frames).toBe(0);
  expect(h.frame()).toBe(0);
});

it("hands every frame it drove to a watcher, one at a time", async () => {
  const seen = await h.stepWatching(5, (s) => s.frames === 3);

  // Stopped on the frame the watcher answered `true` on, with the whole history
  // up to it — which is what a check about a cadence reads.
  expect(seen.map((s) => s.frames)).toEqual([1, 2, 3]);
  expect(h.frame()).toBe(3);
});

it("holds a key across the frame that delivers it", async () => {
  // Down, one frame, up. A build that compares held state at the top of each
  // frame sees the key held on exactly one frame, and none afterwards.
  const tapped = await h.tap("KeyA");
  expect(tapped.heldTicks).toBe(1);
  // The snapshot a tap hands back is read while the key is still down — the
  // release comes after the frame, which is the whole point of the ordering.
  expect(tapped.keys).toEqual(["KeyA"]);
  expect((await h.snapshot()).keys).toEqual([]);
  expect(h.frame()).toBe(1);

  const heldFor = await h.holdFor("KeyB", 4);
  expect(heldFor.heldTicks).toBe(5);
  expect((await h.snapshot()).keys).toEqual([]);
});

it("moves the pointer in the CSS pixels the fit puts a logical point at", async () => {
  await h.movePointer(50, 25);
  const at = h.cssPoint(50, 25);
  expect(await h.snapshot()).toMatchObject({ pointer: { x: at.x, y: at.y } });

  const clicked = await h.clickPointer(60, 30);
  expect(clicked.clicks).toBe(1);
  expect(h.frame()).toBe(1);
});

it("reads the canvas through the fit, at more than one window shape", async () => {
  // The landmark never moves in LOGICAL units, so the same read has to find it at
  // any window shape — which is the whole of what `fitViewport` is for.
  expect([...(await h.pixel(LANDMARK.x, LANDMARK.y))]).toEqual([
    ...LANDMARK.rgba,
  ]);

  const wide = await createHarness({ cssWidth: 400, cssHeight: 300 });
  try {
    const view = wide.viewport();
    expect(view.scale).toBe(2);
    // 400x300 over a 2:1 stage letterboxes top and bottom, and nothing else.
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(50);

    expect([...(await wide.pixel(LANDMARK.x, LANDMARK.y))]).toEqual([
      ...LANDMARK.rgba,
    ]);
    // And the bar itself is the page's ground rather than the stage's.
    expect([...(await wide.devicePixel(10, 10))]).toEqual([0, 0, 0, 255]);
  } finally {
    await wide.dispose();
  }
});

it("reads a rectangle of the canvas, addressed in logical units", async () => {
  const rect = await h.pixelRect(LANDMARK.x, LANDMARK.y, 4, 4);
  expect(rect.width).toBe(4);
  expect(rect.height).toBe(4);
  expect([...rect.data.subarray(0, 4)]).toEqual([...LANDMARK.rgba]);

  // A scan of the row the landmark sits on finds it brighter than the ground.
  const row = await h.scanDevice("row", h.device(LANDMARK.x, LANDMARK.y).y);
  expect(row).toHaveLength(STAGE.width);
  expect(row[h.device(LANDMARK.x, LANDMARK.y).x]).toBeGreaterThan(row[0] ?? 0);
});

it("hands back the operations one frame's render issued", async () => {
  const calls = await h.frameCalls();

  expect(h.frame()).toBe(1);
  expect(callsTo(calls, "fillRect").length).toBeGreaterThanOrEqual(3);
  expect(callsTo(calls, "fillText")).toHaveLength(1);

  // And the same list again without driving anything, which is what `lastCalls`
  // is for: two readings of one frame rather than a reading that costs a frame.
  const again = await h.lastCalls();
  expect(h.frame()).toBe(1);
  expect(summarise(again)).toEqual(summarise(calls));
});

it("stamps a sound with the frame of the drive that produced it", async () => {
  await h.armAudio();
  await h.debug.startPlaying();

  const played = watchCues(h);
  const before = await h.sounds();
  await h.advance(CUE_EVERY * 2);

  // The fixture sounds on every fourth tick of live play and no other, so the
  // cues land on exactly the frames the drive counted them on — under both of the
  // names a cue carries its frame under.
  expect(played.map((cue) => cue.frame)).toEqual([CUE_EVERY, CUE_EVERY * 2]);
  expect(played.map((cue) => cue.tick)).toEqual([CUE_EVERY, CUE_EVERY * 2]);
  expect(played.map((cue) => cue.t)).toEqual([
    CUE_EVERY * TICK_MS,
    CUE_EVERY * 2 * TICK_MS,
  ]);
  expect(await h.sounds()).toBe(before + 2);
});

it("hands the game back to its own clock, and takes it back", async () => {
  // The one path that depends on real elapsed time, and the one no case but
  // three exercises at all.
  const before = (await h.snapshot()).frames;
  await h.runFor(250);
  const after = await h.snapshot();

  expect(after.frames).toBeGreaterThan(before);
  // And the game is back off the wall clock afterwards: a further wait moves
  // nothing.
  expect(after.auto).toBe(false);
  await h.page.waitForTimeout(120);
  expect((await h.snapshot()).frames).toBe(after.frames);
});

it("reports the canvas's own backing store, as the build sized it", async () => {
  const surface = await h.surface();
  expect(surface).toEqual({
    width: STAGE.width,
    height: STAGE.height,
    dpr: 1,
  });
});

/** A draw-call list as its shape alone, so two readings can be compared. */
function summarise(calls: readonly DrawCall[]): string[] {
  return calls.map((call) =>
    call.kind === "call"
      ? `${call.method}(${call.args.length})`
      : `${call.property}=`,
  );
}
