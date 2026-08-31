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
// otherwise identical frame: the score is `8765` rather than a round figure, the
// wave is `29`, the ship's centre is `(321, 654)` and the saucer's `(246, 135)`,
// and the two counts are `12` rocks and `4` rounds. A build reporting the wrong
// field, or a placeholder, produces a different number.
//
// A PAIR IS REQUIRED ON ONE LINE. A position is two figures, and the
// specification asks for the position rather than for two loose numbers, so the
// ship's line has to carry both `321` and `654` and the saucer's both `246` and
// `135`. That is also what keeps the score's `8765` and the ship's `321` from
// standing in for one another.
//
// FIVE OF THE LISTED FACTS ARE NOT READ HERE, and the reason is the same for all
// five: the ship's velocity, its speed, its facing, its remaining respawn grace
// and the accumulated simulation time have no build-independent token. A facing
// may be shown in degrees or radians; a speed, a grace and a time to whatever
// precision the build chooses; and a velocity at rest reads `0`, which every
// other line on the panel also carries. Any pattern tight enough to identify one
// of them would be demanding a presentation the specification deliberately
// leaves to the build ("Keep each one short enough to read on a line"). The
// eight facts above are the ones a distinctive value can be posed for, and they
// are asked for exactly.
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

/** Whether `line` carries `value` as a number in its own right. */
function carries(line: string, value: number): boolean {
  return new RegExp(`(?<!\\d)${value}(?!\\d)`).test(line);
}

/** Fail unless some line carries every one of `values` as a number. */
function assertSomeLineCarries(
  lines: readonly string[],
  values: readonly number[],
  requirement: string,
): void {
  if (lines.some((line) => values.every((value) => carries(line, value)))) {
    return;
  }
  fail(
    `an overlay line reporting ${values.join(" and ")} — ${requirement} ` +
      "(specs/instrumentation.md, Diagnostics)",
    lines,
  );
}

it("draws the facts the specification lists, over a posed field", async () => {
  startPlaying(h);

  h.debug.setScore(POSED.score);
  h.debug.setWave(POSED.wave);
  h.debug.setLives(POSED.lives);
  h.debug.setShipPosition(POSED.ship.x, POSED.ship.y);
  h.debug.setShipVelocity(0, 0);

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

  // A baseline frame of the bare playing screen's own text.
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

  const screenLine = added.find((line) =>
    line.toLowerCase().includes("playing"),
  );
  if (screenLine === undefined) {
    fail(
      'an overlay line reporting the current screen, which is "playing" ' +
        "(specs/instrumentation.md, Diagnostics)",
      added,
    );
  }

  assertSomeLineCarries(added, [POSED.score], "the score");
  assertSomeLineCarries(added, [POSED.lives], "the lives");
  assertSomeLineCarries(added, [POSED.wave], "the wave");
  assertSomeLineCarries(
    added,
    [POSED.ship.x, POSED.ship.y],
    "the ship's position",
  );
  assertSomeLineCarries(added, [ROCK_COUNT], "how many rocks are in play");
  assertSomeLineCarries(added, [BULLET_COUNT], "how many bullets are in play");
  assertSomeLineCarries(
    added,
    [POSED.saucer.x, POSED.saucer.y],
    "the saucer's position while one is up",
  );
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
