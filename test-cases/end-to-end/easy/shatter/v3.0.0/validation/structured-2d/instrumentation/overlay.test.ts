// instrumentation/overlay — toggling the debug overlay over a posed field draws
// the facts the specification lists.
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
// SO ONLY THE VALUES ARE READ HERE. The panel, the backtick key, the hidden-at-start
// state and the read-only-ness are the ENGINE's under this engine, and a check on
// any of them returns the same verdict for every build on it; they are
// `instrumentation/overlay-is-a-read-only-toggle`, which names
// `engines = ["none"]`. The overlay is toggled on below to read what it drew, and
// nothing about the toggle itself is asserted.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING. A build names its sources
// itself, so every reading below is of a NUMBER the game holds, posed to a
// distinctive value and looked for among the lines the toggle ADDED to an
// otherwise identical frame. Each figure is matched as a WHOLE FIGURE rather
// than as a substring, so the `4` of the bullet count is not answered by the
// `4` inside `448`, and the field is posed so that no two of the asserted
// figures collide. A figure the build GROUPED reads as the one figure it is —
// `45,310` and `45310` are the same score — while an ASCII space is not read
// as a separator, because a panel's lines are the runs of text the frame drew
// and two figures a run apart stay two figures. A build reporting the wrong
// field, or a placeholder, produces a different number. This is the same fact
// list and the same reading the two other engines' suites use: the case's
// review items do not differ by engine.
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
// WHAT THE VARIANT ADDS IS ITS OWN ITEM. `specs/instrumentation.md`'s Diagnostics
// list adds the torpedo charge and the torpedoes in flight under `warhead`, and
// those two are `instrumentation/overlay-reports-the-torpedo`, an item of the
// warhead checklist alone. They are not read here behind the build's own surface,
// which is what this script used to do: a requirement gated on what the build
// implemented can be shed by implementing less, so a `warhead` build that wrote no
// torpedo would pass this point on the strength of its omission while one that
// wrote the torpedo and left it off the panel would fail.
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

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  startPlaying,
  ticksFor,
  toggleOverlay,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The characters a build may GROUP a figure's digit triples with.
 *
 * A figure reaches a panel through the build's own formatter, and the ordinary one
 * — `Number.prototype.toLocaleString` — groups by default, with the comma, the
 * apostrophe or one of the thin and non-breaking spaces its locale calls for. All
 * of them write the same number.
 *
 * ASCII SPACE IS NOT ONE OF THEM. A panel's lines are the runs of text the frame
 * drew, and a build is free to draw a figure and its neighbour as runs one space
 * apart — so reading a space as a separator would take the two figures in `40 130`
 * for the single number `40130`. `.` is left out for the neighbouring reason: it is
 * the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * One figure as a build may write it: grouped into triples, or plain.
 *
 * A LEADING SIGN IS NOT PART OF THE FIGURE. What is read here is the digits, so a
 * build that writes a velocity component as `-448` and one that writes the
 * magnitude `448` are read alike — which is what the reading of a component posed
 * negative rests on.
 */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every figure the lines carry, as the numbers they read as.
 *
 * The separators are dropped from each match, so a panel that groups a figure
 * (`45,310`) and one that does not (`45310`) report the same number: the
 * specification fixes the FIGURE and leaves how it is written to the build.
 */
function drawnNumbers(lines: readonly string[]): number[] {
  return lines.flatMap((line) =>
    (line.match(DRAWN) ?? []).map((figure) =>
      Number(figure.replace(new RegExp(GROUP, "g"), "")),
    ),
  );
}

/** Fail unless some line carries `value` as a whole figure. */
function assertFigure(
  lines: readonly string[],
  value: number,
  requirement: string,
): void {
  if (drawnNumbers(lines).includes(value)) return;
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
});
