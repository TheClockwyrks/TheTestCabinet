// instrumentation/overlay — toggling the debug overlay over a posed field draws
// the facts the specification lists, and watching it leaves the game as it is.
//
// THE RULE. `specs/instrumentation.md`, Diagnostics: "The debug overlay is
// read-only and shows the values the game registers with it as diagnostic
// sources. Register at least: the current `screen`, the score, the lives, and
// the wave; the ship's position, its velocity, its speed, its facing, and its
// remaining respawn grace; how many bullets and how many rocks are in play;
// whether a saucer is up, and its position when one is; the accumulated
// simulation time." Under this engine "registering those values is the whole of
// Shatter's part ... Drawing the panel and toggling it are the engine's", and
// `specs/controls.md` fixes the toggle as the backtick key.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING. A build names its sources
// itself, so every reading below is of a NUMBER the game holds, posed to a
// distinctive value and looked for among the lines the toggle ADDED to an
// otherwise identical frame. Each figure is matched as a WHOLE RUN OF DIGITS
// rather than as a substring, so the `4` of the bullet count is not answered by
// the `4` inside `448`, and the field is posed so that no two of the asserted
// figures collide. A build reporting the wrong field, or a placeholder, produces
// a different number. This is the same fact list and the same reading the two
// other engines' suites use: the case's review items do not differ by engine.
//
// NOTHING ABOUT THE LAYOUT IS ASSERTED, and that is deliberate. A position is two
// figures, but the specification asks a build to register the position and to
// "keep each one short enough to read on a line" — it never says the two halves
// must land on the same line, so requiring that would be demanding a presentation
// the specification leaves to the build. Each figure is asked for on its own,
// among the lines the panel added.
//
// THE TWO VALUES WITH MORE THAN ONE HONEST WRITTEN FORM are accepted in any of
// them. A facing may be shown in degrees or in radians, and a grace to whatever
// precision the build chooses, so the ship is posed at a quarter turn — `90`
// degrees or `1.571` radians, and nothing else here carries either figure — and
// the grace at `2.5` seconds, accepted written out or rounded to the whole second
// an integer formatter would produce. The velocity is posed off a 336-448-560
// triangle so that neither component nor the speed built from them reads as the
// `0` every other line on a quiet panel also carries.
//
// AND THE CLOCK IS DRIVEN TO A FIGURE OF ITS OWN FIRST. The accumulated
// simulation time is one of the values the overlay owes, and a reading taken
// moments after a reset is a `0` that half the panel could be showing anyway. So
// the run is carried to twenty-three seconds of game time over an EMPTY field —
// nothing to drift, nothing to spawn — and the crowd is posed onto it afterwards,
// at rest, for the two frames that are read.
//
// THE FIELD IS POSED AND THEN PAUSED. `specs/ui.md` freezes the field behind the
// pause menu — "No body moves, no timer runs down" — so the ship the velocity was
// posed onto is still standing where the reading expects it when the panel is
// drawn.
//
// THE READ-ONLY HALF IS ITS OWN LEG, over an EMPTY, QUIET, STILL field. On that
// field a tick changes exactly one reported number — `simTime`, which
// `specs/instrumentation.md` has accumulating "every tick's `TICK_DT`, whatever
// the screen" — because there is no body to move, no timer to run down and no
// spawner running. So "the snapshot is identical before and after" can be read
// as literally as it is written: every other field must match exactly, and
// `simTime` must have moved by exactly the one frame the toggle costs. Posing
// the full field for this leg instead would have meant excusing every rock the
// well moved, which is a weaker claim about a different thing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  seconds,
  startPlaying,
  ticksFor,
  toggleOverlay,
  torpedoesOf,
  type Harness,
} from "../harness";

/** The distinctive values the posed field carries. */
const POSED = {
  score: 8765,
  wave: 29,
  lives: 11,
  ship: { x: 321, y: 654 },
  saucer: { x: 246, y: 135 },
} as const;

/** The velocity the ship carries, and the speed built from it: a 336-448-560. */
const SHIP_VELOCITY = { vx: 336, vy: -448 } as const;
const SHIP_SPEED = 560;

/**
 * The ship's posed facing: a quarter turn, straight down in the field's
 * coordinates, and the two forms a build may honestly draw it in.
 */
const SHIP_ANGLE = Math.PI / 2;
const FACING_FORMS = /1\.57|\b90\b/;

/** The ship's posed respawn grace, in seconds, and the forms it may be drawn in. */
const INVULN = 2.5;
const GRACE_FORMS = /2\.5|\b3\b/;

/** The game time the run is carried to before the reading, in seconds. */
const SIM_SECONDS = 23;

/** The `warhead` charge posed, and the forms it may be drawn in. */
const TORPEDO_CHARGE = 0.6;
const CHARGE_FORMS = /0\.6|\b60\b/;

/** The `warhead` torpedoes posed, above the star and clear of every body. */
const TORPEDO_PLACES = [
  { x: 420, y: 260 },
  { x: 860, y: 260 },
];
const TORPEDO_HEADING = -Math.PI / 2;

/** Where the twelve rocks stand: two rows along the top and bottom edges. */
const ROCK_ROWS = [20, 690];
const ROCK_COLUMNS = [100, 300, 500, 700, 900, 1100];

/** Where the four rounds hang, out at the sides and clear of everything. */
const BULLET_SPOTS = [
  { x: 160, y: 300 },
  { x: 160, y: 420 },
  { x: 1120, y: 300 },
  { x: 1120, y: 420 },
];

/** How many of each the overlay must therefore report. */
const ROCK_COUNT = ROCK_ROWS.length * ROCK_COLUMNS.length;
const BULLET_COUNT = BULLET_SPOTS.length;

/** How closely `simTime` must equal one frame's worth, in decimal places. */
const SIM_TIME_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every maximal run of digits the lines carry. */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.match(/\d+/g) ?? []);
}

/** Fail unless some line carries `value` as a whole figure. */
function assertFigure(
  lines: readonly string[],
  value: number,
  requirement: string,
): void {
  if (digitRuns(lines).includes(String(value))) return;
  fail(
    `an overlay line reporting ${String(value)} — ${requirement} ` +
      "(specs/instrumentation.md, Diagnostics)",
    lines,
  );
}

/** Fail unless some line matches `pattern`. */
function assertForm(
  lines: readonly string[],
  pattern: RegExp,
  requirement: string,
): void {
  if (lines.some((line) => pattern.test(line))) return;
  fail(
    `an overlay line reporting ${requirement} ` +
      "(specs/instrumentation.md, Diagnostics)",
    lines,
  );
}

it("draws the facts the specification lists, over a posed field", async () => {
  // A quiet, empty run from a known zero, carried to the game time the panel has
  // to report. Two of the twenty-three seconds' ticks are left for the baseline
  // frame and the toggle's frame below, so the reading lands on the figure.
  h.debug.reset();
  startPlaying(h);
  await h.advance(ticksFor(SIM_SECONDS) - 2);

  h.debug.setScore(POSED.score);
  h.debug.setWave(POSED.wave);
  h.debug.setLives(POSED.lives);
  h.debug.setShipPosition(POSED.ship.x, POSED.ship.y);
  h.debug.setShipVelocity(SHIP_VELOCITY.vx, SHIP_VELOCITY.vy);
  h.debug.setShipAngle(SHIP_ANGLE);
  h.debug.setShipInvuln(INVULN);

  for (const y of ROCK_ROWS) {
    for (const x of ROCK_COLUMNS) poseRock(h, "small", x, y);
  }
  for (const at of BULLET_SPOTS) poseBullet(h, at.x, at.y, 0, 0);

  poseSaucer(h, POSED.saucer.x, POSED.saucer.y);
  // Held, so the position the overlay reports is the one that was posed rather
  // than one a crossing carried it to (specs/instrumentation.md).
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);
  h.debug.setSaucerTravel(false);

  const addTorpedo = h.debug.addTorpedo;
  const warhead = typeof addTorpedo === "function";
  if (warhead) {
    for (const place of TORPEDO_PLACES) {
      addTorpedo(place.x, place.y, TORPEDO_HEADING);
    }
    if (torpedoesOf(h.snapshot()).length !== TORPEDO_PLACES.length) {
      fail(
        "addTorpedo to append each torpedo to the roster " +
          "(specs/instrumentation.md)",
        torpedoesOf(h.snapshot()).length,
      );
    }
    h.debug.setTorpedoCharge?.(TORPEDO_CHARGE);
  }

  // Frozen behind the pause menu, so the posed ship is still standing where the
  // reading expects it and no timer runs down under the panel (specs/ui.md).
  h.debug.setScreen("paused");

  // A baseline frame of the bare paused screen's own text.
  clearCalls(h);
  await h.advance(1);
  const bare = new Set(drawnText(h.calls));

  // The toggle, and the lines the frame that lands it added.
  clearCalls(h);
  await toggleOverlay(h);
  const added = drawnText(h.calls).filter((line) => !bare.has(line));

  // The debug overlay over a posed field. (The engine draws the overlay after
  // the replay recorder's bracket closes, so a still is the one capture that
  // shows it.)
  captureStill(h, "overlay");

  assertGreaterThan(added.length, 0, "the toggle draws the overlay's lines");

  assertForm(added, /paused/i, "the current screen, 'paused'");
  assertFigure(added, POSED.score, "the score");
  assertFigure(added, POSED.lives, "the lives");
  assertFigure(added, POSED.wave, "the wave");

  assertFigure(added, POSED.ship.x, "the x of the ship's position");
  assertFigure(added, POSED.ship.y, "the y of the ship's position");
  assertFigure(added, SHIP_VELOCITY.vx, "the x of the ship's velocity");
  assertFigure(
    added,
    Math.abs(SHIP_VELOCITY.vy),
    "the y of the ship's velocity",
  );
  assertFigure(added, SHIP_SPEED, "the ship's speed");
  assertForm(added, FACING_FORMS, "the ship's facing, a quarter turn");
  assertForm(added, GRACE_FORMS, "the ship's remaining respawn grace, 2.5 s");

  assertFigure(added, ROCK_COUNT, "how many rocks are in play");
  assertFigure(added, BULLET_COUNT, "how many bullets are in play");

  assertFigure(added, POSED.saucer.x, "the x of the saucer that is up");
  assertFigure(added, POSED.saucer.y, "the y of the saucer that is up");

  assertFigure(
    added,
    SIM_SECONDS,
    "the accumulated simulation time, in seconds",
  );

  // And the two the variant adds, demanded of a build whose surface carries the
  // variant's operations.
  if (warhead) {
    assertForm(added, CHARGE_FORMS, "the torpedo charge, three fifths");
    assertFigure(
      added,
      TORPEDO_PLACES.length,
      "how many torpedoes are in flight",
    );
  }
});

it("is read-only: the snapshot is identical across the toggle, but for the frame", async () => {
  // An empty, quiet, still field: no body to move, no timer to run down, no
  // spawner running, so a tick changes exactly one reported number.
  startPlaying(h);

  // A baseline frame of the bare playing screen's own text, so the lines the
  // toggle adds can be told from the ones the game draws either way.
  clearCalls(h);
  await h.advance(1);
  const bare = new Set(drawnText(h.calls));

  const before = h.snapshot();

  clearCalls(h);
  await toggleOverlay(h);
  const added = drawnText(h.calls).filter((line) => !bare.has(line));
  assertGreaterThan(added.length, 0, "the toggle draws the overlay's lines");

  const after = h.snapshot();
  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every reported field but simTime is identical with the overlay up",
  );
  assertCloseTo(
    after.simTime,
    before.simTime + seconds(1),
    SIM_TIME_DIGITS,
    "simTime advanced by exactly the one frame the toggle ran",
  );

  // Toggling again takes it down, and leaves the game exactly as it was too.
  clearCalls(h);
  await toggleOverlay(h);
  const stillDrawn = new Set(drawnText(h.calls));
  const lingering = added.filter((line) => stillDrawn.has(line));
  assertDeepEqual(lingering, [], "the overlay's lines leave with the toggle");

  const down = h.snapshot();
  assertDeepEqual(
    { ...down, simTime: 0 },
    { ...before, simTime: 0 },
    "every reported field but simTime is identical after the overlay comes down",
  );
  assertCloseTo(
    down.simTime,
    before.simTime + seconds(2),
    SIM_TIME_DIGITS,
    "simTime advanced by exactly the two frames the two toggles ran",
  );
});
