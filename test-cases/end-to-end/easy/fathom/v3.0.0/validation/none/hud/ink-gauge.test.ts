// hud/ink-gauge — the ink gauge is on the bottom strip and reports its
// readiness.
//
// specs/ui.md keeps the two gauges in the bottom strip, `y` in `[656, 720]`,
// whenever a maze is on screen, and fixes what each reports: whether its ability
// is ready. So the readout is an EXTENT rather than a figure — full while ready,
// short of full the moment it is spent, and longer again as the cooldown runs
// down — and what a player reads off it is how much of the strip it fills.
//
// WHAT A GAUGE LOOKS LIKE IS THE BUILD'S, so what is measured is the strip, and
// what is compared is each moment of the cooldown against TWO frames: the one the
// ready gauge made, and the one it made the step it was spent. A gauge is
// commonly a track with a fill inside it, and the track is drawn at its full
// length whatever the fill is doing, so counting what is drawn reads the same
// figure throughout. What moves is the fill's extent, and it is read from both
// ends of the cooldown at once. Against the JUST-SPENT frame, the points that
// have changed grow as the cooldown runs down — that is the fill coming back.
// Against the READY frame, the points that still differ never grow — a gauge that
// fills back up is never further from full later in the cooldown than earlier —
// and they are gone once it is full again. specs/ui.md leaves "how it is styled"
// to the build, so a fill that carries one tint while ready and another while it
// is spent differs from the ready frame across its whole extent until the
// cooldown ends, and is read by the spent-frame comparison; a fill of one color
// throughout is read by both. A bar, an arc, a row of pips — every one of them
// reads that way, and none of them has to be recognised.
//
// NOTHING ELSE IN THE STRIP MOVES WHILE ONE COOLDOWN RUNS: the lives stand, the
// depth stands, the other gauge is left alone and ready, and the maze is above the
// strip entirely. So every point that differs belongs to this gauge.
//
// THE ABILITY IS SPENT WITH ITS KEY, because that is the only thing that spends
// one: the debugging surface poses a cooldown but emits nothing. A build whose
// ink control is dead therefore fails here as well as at its own `controls`
// point, which is the price of the requirement being about a gauge that follows a
// real cooldown.
//
// THE BOARD IS EMPTIED OF HUNTERS, so nothing can reach the forager and end the
// dive across the cooldown.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { BINDINGS, INK_COOLDOWN } from "../constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { BOTTOM_STRIP, differing, drawnAcross, stripColors } from "./readouts";
import { ticksFor } from "../constants";

/** The key specs/movement.md binds `b` to, which spends the ability. */
const KEY = BINDINGS.b[0];

/** The whole cooldown, in ticks. */
const COOLDOWN_TICKS = ticksFor(INK_COOLDOWN);

/**
 * The fractions of the cooldown the gauge is read again at, as whole ticks.
 *
 * Taken as a share of the tick count rather than of the seconds, because a tick
 * is the unit the game is stepped in: a fraction of a duration lands between two
 * of them and there is no such moment to read a frame at.
 */
const ALONG = [0.35, 0.75].map((share) => Math.round(COOLDOWN_TICKS * share));

/** Ticks past the end of the cooldown, so the last reading is of a ready gauge. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ink gauge full, short of full when spent, and longer again", async () => {
  await startPlaying(h);
  await h.debug.clearPredators();
  await h.debug.setSonarCooldown(0);
  await h.debug.setInkCooldown(0);
  await h.advance(1);

  const measured = await captureReplay(h, "gauge", async () => {
    const drawn = await drawnAcross(h, BOTTOM_STRIP);
    const ready = await stripColors(h, BOTTOM_STRIP);
    await h.tap(KEY);
    const spentFrame = await stripColors(h, BOTTOM_STRIP);
    const spent = differing(spentFrame, ready);

    /** Points still apart from the ready frame, at each of `ALONG`. */
    const along: number[] = [];
    /** Points moved away from the just-spent frame, at each of `ALONG`. */
    const refilled: number[] = [];
    let covered = 0;
    for (const target of ALONG) {
      await h.advance(Math.max(0, target - covered));
      covered = target;
      const frame = await stripColors(h, BOTTOM_STRIP);
      along.push(differing(frame, ready));
      refilled.push(differing(frame, spentFrame));
    }
    await h.advance(COOLDOWN_TICKS - covered + SETTLE_TICKS);
    const back = differing(await stripColors(h, BOTTOM_STRIP), ready);
    return { drawn, spent, along, refilled, back };
  });

  assertGreaterThan(
    measured.drawn,
    0,
    "sampled points of the bottom strip drawn on while the ability is ready, " +
      "which is the gauge this point measures (specs/ui.md)",
  );
  assertGreaterThan(
    measured.spent,
    0,
    `sampled points of the bottom strip that changed on the step ${KEY} spent ` +
      "the ability — the gauge is drawn short of full once it is spent " +
      "(specs/ui.md)",
  );
  assertGreaterThan(
    measured.refilled[1],
    measured.refilled[0],
    "sampled points that have changed from the just-spent gauge three quarters " +
      `of the way down the cooldown, against the ${String(measured.refilled[0])} ` +
      "a third of the way down — the gauge is drawn longer again as the " +
      "cooldown runs down (specs/ui.md)",
  );
  assertLessThanOrEqual(
    measured.along[1],
    measured.along[0],
    "sampled points still standing apart from the ready gauge three quarters " +
      `of the way down the cooldown, against the ${String(measured.along[0])} ` +
      "a third of the way down — a gauge that fills back up is never further " +
      "from full later in the cooldown than earlier (specs/ui.md)",
  );
  assertLessThan(
    measured.back,
    measured.along[1],
    "sampled points still standing apart from the ready gauge once the " +
      `cooldown has run out, against the ${String(measured.along[1])} three ` +
      "quarters of the way down it — the gauge is back at its full extent " +
      "(specs/ui.md)",
  );
});
