// instrumentation/overlay — the debug overlay reports the game.
//
// WHAT IS THE BUILD'S PART UNDER THIS ENGINE. `specs/instrumentation.md` puts the
// panel, the backtick key that toggles it, its hidden-at-start state and its
// read-only-ness with the ENGINE, so a check on any of those returns the same
// verdict for every build on it. They are
// `instrumentation/overlay-is-a-read-only-toggle`, which names
// `engines = ["none"]`, where the build writes the runtime itself. What is left is
// the build's under every engine and is what this point decides: that the values
// the "Diagnostics" section lists were registered — the screen, the score, the
// lives and the wave; the ship's position, velocity, speed, facing and remaining
// respawn grace; how many bullets and how many rocks are in play; whether a saucer
// is up and where; and the accumulated simulation time. The overlay is toggled on
// to read what it drew, and nothing about the toggle itself is asserted.
//
// HOW THE LINES ARE READ. The engine draws the overlay after the game's `render`,
// through the same recorded context every other rendering check reads. So the text
// a steady frame draws WITHOUT the overlay is collected first, the text the
// toggle's frame draws WITH it second, and the difference between the two is the
// overlay's own lines. The engine's frame-time line is dropped from that
// difference: it is the engine's, and its figures are wall-clock timings that
// differ from run to run.
//
// HOW A VALUE IS RECOGNISED. Each figure below is looked for as a whole figure
// rather than as a substring, so the `4` of the bullet count is not answered by the
// `4` inside `448`, and the field is posed so that no two of the asserted figures
// collide. A figure the build GROUPED reads as the one figure it is — `45,310` and
// `45310` are the same score — while an ASCII space is not read as a separator,
// because a panel's lines are the runs of text the frame drew and two figures a run
// apart stay two figures. HOW a value is drawn is the build's: `specs/overview.md`
// fixes no palette, typeface or layout, the engine formats a number source itself,
// and a build is free to render an angle in degrees or in radians and a duration to
// whatever precision reads well — so the two values that have more than one honest
// written form are accepted in any of them. The two counts are small integers and
// are the weakest readings here; nothing about the specification lets them be made
// unique.
//
// THE FIELD IS POSED AND THEN PAUSED. `specs/ui.md` freezes the field behind the
// pause menu — "No body moves, no timer runs down" — so the figures the panel is
// read for are the figures that were posed rather than whatever the two frames of
// play would have moved them to.
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
// AND THE CLOCK IS DRIVEN TO A FIGURE OF ITS OWN FIRST. The accumulated simulation
// time is one of the values the overlay owes, and a reading taken moments after a
// reset is a `0` that half the panel could be showing anyway. So the run is carried
// to twenty-three seconds of game time over an EMPTY field — nothing to drift,
// nothing to spawn — and the crowd is posed onto it afterwards, at rest, for the
// two frames that are read.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  poseBullet,
  poseRock,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The run posed: three figures nothing else on this field carries. */
const SCORE = 45_310;
const LIVES = 14;
const WAVE = 17;

/** Where the ship stands, and the velocity it carries: a 336-448-560 triangle. */
const SHIP = { x: 218, y: 653 } as const;
const SHIP_VELOCITY = { vx: 336, vy: -448 } as const;
/** Its speed, which `specs/instrumentation.md` builds from the velocity beside it. */
const SHIP_SPEED = 560;

/**
 * The ship's posed facing: a quarter turn, which is straight down in the field's
 * coordinates (`specs/overview.md` measures angles clockwise from `+x`).
 *
 * A quarter turn is the one facing with a short written form in BOTH conventions a
 * build may honestly draw: `90` degrees, or `1.571` radians. Nothing else posed
 * here carries either figure.
 */
const SHIP_ANGLE = Math.PI / 2;
const FACING_FORMS = /1\.57|\b90\b/;

/**
 * The ship's posed respawn grace, in seconds, and the forms it may be drawn in.
 *
 * `2.5` seconds: a duration a build may print at any precision it likes, so the
 * pattern accepts it written out or rounded up to the whole second the engine's own
 * integer formatting would produce.
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

/** The engine's own frame-time line, which is not one of the game's sources. */
const ENGINE_METRICS = /^\s*frame\s*:/i;

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
    fail(`an overlay line carrying ${what} (${String(value)})`, lines);
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

afterEach(() => {
  h?.dispose();
});

it("draws every registered value the specification lists", async () => {
  // A quiet, empty run from a known zero, carried to the game time the panel has
  // to report. Two of the twenty-three seconds' ticks are left for the baseline
  // frame and the toggle's frame below, so the reading lands on the figure.
  h.debug.reset();
  startPlaying(h);
  await h.advance(ticksFor(SIM_SECONDS) - 2);

  // Then the crowd, posed onto the field it was carried to. Nothing is advanced
  // between the poses, so nothing drifts before it is frozen.
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);
  h.debug.setShipPosition(SHIP.x, SHIP.y);
  h.debug.setShipVelocity(SHIP_VELOCITY.vx, SHIP_VELOCITY.vy);
  h.debug.setShipAngle(SHIP_ANGLE);
  h.debug.setShipInvuln(INVULN);
  for (const bullet of BULLETS) poseBullet(h, bullet.x, bullet.y, 0, 0);
  for (let i = 0; i < ROCK_COUNT; i += 1) {
    poseRock(h, "small", ROCK_ROW_X0 + i * ROCK_ROW_STEP, ROCK_ROW_Y);
  }
  poseSaucer(h, SAUCER.x, SAUCER.y);

  // Frozen behind the pause menu, so what changes across the toggle is the
  // overlay and nothing else (specs/ui.md).
  h.debug.setScreen("paused");

  // A steady frame without the overlay, for the baseline text…
  h.clearCalls();
  await h.advance(1);
  const baseline = drawnText(h.calls);

  // …then the toggle's frame, with it. `Backquote` is the engine's own key,
  // outside every action `specs/controls.md` binds, so nothing the game
  // registered answers it.
  h.clearCalls();
  h.hold("Backquote");
  await h.advance(1);
  h.release("Backquote");
  captureStill(h, "overlay");

  const overlay = newLines(baseline, drawnText(h.calls)).filter(
    (line) => !ENGINE_METRICS.test(line),
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
});
