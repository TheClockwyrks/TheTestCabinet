// instrumentation/overlay — the debug overlay reports every fact the Diagnostics
// section of specs/instrumentation.md lists.
//
// WHAT THIS ITEM DECIDES, AND WHAT IT LEAVES TO ANOTHER. The values a build
// registers are the build's work under every engine, so this item covers all three
// and the fact list below is the same list under each. That the panel appears, that
// the backtick key toggles it, and that watching it changes nothing are the RUNTIME's
// under an engine and the build's only with no engine, so they are
// `instrumentation/overlay-is-a-read-only-toggle`, which names `engines = ["none"]`.
// The overlay is toggled on here to read what it drew, and nothing about the toggle
// itself is asserted.
//
// WHAT IS ASSERTED IS THE VALUE, NEVER THE WORDING. The specification requires a
// set of FACTS and requires each to be short enough to read on a line; it fixes no
// format, no layout, no wording and no units, and asking for any of those would fail
// a build that reported the same fact differently. So the field is posed to figures
// nothing else on it carries, and each is looked for as a WHOLE FIGURE among the
// lines the toggle ADDED to an otherwise identical frame — so the `4` of the bullet
// count is not answered by the `4` inside `448`. A figure the build GROUPED reads as
// the one figure it is: `45,310` and `45310` are the same score, whatever separator
// its formatter reached for. An ASCII space is not one of those separators, because
// a panel's lines are the runs of text the frame drew and two figures a run apart
// stay two figures. A build reporting the wrong field, or a placeholder, produces a
// different number.
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
// pause menu — "No body moves, no timer runs down" — so the figures the panel is
// read for are the figures that were posed rather than whatever a tick of play had
// moved them to.
//
// AND THE CLOCK IS DRIVEN TO A FIGURE OF ITS OWN FIRST. The accumulated simulation
// time is one of the values the overlay owes, and a reading taken moments after a
// reset is a `0` that half the panel could be showing anyway. So the run is carried
// to twenty-three seconds of game time over an EMPTY field — nothing to drift,
// nothing to spawn — and the crowd is posed onto it afterwards, at rest, for the
// frames that are read. One tick of the twenty-three is left for the key press the
// toggle spends, so the reading lands on the figure.
//
// THE FRAMES ARE READ THROUGH A REDRAW RATHER THAN A TICK. `presentCalls` redraws
// the state as it stands without advancing it, so the only game time this scenario
// spends is the single tick that delivers the key press.
//
// WHAT THE VARIANT ADDS IS ITS OWN ITEM. specs/instrumentation.md's Diagnostics list
// adds the torpedo charge and the torpedoes in flight under `warhead`, and those two
// are `instrumentation/overlay-reports-the-torpedo`, an item of the warhead checklist
// alone. They are not read here behind the build's own torpedo roster, which is what
// this script used to do: a requirement gated on what the build implemented can be
// shed by implementing less, so a `warhead` build that wrote no torpedo would pass
// this point on the strength of its omission while one that wrote the torpedo and
// left it off the panel would fail. A suite is named by a variant's checklist, so it
// already knows which variant it is grading.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  presentCalls,
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

/** Some line carries `value` as a whole figure; fails naming what was wanted. */
function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!drawnNumbers(lines).includes(value)) {
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

it("draws every registered value when the overlay is toggled on", async () => {
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
  // Frozen behind the pause menu, so what changes across the toggle is the overlay
  // and nothing else (specs/ui.md).
  await h.debug.setScreen("paused");

  // The frame as the build draws it with the overlay off, which specs/controls.md
  // says is how the game starts. `presentCalls` redraws without advancing.
  const bare = drawnText(await presentCalls(h));

  await toggleOverlay(h);
  const overlaid = drawnText(await presentCalls(h));
  await captureStill(h, "overlay");
  const overlay = newLines(bare, overlaid);

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
});
