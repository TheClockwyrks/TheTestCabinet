// presentation/overlay-shows-cascade — the overlay reports the cascade.
//
// THE RULE. specs/instrumentation.md, "Diagnostics", lists among the sources the
// build registers: "while a cascade runs, how many cards have launched and how
// many are in flight". Under this engine "Registering those values is the whole
// of Cascade's part, through `InitApi.diagnostics`", so what this point decides
// is that the build registered those two.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The two cascade sources. The screen
// and the mode are `presentation/overlay-shows-screen`, the pile counts
// `presentation/overlay-shows-pile-counts`, the drag
// `presentation/overlay-shows-drag`, and that watching the panel costs the game
// nothing is `presentation/overlay-changes-nothing`. What the cascade DOES — the
// cadence, the launch, the arc, the bounce, the retirement — is the whole
// `cascade` group and none of it is decided again here.
//
// THE CASCADE IS ENTERED THE WAY A PLAYER ENTERS IT. `startCascade` poses a board
// one card short of a win and sends that card home through the build's own move
// rules, so the cascade begins with the win, which is where specs/victory.md
// begins it. Nothing here poses a cascade that was never earned.
//
// THE TWO FIGURES ARE MADE DIFFERENT ON PURPOSE, so a panel carrying one of them
// cannot answer for the other. The sweep stops at the first frame that has
// launched {@link LAUNCHED_AT} cards; launching is then gated off, so the count
// cannot move under the reading, and the flight is emptied and posed afresh with
// {@link FLYING_AT} cards. A build that registered the launched count twice, or
// the flight twice, is missing a source and the failure names which.
//
// THE FLIGHT IS POSED RATHER THAN INHERITED, because how many of the launched
// cards are still airborne at any moment is not this point's business and is not
// a fixed number: specs/victory.md draws each card's horizontal speed from a
// range and retires it at a side edge, so by the ninth launch an unknown number
// of the first few have already left. Clearing the flight and adding exactly the
// cards this reading wants makes the figure the point asserts a figure it posed,
// and leaves how the cascade really flies to the `cascade` group.
//
// THE BOARD IS THEN EMPTIED, and that is what makes this reading isolated. The
// foundations still hold the forty-odd cards the cascade has not reached, and
// those counts are figures on the same panel; clearing the thirteen piles leaves
// the launched count and the flight as the only figures on it that are not zero,
// so neither can be answered by a pile. The win test is gated off first, since
// this point does not exercise it and a board emptied under it is not a board it
// was ever meant to see.
//
// THE POSED CARDS ARE PUT WELL INSIDE THE STAGE AND GIVEN NO SPEED, because a
// card retires when it crosses a side edge (specs/victory.md) and the reading
// spans two frames. Spread across the middle of the stage and starting at rest,
// none of them can reach an edge in the fraction of a second the reading takes.
//
// THE PAINTED LAYER IS OFF throughout. specs/victory.md has each card in flight
// stamp itself onto a persistent layer, and this point decides nothing about it;
// leaving it on would blit a full stage every frame of the sweep for no reading.
//
// THE VALUE IS READ, NEVER THE NAME: each figure is matched as a whole run of
// digits, so neither is answered by a digit inside some other number.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_W } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCascade,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertFigure, overlayLines } from "./overlay";

/**
 * How many cards must have launched before the panel is read.
 *
 * A figure no other value on the emptied board carries, and far enough into the
 * cascade that a build which reports a constant `1` or `0` is caught.
 */
const LAUNCHED_AT = 9;

/** How many cards are left in flight, which is a different figure again. */
const FLYING_AT = 4;

/**
 * How far the sweep may run to reach {@link LAUNCHED_AT} launches, in frames.
 *
 * specs/victory.md launches a card every `LAUNCH_INTERVAL` (`0.18`) seconds, so
 * nine of them are `1.44` seconds, which is `346` frames of the suite's `240` Hz
 * clock. The ceiling is several times that, so it is a runaway guard and not a
 * cadence this point asserts — the cadence is `cascade.launch-cadence`.
 */
const SWEEP_FRAMES = 1200;

/** Where the posed cards are put: at rest, spread across the middle of the stage. */
const PARK_Y = 300;
const PARK_X = (index: number): number =>
  Math.round((STAGE_W * (index + 1)) / (FLYING_AT + 1));

/** The card each posed flyer is, which nothing this point reads depends on. */
const FLYER_SUIT = "spades";
const FLYER_RANK = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the launched count and the cards in flight on the overlay", async () => {
  startCascade(h);
  h.debug.setTrailPainting(false);

  const swept = await h.until((state) => state.launched >= LAUNCHED_AT, {
    maxFrames: SWEEP_FRAMES,
  });
  assertTrue(
    swept.hit,
    `the cascade to have launched ${String(LAUNCHED_AT)} cards within ` +
      `${String(SWEEP_FRAMES)} frames of the win (specs/victory.md: a card ` +
      "launches every 0.18 seconds) — it reported " +
      `${String(swept.snapshot.launched)} launched`,
  );

  // Nothing may move under the reading: no further launch, and no pile left
  // holding a figure the panel could answer with.
  h.debug.setLaunching(false);
  h.debug.setWinDetect(false);
  h.debug.clearTable();

  h.debug.clearFlyers();
  for (let index = 0; index < FLYING_AT; index += 1) {
    h.debug.addFlyer(FLYER_SUIT, FLYER_RANK, PARK_X(index), PARK_Y, 0, 0);
  }

  const posed = h.snapshot();
  assertTrue(
    posed.flyers.length === FLYING_AT && posed.launched !== FLYING_AT,
    `${String(FLYING_AT)} cards in flight, a different figure from the ` +
      "launched count, so neither reading can answer for the other — the " +
      `board holds ${String(posed.flyers.length)} in flight and reports ` +
      `${String(posed.launched)} launched`,
  );

  const before = await drawFrame(h);
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertFigure(
    lines,
    posed.launched,
    "how many cards the cascade has launched (specs/instrumentation.md)",
  );
  assertFigure(
    lines,
    FLYING_AT,
    "how many cards are in flight (specs/instrumentation.md)",
  );
});
