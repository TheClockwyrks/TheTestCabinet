// presentation/overlay-shows-cascade — the overlay reports the cascade.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": the build registers, "while
// a cascade runs, how many cards have launched and how many are in flight".
// Under this engine registering it is the whole of Cascade's part; the panel is
// the engine's.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That both figures reach the panel.
// The screen and deal mode are `overlay-shows-screen`, the pile counts
// `overlay-shows-pile-counts` and the drag `overlay-shows-drag`. How the cascade
// itself launches, flies and paints is the `cascade` group's entirely.
//
// THE LAUNCHED COUNT IS EARNED, NOT POSED. `launched` is a counted field the
// cascade raises as it launches (specs/instrumentation.md), and no operation
// sets it — so the game is driven to a real win through `startCascade`, which
// moves the last King home with the game's own `move`, and then run until the
// cascade has launched some cards. What the panel is then held to is whatever
// figure the snapshot reports, so nothing here depends on the cadence the
// `cascade` group decides.
//
// THE TWO FIGURES ARE MADE TO DIFFER FROM EACH OTHER AND FROM EVERYTHING ELSE ON
// THE BOARD. Once the launched count has been read, `setLaunching(false)` stops
// it moving, `clearFlyers` empties the flight, `clearTable` empties all thirteen
// piles, and exactly three cards are posed back into flight. Every pile count on
// the panel is then zero, so the only figures it can carry are the launched
// count and the three in flight, and a build reporting one of the two in place
// of the other reads as the wrong number rather than as the right one.
//
// THE GATES IT HOLDS DOWN, AND WHY. `setLaunching(false)` is what freezes the
// figure being asserted; without it the count read from the snapshot and the
// count drawn on the panel are two samples of a moving number.
// `setTrailPainting(false)` keeps the painted layer's full-screen blit out of
// every frame this point runs, which the requirement does not touch. Both are
// off for the faculty each names and nothing else.
//
// THE POSED FLYERS ARE STILL, at zero velocity, so nothing retires and the count
// stands where it was posed while the panel is read. They still fall under
// gravity, which is the game's own rule and no business of this point's.
//
// THE WORLD IT POSES. `startCascade` opens an empty table, completes the
// foundations but for one King and plays it home; everything after that clears
// the table again.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotEqual, assertTrue } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  framesFor,
  KING,
  poseFlyer,
  startCascade,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertFigure, overlayLines } from "./overlay";

/**
 * How many launches to wait for before the count is frozen.
 *
 * Enough that the figure is unmistakably a count the cascade raised rather than
 * the `0` a cleared table starts at, and far short of the fifty-two the cascade
 * ends on, so the wait is a fraction of the run.
 */
const LAUNCHES = 7;

/** How long the wait may run before the cascade is called stalled, in seconds. */
const LAUNCH_WAIT = 4;

/** How many cards are posed back into flight: a figure the board cannot repeat. */
const FLYING = 3;

/** Where the posed flyers are put, well inside the stage and clear of each other. */
const FLYER_X: readonly number[] = [300, 500, 700];
const FLYER_Y = 300;

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

  const reached = await h.until((snapshot) => snapshot.launched >= LAUNCHES, {
    maxFrames: framesFor(LAUNCH_WAIT),
  });
  assertTrue(
    reached.hit,
    `the cascade to have launched ${String(LAUNCHES)} cards within ` +
      `${String(LAUNCH_WAIT)} seconds of the win, so there is a launched ` +
      "count to report (specs/victory.md)",
  );

  h.debug.setLaunching(false);
  h.debug.clearFlyers();
  h.debug.clearTable();
  for (const x of FLYER_X) {
    poseFlyer(h, card("hearts", KING), x, FLYER_Y, 0, 0);
  }

  const posed = h.snapshot();
  assertGreaterThan(posed.launched, 0, "a launched count the cascade raised");
  assertNotEqual(
    posed.launched,
    FLYING,
    "the launched count to differ from the cards in flight, so each figure on " +
      "the panel can have come from one source and no other",
  );

  const before = await h.drawFrame();
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertFigure(lines, posed.launched, "the cards the cascade has launched");
  assertFigure(lines, FLYING, "the cards in flight");
});
