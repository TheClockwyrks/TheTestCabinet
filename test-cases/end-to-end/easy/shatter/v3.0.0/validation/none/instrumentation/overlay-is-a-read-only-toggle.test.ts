// instrumentation/overlay-is-a-read-only-toggle — the backtick key puts the panel
// up and takes it down again, and watching it leaves the game exactly as it was.
// `none` only.
//
// WHY THIS ITEM NAMES ONE ENGINE. `specs/instrumentation.md` puts the overlay in
// the runtime layer. Under `simple-2d` and `structured-2d` that layer is the
// ENGINE's: the engine owns the backtick key, draws the panel, starts it hidden,
// and reads the registered sources without touching them, so every build on those
// engines gets all four for free and a check on them decides the engine rather
// than the build. With no engine the build writes the runtime, so all four are its
// own work — which is why this item carries `engines = ["none"]` and its sibling
// `instrumentation/overlay` — the VALUES the panel reports, which a build
// registers under every engine — carries none.
//
// THE THREE THINGS ASSERTED, WHICH ARE THE THREE HALVES OF THAT ONE SENTENCE:
//
//   - THE KEY PUTS THE PANEL UP. The frame drawn after the press carries text the
//     frame before it did not. `specs/controls.md` fixes the key as `Backquote`.
//   - WATCHING IT CHANGES NOTHING. Every field of the snapshot reads the same
//     either side of the press, bar the accumulated simulation time, which
//     `specs/instrumentation.md` has rise by every tick's `TICK_DT` "whatever the
//     screen" — and the one tick that delivered the key press is the only game
//     time this scenario spends.
//   - AND THE KEY TAKES IT DOWN AGAIN. `specs/instrumentation.md` makes the panel
//     a toggle rather than a switch that only goes one way, so a second press
//     leaves the frame with no more text on it than the bare frame carried.
//
// WHAT IS ASSERTED IS NOT THE PANEL'S CONTENT. The lines are counted rather than
// read: what they must say is `instrumentation/overlay`'s point, and repeating it
// here would cost a build two items for one defect.
//
// THE FIELD IS POSED AND THEN PAUSED. `specs/ui.md` freezes the field behind the
// pause menu — "No body moves, no timer runs down" — which is what makes the
// read-only leg a reading about the OVERLAY rather than about the frames of play
// that would otherwise have run underneath it. The field carries a crowd rather
// than nothing, so a build whose panel walked a roster it was reading has
// something to walk.
//
// AND THE FRAMES ARE READ THROUGH A REDRAW RATHER THAN A TICK. `presentCalls`
// redraws the state as it stands without advancing it, so the only game time
// either leg spends is the single tick that delivers each key press.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  presentCalls,
  startPlaying,
  toggleOverlay,
  type Harness,
} from "../harness";

/** The run posed, so the panel has a game to report and a roster to walk. */
const SCORE = 45_310;
const LIVES = 14;
const WAVE = 17;

/** Where the ship stands, and the velocity and facing it carries. */
const SHIP = { x: 218, y: 653 } as const;
const SHIP_VELOCITY = { vx: 336, vy: -448 } as const;
const SHIP_ANGLE = Math.PI / 2;
const INVULN = 2.5;

/** Where the saucer hangs. */
const SAUCER = { x: 1015, y: 96 } as const;

/** The ship's bullets posed, at rest, along the top of the field. */
const BULLETS = [
  { x: 100, y: 60 },
  { x: 300, y: 60 },
  { x: 500, y: 60 },
  { x: 700, y: 60 },
] as const;

/** The rocks posed, at rest, in a row along the bottom, a hundred units apart. */
const ROCK_COUNT = 11;
const ROCK_ROW_Y = 690;
const ROCK_ROW_X0 = 60;
const ROCK_ROW_STEP = 100;

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

it("shows the panel on the backtick key, changes nothing, and hides it again", async () => {
  await startPlaying(h);

  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setWave(WAVE);
  await h.debug.setShipPosition(SHIP.x, SHIP.y);
  await h.debug.setShipVelocity(SHIP_VELOCITY.vx, SHIP_VELOCITY.vy);
  await h.debug.setShipAngle(SHIP_ANGLE);
  await h.debug.setShipInvuln(INVULN);
  for (const bullet of BULLETS) await poseBullet(h, bullet.x, bullet.y, 0, 0);
  for (let i = 0; i < ROCK_COUNT; i += 1) {
    await poseRock(h, "small", ROCK_ROW_X0 + i * ROCK_ROW_STEP, ROCK_ROW_Y);
  }
  await poseSaucer(h, SAUCER.x, SAUCER.y, {
    mind: false,
    gun: false,
    travel: false,
  });
  await h.debug.setScreen("paused");

  // The frame as the build draws it with the overlay off, which specs/controls.md
  // says is how the game starts.
  const bare = drawnText(await presentCalls(h));
  const before = await h.snapshot();

  await toggleOverlay(h);
  const overlaid = drawnText(await presentCalls(h));
  await captureStill(h, "toggled");
  const after = await h.snapshot();

  assertGreaterThan(
    overlaid.length,
    bare.length,
    "the text draws the overlay added to the frame (specs/instrumentation.md)",
  );

  assertEqual(after.screen, before.screen, "the screen");
  assertEqual(after.score, before.score, "the score");
  assertEqual(after.lives, before.lives, "the ships");
  assertEqual(after.wave, before.wave, "the wave");
  assertLength(after.rocks, before.rocks.length, "the rock roster");
  assertLength(after.bullets, before.bullets.length, "the bullet roster");
  assertEqual(after.ship.x, before.ship.x, "the ship's x");
  assertEqual(after.ship.y, before.ship.y, "the ship's y");
  assertEqual(after.ship.invuln, before.ship.invuln, "the ship's grace");
  assertCloseTo(
    after.simTime - before.simTime,
    TICK_DT,
    CLOCK_DIGITS,
    "the game time the toggle spent: the one tick that delivered the key",
  );

  // And the panel is a toggle rather than a switch that only goes one way.
  await toggleOverlay(h);
  const cleared = drawnText(await presentCalls(h));
  assertLessThanOrEqual(
    cleared.length,
    bare.length,
    "the text draws left once the overlay was toggled off again",
  );
});
