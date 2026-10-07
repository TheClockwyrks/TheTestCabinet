// The span drives: one call to the build's step operation, covering a stretch of
// simulated time the BUILD divides.
//
// Every other drive in this package divides the interval itself — `advance(n)`
// makes n calls of one frame each, and `skip(n)` one call of n whole ticks — so
// the harness fixes every frame boundary. That is exactly what a check about
// delta-time independence may not do: `advance(1, 1)` and `advance(1, 60)` are
// the same second of game time as one frame and as sixty, and a specification
// that requires the two to reach the same state is requiring something no run of
// harness-sized frames can pose.
//
// The fixture's `advanceSpan` records the call it was made with, which is the one
// thing a harness cannot see for itself: WHO divided the interval. Every check
// here reads that log back.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MEDIA_DIR_ENV,
  STAGED_PROJECT_DIR,
  type Recording,
} from "../src/index";
import {
  CUE_EVERY,
  TICK_MS,
  captureReplay,
  createHarness,
  createSpanHarness,
  watchCues,
  type Harness,
} from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createSpanHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands the whole span to the build in ONE call", async () => {
  // The subject of the whole file. A second as sixty frames is one call the build
  // divides, not sixty calls this harness divided — and the build's own log is
  // what says which happened.
  await h.advanceSeconds(1, 60);
  expect((await h.snapshot()).spans).toEqual([[1, 60]]);

  // The same second as ONE frame, which is the other half of the pair a
  // delta-time-independence check poses. Two calls, both undivided.
  await h.advanceSeconds(1, 1);
  expect((await h.snapshot()).spans).toEqual([
    [1, 60],
    [1, 1],
  ]);

  // And what the ordinary drive does to the same build, for contrast: one call
  // per frame, each told a frame's own length.
  await h.advance(3);
  const { spans } = await h.snapshot();
  expect(spans).toHaveLength(5);
  expect(spans.slice(2)).toEqual([
    [TICK_MS / 1000, 1],
    [TICK_MS / 1000, 1],
    [TICK_MS / 1000, 1],
  ]);
});

it("counts every frame of the span, and the time it covered", async () => {
  // The frames are the build's, so the harness counts all of them: a span it did
  // not divide is still a span that ran. `timeMs` is the span itself rather than
  // anything the clock says, because the clock was never asked — the caller named
  // the interval.
  await h.advanceSeconds(0.5, 30);

  expect((await h.snapshot()).frames).toBe(30);
  expect(h.frame()).toBe(30);
  expect(h.tick()).toBe(30);
  expect(h.timeMs()).toBeCloseTo(500, 9);

  // Answers nothing, exactly as `advance` does.
  expect(await h.advanceSeconds(0.5, 30)).toBeUndefined();
  expect(h.frame()).toBe(60);
});

it("defaults to the whole span as one frame", async () => {
  // Which is the interesting half of the pair rather than a convenience: the
  // second undivided is the reading a build that integrates per frame fails.
  await h.advanceSeconds(0.25);
  expect((await h.snapshot()).spans).toEqual([[0.25, 1]]);
  expect(h.frame()).toBe(1);
});

it("refuses a frame count that is not a whole number of at least one", async () => {
  // A fixture error fails as one. Repairing it silently would run a drive the
  // check did not ask for, and a check about the division would then be posing
  // something other than what it wrote.
  await expect(h.advanceSeconds(1, 0)).rejects.toThrow(
    /Expected: advanceSeconds to be given a whole number of frames, at least 1\nActual: 0/,
  );
  await expect(h.advanceSeconds(1, 2.5)).rejects.toThrow(
    /Expected: advanceSeconds to be given a whole number of frames/,
  );
  await expect(h.skipSeconds(1, -3)).rejects.toThrow(
    /Expected: skipSeconds to be given a whole number of frames/,
  );

  // Nothing ran: the build was never called, so nothing counted either.
  expect((await h.snapshot()).spans).toEqual([]);
  expect(h.frame()).toBe(0);
});

it("throws for a case whose step operation is not told a duration", async () => {
  // The default kit's step is `advance(count)`, which runs whole ticks of the
  // build's own length — there is no interval for it to divide and nothing this
  // call could mean. It THROWS rather than failing by assertion because it is not
  // a fault of the build: it is a case whose config and whose suite disagree,
  // which no build can cause and none can fix, so it may not decide a point.
  const counted = await createHarness();
  try {
    await expect(counted.advanceSeconds(1, 60)).rejects.toThrow(TypeError);
    await expect(counted.advanceSeconds(1, 60)).rejects.toThrow(
      /advanceSeconds needs a "seconds-frames" step/,
    );
    await expect(counted.skipSeconds(1, 60)).rejects.toThrow(
      /skipSeconds needs a "seconds-frames" step/,
    );
    // And the message names the way out, in the vocabulary that case does have.
    await expect(counted.advanceSeconds(1)).rejects.toThrow(
      /use advance\/skip, which count in those ticks/,
    );
    expect(counted.frame()).toBe(0);
  } finally {
    await counted.dispose();
  }
});

it("stamps every sound of a span with the frame it ended on", async () => {
  await h.dispose();
  h = await createSpanHarness({ armAudio: true });
  await h.debug.startPlaying();

  const played = watchCues(h);
  await h.advanceSeconds(CUE_EVERY * 3 * (TICK_MS / 1000), CUE_EVERY * 3);

  // The fixture sounds on every fourth tick of live play, so twelve frames make
  // three sounds — and all three land on the frame the span ENDED on. An
  // undivided call says nothing about when inside it a sound happened, and
  // spreading them over the span would be an invention.
  expect(played.map((cue) => cue.frame)).toEqual([12, 12, 12]);
  expect(played.map((cue) => cue.tick)).toEqual([12, 12, 12]);
  expect(await h.sounds()).toBe(3);
});

/* ---- What each of the pair does to a recording ----------------------------- */

/** Where this file's own outputs land, as the runner addresses them. */
const SUITE_DIR = join(STAGED_PROJECT_DIR, "span.spec.ts");

it("keeps a span as ONE recorded frame, and a skipped span as none", async () => {
  // Collecting is arranged inside the one check that writes evidence, so every
  // other harness in this file pays nothing for it — `capture.spec.ts` is where
  // the writer itself is checked.
  const mediaDir = mkdtempSync(join(tmpdir(), "case-harness-span-"));
  const collecting = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await captureReplay(h, "span", async () => {
      // Sixty frames of game time the build divided, bracketed as one kept
      // frame. That is the honest framing: the harness cannot see where the
      // build put its own boundaries inside a step it did not drive, so it
      // claims one.
      await h.advanceSeconds(1, 60);
      // And the same call off camera, which keeps nothing at all — the pair
      // differ in exactly what `advance` and `skip` differ in.
      await h.skipSeconds(1, 60);
    });

    const bytes = readFileSync(join(mediaDir, SUITE_DIR, "span.json.gz"));
    const recording = JSON.parse(
      gunzipSync(bytes).toString("utf8"),
    ) as Recording;
    expect(recording.frames).toHaveLength(1);

    // Both spans ran for real, whatever the recorder kept of them.
    const snapshot = await h.snapshot();
    expect(snapshot.frames).toBe(120);
    expect(h.frame()).toBe(120);
    expect(snapshot.spans).toEqual([
      [1, 60],
      [1, 60],
    ]);
  } finally {
    if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = collecting;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
