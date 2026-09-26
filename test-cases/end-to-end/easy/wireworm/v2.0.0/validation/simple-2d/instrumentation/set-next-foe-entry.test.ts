// Wireworm — instrumentation/set-next-foe-entry: `setNextFoeEntry` poses the
// tile the next foe of a kind enters on, reads back, decides that one entry, and
// is consumed by it.
//
// specs/instrumentation.md, The level's draws: `setNextFoeEntry(kind, c, r)`
// "Poses the tile the next foe of `kind` the level brings in enters on, with its
// center on that tile's center. For a glitch or a corruptor, `c` is `0`,
// entering from the left, or `39`, entering from the right, and `r` is a row of
// that kind's entry rows ... It is reported as `nextGlitchEntry` ... and reads
// `null` once that entry has consumed it." And: "A foe the level brings in on a
// posed tile enters exactly as one on a drawn tile does: heading inward from the
// edge it stands against".
//
// THE TILE POSED IS ONE THE DRAW ALONE WOULD PICK ONE TIME IN SIXTEEN. The right
// edge is one of two, and row 12 one of the eight rows 8..15 specs/foes.md draws
// a glitch onto, so a build that ignores the pose and draws its own is read on
// the wrong tile fifteen times in sixteen, and on the wrong edge half the time.
//
// THE ENTRY IS BROUGHT FORWARD WITH THE CLOCK POSE. specs/foes.md would draw the
// glitch's first clock between 7 and 12 s; `setSpawnTimer` puts it at half a
// second, so the sweep is short. Which is `instrumentation/set-spawn-timer`'s
// point, and the read here is of where the glitch stood on the frame it entered,
// within one frame of its own travel.

import { afterEach, beforeEach, it } from "vitest";
import {
  COLS,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_V_SPEED,
  tileCX,
  tileCY,
} from "../constants";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The tile posed: the right edge column, on an entry row of the glitch's. */
const ENTRY_C = COLS - 1;
const ENTRY_R = 12;

/** The seconds posed on the glitch's clock, so the entry is near. */
const CLOCK_SECONDS = 0.5;

/** How long the sweep waits for the entry, in seconds: twice the posed clock. */
const SWEEP_SECONDS = CLOCK_SECONDS * 2;

/** One frame of the suite's clock, in seconds. */
const FRAME_SECONDS = seconds(1);

/** The glitches the roster holds. */
function glitches(snapshot: WirewormSnapshot): WirewormSnapshot["foes"] {
  return snapshot.foes.filter((foe) => foe.kind === "glitch");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the posed tile back, enters the glitch on it, and consumes the pose", async () => {
  startPlaying(h);
  h.debug.setLevel(GLITCH_FROM_LEVEL);
  h.debug.setNextFoeEntry("glitch", ENTRY_C, ENTRY_R);

  assertDeepEqual(
    h.snapshot().nextGlitchEntry,
    { c: ENTRY_C, r: ENTRY_R },
    `snapshot().nextGlitchEntry after setNextFoeEntry("glitch", ${ENTRY_C}, ` +
      `${ENTRY_R})`,
  );

  h.debug.setSpawnTimer("glitch", CLOCK_SECONDS);
  h.debug.setFoeSpawning(true);
  const swept = await h.until((s) => glitches(s).length > 0, {
    maxFrames: ticksFor(SWEEP_SECONDS),
    poll: 1,
  });
  captureStill(h, "entry");

  assertTrue(
    swept.hit,
    `a glitch to enter within ${SWEEP_SECONDS} s of a clock posed at ` +
      `${CLOCK_SECONDS} s at level ${GLITCH_FROM_LEVEL} (specs/foes.md)`,
  );
  const glitch = glitches(swept.snapshot)[0];

  // Read on the frame it entered, so its center sits on the posed tile's center
  // within one frame of its own travel at most.
  assertBetween(
    glitch.x,
    tileCX(ENTRY_C) - GLITCH_H_SPEED * FRAME_SECONDS,
    tileCX(ENTRY_C) + GLITCH_H_SPEED * FRAME_SECONDS,
    `the glitch's center x on the frame it entered, against the center of ` +
      `column ${ENTRY_C} (${tileCX(ENTRY_C)}) the pose named`,
  );
  assertBetween(
    glitch.y,
    tileCY(ENTRY_R) - GLITCH_V_SPEED * FRAME_SECONDS,
    tileCY(ENTRY_R) + GLITCH_V_SPEED * FRAME_SECONDS,
    `the glitch's center y on the frame it entered, against the center of ` +
      `row ${ENTRY_R} (${tileCY(ENTRY_R)}) the pose named`,
  );
  assertLessThan(
    glitch.vx,
    0,
    "the glitch's vx entering from the right edge, which points inward, left",
  );
  assertEqual(
    swept.snapshot.nextGlitchEntry,
    null,
    "snapshot().nextGlitchEntry once the entry it posed has consumed it",
  );
});
