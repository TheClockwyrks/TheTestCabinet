// instrumentation/overlay — the read-only debug overlay is there, it reports every
// fact the Diagnostics section of specs/instrumentation.md lists, and watching it
// leaves the game exactly as it was.
//
// UNDER THIS ENGINE THE WHOLE PANEL IS THE BUILD'S. specs/instrumentation.md puts
// the overlay in the runtime layer an engineless build writes: it draws the
// registered sources, it is shown and hidden by the backtick key
// (specs/controls.md fixes `Backquote`), it is off when the game starts, and it
// "reads the game without changing it". There is no operation on the debug surface
// for any of that, so this item is decided the way a player would decide it: the key
// is pressed, and the frames the build drew before and after are compared. The
// requirement itself is the same one the engine-backed suites decide, so the fact
// list below is the same list — this case's review items do not differ by engine.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING. The specification requires a
// set of FACTS and requires each to be short enough to read on a line; it fixes no
// format, no layout, no wording and no units, and asking for any of those would fail
// a build that reported the same fact differently. So the field is posed to figures
// nothing else on it carries, and each is looked for as a WHOLE RUN OF DIGITS among
// the lines the toggle ADDED to an otherwise identical frame — so the `4` of the
// bullet count is not answered by the `4` inside `448`. A build reporting the wrong
// field, or a placeholder, produces a different number.
//
// THE TWO VALUES WITH MORE THAN ONE HONEST WRITTEN FORM are accepted in any of
// them. A facing may be drawn in degrees or in radians and a grace to whatever
// precision reads well, so the ship is posed at a quarter turn — `90` degrees or
// `1.571` radians, and nothing else here carries either figure — and the grace at
// `2.5` seconds, accepted written out or rounded to the whole second an integer
// formatter would produce.
//
// THE TWO COUNTS ARE SMALL INTEGERS and are the weakest readings here; nothing in
// the specification lets them be made unique.
//
// THE FIELD IS POSED AND THEN PAUSED. specs/ui.md freezes the field behind the
// pause menu — "No body moves, no timer runs down" — which is what makes the
// read-only leg a reading about the OVERLAY rather than about the frames of play
// that would otherwise have run underneath it.
//
// AND THE CLOCK IS DRIVEN TO A FIGURE OF ITS OWN FIRST. The accumulated simulation
// time is one of the values the overlay owes, and a reading taken moments after a
// reset is a `0` that half the panel could be showing anyway. So the run is carried
// to twenty-three seconds of game time over an EMPTY field — nothing to drift,
// nothing to spawn — and the crowd is posed onto it afterwards, at rest, for the
// frames that are read. One tick of the twenty-three is left for the key press the
// toggle spends, so the reading lands on the figure.
//
// THE READ-ONLY HALF IS READ THROUGH A REDRAW RATHER THAN A TICK. The frames are
// collected with `presentCalls`, which redraws the state as it stands without
// advancing it, so the only game time either leg spends is the single tick that
// delivers each key press. The snapshot is then identical either side of the toggle
// but for exactly that tick, which is what "watching the overlay leaves the game
// exactly as it is" means when the toggle is a key.
//
// THE VARIANT IS READ OFF THE BUILD, and this is the one item in the group that
// branches on it, because the requirement itself does: specs/instrumentation.md's
// Diagnostics list adds the torpedo charge and the torpedoes in flight under
// `warhead`, and the item is a common one that both checklists name.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { TICK_DT } from "../constants";
import {
  captureStill,
  carriesTorpedoes,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  poseTorpedo,
  startPlaying,
  ticksFor,
  toggleOverlay,
  type Harness,
} from "../harness";

/** The run posed: three figures nothing else on this field carries. */
const SCORE = 45_310;
const LIVES = 14;
const WAVE = 17;

/** Where the ship stands, and the velocity it carries: a 336-448-560 triangle. */
const SHIP = { x: 218, y: 653 } as const;
const SHIP_VELOCITY = { vx: 336, vy: -448 } as const;
/** Its speed, which specs/instrumentation.md builds from the velocity beside it. */
const SHIP_SPEED = 560;

/**
 * The ship's posed facing: a quarter turn, which is straight down in the field's
 * coordinates (specs/overview.md measures angles clockwise from `+x`).
 *
 * A quarter turn is the one facing with a short written form in BOTH conventions a
 * build may honestly draw: `90` degrees, or `1.571` radians. Nothing else posed here
 * carries either figure.
 */
const SHIP_ANGLE = Math.PI / 2;
const FACING_FORMS = /1\.57|\b90\b/;

/**
 * The ship's posed respawn grace, in seconds, and the forms it may be drawn in.
 *
 * `2.5` seconds: a duration a build may print at any precision it likes, so the
 * pattern accepts it written out or rounded up to the whole second an integer
 * formatter would produce.
 */
const INVULN = 2.5;
const GRACE_FORMS = /2\.5|\b3\b/;

/** Where the saucer hangs, at a pair of figures nothing else here carries. */
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
 * The game time the run is carried to before the reading, in seconds.
 *
 * Twenty-three: a figure no other value on this field carries, so the accumulated
 * simulation time is recognisable as itself on the panel.
 */
const SIM_SECONDS = 23;

/**
 * The `warhead` charge posed, and the forms it may be drawn in.
 *
 * Three fifths: specs/weapons.md runs the charge from `0` to `1`, so this is a value
 * a real recharge passes through six seconds in, and it is neither of the two ends a
 * build could be reporting by accident. It is accepted as the fraction it is or as
 * the percentage a panel might show instead.
 */
const TORPEDO_CHARGE = 0.6;
const CHARGE_FORMS = /0\.6|\b60\b/;

/** The `warhead` torpedoes posed, above the star and clear of every body. */
const TORPEDO_PLACES = [
  { x: 420, y: 260 },
  { x: 860, y: 260 },
] as const;
const TORPEDO_HEADING = -Math.PI / 2;

/**
 * The decimal places the game time either side of the toggle is compared to.
 *
 * Six, which is to say exactly: the only game time this scenario spends is the one
 * tick that delivers the key press, so a build whose overlay advanced anything of
 * its own reads as more than a single `TICK_DT`.
 */
const CLOCK_DIGITS = 6;

let h: Harness;

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** Every maximal run of digits the lines carry. */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.match(/\d+/g) ?? []);
}

/** Some line carries `value` as a whole figure; fails naming what was wanted. */
function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!digitRuns(lines).includes(String(value))) {
    fail(`an overlay line carrying ${what} (${value})`, lines);
  }
}

/** Some line matches `pattern`; fails naming what was wanted. */
function assertForm(
  lines: readonly string[],
  pattern: RegExp,
  what: string,
): void {
  if (!lines.some((line) => pattern.test(line))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every registered value when toggled on, and takes them away again", async () => {
  // A quiet, empty run from a known zero, carried to the game time the panel has to
  // report. One of the twenty-three seconds' ticks is left for the key press the
  // toggle spends below, so the reading lands on the figure.
  await startPlaying(h);
  await h.advance(ticksFor(SIM_SECONDS) - 1);

  // Then the crowd, posed onto the field it was carried to. Nothing is advanced
  // between the poses, so nothing drifts before it is frozen.
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
  const warhead = await carriesTorpedoes(h);
  if (warhead) {
    for (const place of TORPEDO_PLACES) {
      await poseTorpedo(h, place.x, place.y, TORPEDO_HEADING, {
        homing: false,
      });
    }
    await h.debug.setTorpedoCharge(TORPEDO_CHARGE);
  }

  // Frozen behind the pause menu, so what changes across the toggle is the overlay
  // and nothing else (specs/ui.md).
  await h.debug.setScreen("paused");

  // The frame as the build draws it with the overlay off, which specs/controls.md
  // says is how the game starts. `presentCalls` redraws without advancing.
  const bare = drawnText(await h.presentCalls());
  const before = await h.snapshot();

  await toggleOverlay(h);
  const overlaid = drawnText(await h.presentCalls());
  await captureStill(h, "overlay");
  const overlay = newLines(bare, overlaid);

  assertGreaterThan(
    overlay.length,
    0,
    "the text lines the overlay added to the frame",
  );

  // ---- The values specs/instrumentation.md names --------------------------

  assertForm(overlay, /paused/i, "the current screen, 'paused'");
  assertFigure(overlay, SCORE, "the score");
  assertFigure(overlay, LIVES, "the lives");
  assertFigure(overlay, WAVE, "the wave");

  assertFigure(overlay, SHIP.x, "the x of the ship's position");
  assertFigure(overlay, SHIP.y, "the y of the ship's position");
  assertFigure(overlay, SHIP_VELOCITY.vx, "the x of the ship's velocity");
  assertFigure(
    overlay,
    Math.abs(SHIP_VELOCITY.vy),
    "the y of the ship's velocity",
  );
  assertFigure(overlay, SHIP_SPEED, "the ship's speed");
  assertForm(overlay, FACING_FORMS, "the ship's facing, a quarter turn");
  assertForm(overlay, GRACE_FORMS, "the ship's remaining respawn grace, 2.5 s");

  assertFigure(overlay, BULLETS.length, "how many bullets are in play");
  assertFigure(overlay, ROCK_COUNT, "how many rocks are in play");

  assertFigure(overlay, SAUCER.x, "the x of the saucer that is up");
  assertFigure(overlay, SAUCER.y, "the y of the saucer that is up");

  assertFigure(
    overlay,
    SIM_SECONDS,
    "the accumulated simulation time, in seconds",
  );

  // And the two the variant adds, demanded of a build whose surface carries the
  // variant's operations.
  if (warhead) {
    assertForm(overlay, CHARGE_FORMS, "the torpedo charge, three fifths");
    assertFigure(
      overlay,
      TORPEDO_PLACES.length,
      "how many torpedoes are in flight",
    );
  }

  // ---- And watching it changed nothing but the tick that delivered the key -

  const after = await h.snapshot();
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
  const cleared = drawnText(await h.presentCalls());
  assertLessThanOrEqual(
    cleared.length,
    bare.length,
    "the text draws left once the overlay was toggled off again",
  );
});
