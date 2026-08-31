// instrumentation/overlay — the read-only debug overlay is there, it reports the
// game the Diagnostics section of `specs/instrumentation.md` lists, and watching it
// leaves the game exactly as it was.
//
// UNDER THIS ENGINE THE WHOLE PANEL IS THE BUILD'S. `specs/instrumentation.md` puts
// the overlay in the runtime layer an engineless build writes: it draws the
// registered sources, it is shown and hidden by the backtick key
// (`specs/controls.md` fixes `Backquote`), it is off when the game starts, and it
// "reads the game without changing it". There is no operation on the debug surface
// for any of that, so this item is decided the way a player would decide it: the key
// is pressed, and the frames the build drew before and after are compared.
//
// WHAT IS READ, AND WHY NOT MORE. The specification requires a set of FACTS and
// requires each to be short enough to read on a line; it fixes no format, no
// layout, no wording and no units, and asking for any of those would fail a build
// that reported the same fact differently. So two facts are read, and both are
// values the specification itself fixes rather than values this check invented:
//
//   - THE SCREEN, whose value is one of the five literals
//     `specs/instrumentation.md` names, and which the HUD of `specs/ui.md` never
//     draws;
//   - THE WAVE, posed to a distinctive three-digit number so that a build reporting
//     it in any format at all — "137", "WAVE 137", "wave: 137" — reads as reporting
//     it, and a build reporting nothing of the kind does not.
//
// Beyond those, what is asked is that the panel really is a PANEL: toggling it adds
// text the frame did not have, and toggling it again takes that text away. A build
// whose backtick key does nothing fails the first; a build that draws the panel
// permanently fails the second.
//
// AND THE READ-ONLY HALF IS READ THROUGH A REDRAW RATHER THAN A TICK. The frames
// are collected with `presentCalls`, which redraws the state as it stands without
// advancing it, so the only game time either leg spends is the single tick that
// delivers each key press. The snapshot is then identical either side of the toggle
// but for exactly that tick, which is what "watching the overlay leaves the game
// exactly as it is" means when the toggle is a key.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  drewText,
  poseRock,
  startPlaying,
  toggleOverlay,
  type Harness,
} from "../harness";

/**
 * The wave the run is posed at.
 *
 * Three digits and no repeated one, so a build that reports the wave in any format
 * reads as reporting it, and nothing else on the field is likely to draw the same
 * run of characters by accident. The score is posed clear of those digits for the
 * same reason.
 */
const POSED_WAVE = 137;

/** The score the run is posed at: no digit of it is a digit of the wave. */
const POSED_SCORE = 4200;

/** Where the rocks stand, so the panel's counts have something to count. */
const PLACES = [
  { size: "large", x: 200, y: 160 },
  { size: "small", x: 1080, y: 620 },
] as const;

/**
 * The decimal places the game time either side of the toggle is compared to.
 *
 * Six, which is to say exactly: the only game time this scenario spends is the one
 * tick that delivers the key press, so a build whose overlay advanced anything of
 * its own reads as more than a single `TICK_DT`.
 */
const CLOCK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the game's facts when toggled on, and takes them away again", async () => {
  await startPlaying(h, { wave: POSED_WAVE });
  await h.debug.setScore(POSED_SCORE);
  for (const place of PLACES) {
    await poseRock(h, place.size, place.x, place.y);
  }
  await h.advance(1);

  // The frame as the build draws it with the overlay off, which
  // `specs/controls.md` says is how the game starts.
  const bare = await h.presentCalls();
  const before = await h.snapshot();

  await toggleOverlay(h);
  const overlaid = await h.presentCalls();
  await captureStill(h, "overlay");

  assertGreaterThan(
    drawnText(overlaid).length,
    drawnText(bare).length,
    "the text draws the overlay added to the frame",
  );
  assertTrue(
    drewText(overlaid, before.screen),
    `the overlay names the current screen, ${JSON.stringify(before.screen)}`,
  );
  assertTrue(
    drewText(overlaid, String(POSED_WAVE)),
    `the overlay reports the wave, ${POSED_WAVE}`,
  );

  // Watching it changed nothing but the single tick that delivered the key.
  const after = await h.snapshot();
  assertEqual(after.screen, before.screen, "the screen");
  assertEqual(after.score, before.score, "the score");
  assertEqual(after.lives, before.lives, "the ships");
  assertEqual(after.wave, before.wave, "the wave");
  assertLength(after.rocks, before.rocks.length, "the rock roster");
  assertEqual(after.ship.x, before.ship.x, "the ship's x");
  assertEqual(after.ship.y, before.ship.y, "the ship's y");
  assertCloseTo(
    after.simTime - before.simTime,
    TICK_DT,
    CLOCK_DIGITS,
    "the game time the toggle spent: the one tick that delivered the key",
  );

  // And the panel is a toggle rather than a switch that only goes one way.
  await toggleOverlay(h);
  const cleared = await h.presentCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "the text draws left once the overlay was toggled off again",
  );
});
