// One crossing instead of N: the four members that do in the page what the
// driven members do a round trip apart.
//
// A crossing into the page is a round trip to the browser, and what a round trip
// costs is a fact about how busy the HOST is rather than about the build — a few
// milliseconds on an idle machine and the better part of a tenth of a second on
// one running a model's build beside it. A scenario that poses forty drones one
// call at a time, or sweeps a hundred frames one round trip apart, has therefore
// made its own verdict a reading of the load average.
//
// WHAT THESE CHECKS ARE ABOUT IS EQUIVALENCE, not speed. Nothing here may change
// what the build runs, what a recording keeps or what a cue watch sees, so every
// check below puts a batched member beside the driven one it replaces and reads
// the same counters off both.
//
// The functions a check hands in are carried into the page AS SOURCE, so each
// must stand on its own: it sees the parameters it is handed and nothing else,
// and anything from the suite reaches it through `argument`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, watchCues, CUE_EVERY, type Harness } from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* ---- arrange -------------------------------------------------------------- */

it("runs a batch of surface calls in order, and reads what they left", async () => {
  // The same calls the build would receive one at a time, in the same order,
  // against the same game: the surface is synchronous inside the page, so a batch
  // and a run of separate calls leave it in the same arrangement.
  const arranged = await h.arrange([
    ["setX", 10],
    ["startPlaying"],
    ["setX", 42],
  ]);

  // In ORDER, which is the whole of what a batch has to promise: the second
  // `setX` is the one that stands.
  expect(arranged.x).toBe(42);
  expect(arranged.screen).toBe("playing");

  // And nothing advanced. A pose is an arrangement; `advance` is what runs it.
  expect(arranged.frames).toBe(0);
  expect(h.frame()).toBe(0);
  expect(await h.arrange([])).toMatchObject({ x: 42 });
});

/* ---- sweep ---------------------------------------------------------------- */

it("sweeps in the page for the frames the driven sweep would have run", async () => {
  // The equivalence this member rests on. `until` samples between round trips and
  // `sweep` samples inside the page; both run one frame at a time and stop on the
  // frame the predicate first holds, so the two report the same count.
  const driven = await h.until((snapshot) => snapshot.frames >= 7, {
    maxFrames: 50,
  });
  expect(driven.frames).toBe(7);

  await h.debug.reset();
  const swept = await h.sweep((snapshot) => snapshot.frames >= 7, null, {
    maxFrames: 50,
  });

  expect(swept.hit).toBe(true);
  expect(swept.frames).toBe(7);
  expect(swept.ticks).toBe(7);
  expect(swept.snapshot.frames).toBe(7);
  // Both drives moved the harness's own counter by what they ran.
  expect(h.frame()).toBe(14);
});

it("arranges the game inside the sweep's own crossing", async () => {
  // What lets a shot be fired and followed to its contact with no round trip in
  // between: the arrangement runs first, its state is read once, and that reading
  // reaches the predicate as its third parameter and the caller as `arranged`.
  const swept = await h.sweep(
    (snapshot, target: number, arranged) => snapshot.x >= target + arranged.x,
    6,
    { arrange: [["setX", 100]], maxFrames: 20 },
  );

  // The fixture's landmark moves two units a frame, so six units is three frames.
  expect(swept.arranged.x).toBe(100);
  expect(swept.frames).toBe(3);
  expect(swept.snapshot.x).toBe(106);
});

it("reports a sweep that never held, at its bound", async () => {
  const swept = await h.sweep(() => false, null, { maxTicks: 5 });
  expect(swept.hit).toBe(false);
  expect(swept.frames).toBe(5);
  expect(swept.ticks).toBe(5);
  expect(h.frame()).toBe(5);

  // And one that held before a frame ran, which is the honest answer and the
  // vacuous-pass trap the driven sweep carries too.
  const already = await h.sweep((snapshot) => snapshot.frames >= 0, null);
  expect(already.hit).toBe(true);
  expect(already.frames).toBe(0);
  expect(h.frame()).toBe(5);
});

/* ---- samples -------------------------------------------------------------- */

it("takes one reading per frame, in one crossing", async () => {
  // What a check that MEASURES A PATH runs. The array holds `frames + 1`
  // readings: the state as the run opened, then one after each frame.
  const run = await h.samples(5, {
    project: (snapshot) => snapshot.x,
    argument: null,
  });

  expect(run.samples).toEqual([0, 2, 4, 6, 8, 10]);
  expect(run.frames).toBe(5);
  expect(run.snapshot.frames).toBe(5);
  expect(h.frame()).toBe(5);
});

it("keeps the reading a stopped run held on", async () => {
  // So a caller reads the pair a change sits between, rather than the frame
  // before it and nothing else.
  const run = await h.samples(20, {
    project: (snapshot) => snapshot.x,
    argument: 7,
    stop: (sample, taken, argument) => sample > argument && taken.length > 1,
  });

  expect(run.samples).toEqual([0, 2, 4, 6, 8]);
  expect(run.frames).toBe(4);
  expect(h.frame()).toBe(4);
});

it("carries what the suite knows in as an argument", async () => {
  // The one door into a carried function. A `project` that reached for a binding
  // of the suite's would fail IN THE PAGE, so the mistake is loud rather than
  // quiet; anything it needs crosses as JSON instead.
  const run = await h.samples(2, {
    project: (snapshot, offset: number) => snapshot.x + offset,
    argument: 1000,
  });
  expect(run.samples).toEqual([1000, 1002, 1004]);
});

/* ---- trials --------------------------------------------------------------- */

it("poses, runs one frame and reads, round after round, in one crossing", async () => {
  // The shape left over between the other two: each round arranged from what the
  // round before it left. A reading is handed straight to the next round's
  // `stage` inside the page, and every one of them comes back at the end.
  //
  // The reading is NAMED rather than inferred, which is how a case writes one
  // too: it appears both as what `read` hands back and as what the next round's
  // `stage` is given, and a type in both places is not one TypeScript can work
  // out from the calls alone.
  const run = await h.trials<number, number>(4, {
    stage: (round, last, step) => [["setX", (last ?? 0) + round * step]],
    read: (snapshot) => snapshot.x,
    argument: 10,
    operations: ["setX"],
  });

  // Round r poses `last + r * 10` and its frame adds the fixture's two units, so
  // the readings compound: 0+2, 2+10+2, 14+20+2, 36+30+2.
  expect(run.readings).toEqual([2, 14, 36, 68]);
  expect(run.snapshot.x).toBe(68);
  expect(run.snapshot.frames).toBe(4);
  expect(h.frame()).toBe(4);
});

/* ---- What the page-side drives leave behind -------------------------------- */

it("accounts a batched frame exactly as a driven one", async () => {
  // The equivalence that matters most, because nothing else would notice it
  // breaking: the frames a batched member runs are the frames `advance` runs, so
  // they are bracketed on the recorder and stamped into the cue sinks the same
  // way. A cue watch running across a sweep must read what it would have read
  // across the round trips the sweep replaces.
  await h.dispose();
  h = await createHarness({ armAudio: true });
  await h.debug.startPlaying();

  const played = watchCues(h);
  const swept = await h.sweep(
    (snapshot, target: number) => snapshot.frames >= target,
    CUE_EVERY * 2,
    { maxFrames: 30 },
  );

  expect(swept.frames).toBe(CUE_EVERY * 2);
  // The fixture sounds on every fourth tick of live play and no other, so the
  // cues land on exactly the frames of the sweep that produced them — not on the
  // frame the whole crossing ended on.
  expect(played.map((cue) => cue.frame)).toEqual([CUE_EVERY, CUE_EVERY * 2]);
  expect(played.map((cue) => cue.tick)).toEqual([CUE_EVERY, CUE_EVERY * 2]);
  expect(await h.sounds()).toBe(2);

  // And one frame of the sweep is one frame of the game.
  expect((await h.lastCalls()).length).toBeGreaterThan(0);
});
