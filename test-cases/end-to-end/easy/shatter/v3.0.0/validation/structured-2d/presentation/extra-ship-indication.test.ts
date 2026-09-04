// presentation/extra-ship-indication — an awarded ship is announced on the field.
//
// THE RULE. `specs/scoring.md`: "One extra ship is granted each time the score
// crosses a multiple of `EXTRA_LIFE_STEP` (`10 000`) through play... An extra ship
// being granted is announced on the field for at least half a second, distinctly from
// anything drawn there the moment before." The award is the game's one reward, and a
// player who does not notice it plays the next ship as though it were their last.
//
// THE AWARD IS EARNED, NOT POSED. `specs/instrumentation.md` makes `setScore` pose
// the figure and grant nothing, so a check that posed the score across the boundary
// would be grading the debug operation rather than the game. The score is posed one
// Small short of `10 000` and the Small is then SHOT DOWN — the build's own
// collision, its own scoring and its own award — so what is read is the announcement
// the game itself made.
//
// WHAT IS READ. Every square unit of the field, before the kill and after it, and
// what is required is that the build painted something it had not painted the frame
// before. Nothing about the announcement is asserted beyond its presence and its
// duration: `specs/overview.md` leaves the look to the build, so a word, a flash, a
// mark or a burst all pass, and only a build that announced nothing fails.
//
// TWO THINGS THAT WOULD OTHERWISE BE READ AS THE ANNOUNCEMENT, AND HOW EACH IS
// EXCLUDED:
//
//   - WHERE THE KILL HAPPENED. A rock and a round left the field on that tick, and a
//     build may draw a burst where they went. A disc around the kill is therefore not
//     read at all, and `KILL_SPOT` is out toward the lower-right corner so that
//     blanking it cannot also blank the middle of the field, where an announcement
//     drawn "on the field" is most likely to land.
//   - THE HUD'S OWN ANSWER. The score and the ships in reserve BOTH change on the
//     award tick (`specs/ui.md`), and redrawn digits and an added glyph are changed
//     units like any other. So a CONTROL frame is taken first: the same score and the
//     same ship count posed through `setScore` and `setLives`, which grant nothing and
//     announce nothing, and every unit that frame moved is struck from the reading.
//     What is left is what the AWARD drew and the HUD did not.
//
// AND FOR HOW LONG. The reading is taken twice, on the award tick and half a second
// of game time later, because `specs/scoring.md` fixes the duration as well as the
// announcement. A build that flashed something for one frame passes the first and
// fails the second.
//
// THE POSE. An emptied, gated field. The wave loop is shut, so destroying the last
// rock on the field raises no banner — `setWaveSpawning(false)` gates "noticing that
// the last rock has been destroyed, raising the `WAVE N` banner"
// (`specs/instrumentation.md`) — and the saucer loop is shut, so nothing arrives. The
// ship stands at the safe point at rest with its contact test gated, so it is drawn
// identically on every frame read.

import { afterEach, beforeEach, it } from "vitest";
import {
  EXTRA_LIFE_SHOW_MIN,
  EXTRA_LIFE_STEP,
  MUZZLE_SPEED,
  SCORE_SMALL,
  START_LIVES,
} from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { type Vec } from "../geometry";
import {
  aimedRound,
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  changedCells,
  readInk,
  readPainted,
  type Cell,
  type InkGrid,
} from "./ink";
import { KILL_SPOT, WHOLE_FIELD, sampleField } from "./scene";

/** The side of a square unit the field is read in, in logical units. */
const CELL = 2;

/**
 * How much a square unit's reading must move between two frames to count as changed,
 * of 441.
 *
 * Forty, two thirds of the sixty this group calls "drawn apart from the field", so an
 * announcement drawn faintly still registers while a build's own dithering between
 * two frames of one picture does not.
 */
const CHANGE = 40;

/**
 * How wide a disc around the kill is left unread, in logical units.
 *
 * `90`. A Small collides as a circle of `14` (`specs/rocks.md`) and the round that
 * takes it starts `18` outside its centre, so everything the kill itself removes from
 * the frame is well inside this, and a build is left room to draw a burst where the
 * rock was without any of it being read as the announcement.
 */
const BLANK_R = 90;

/**
 * How many square units the announcement must cover.
 *
 * Forty cells of `2 x 2` is `160` square units of the `1280 x 720` field.
 * `specs/scoring.md` requires the award to be announced "distinctly from anything
 * drawn there the moment before", and the smallest mark a player could read as an
 * announcement at that size — a short word, a ring around the ship, a flashed bar —
 * covers several hundred square units. This sits under the least of them and far
 * above the handful of units a build's anti-aliasing moves between two frames.
 */
const MIN_ANNOUNCED = 40;

/**
 * How long the round is given to cross its standoff, in frames.
 *
 * `aimedRound` places it four units off the rock's surface closing at `MUZZLE_SPEED`,
 * which is one frame of travel; a quarter of a second is thirty times that, so a
 * build whose swept pass resolves a frame or two late still lands, and a round that
 * missed is not chased round the field.
 */
const FLIGHT_TICKS = ticksFor(0.25);

/** How long after the award the announcement must still be drawn. */
const HELD_TICKS = ticksFor(EXTRA_LIFE_SHOW_MIN);

/** Whether a point is far enough from the kill to be read at all. */
function clearOfTheKill(at: Vec): boolean {
  return Math.hypot(at.x - KILL_SPOT.x, at.y - KILL_SPOT.y) > BLANK_R;
}

/** A cell as a key, so one frame's changes can be struck from another's. */
function keyOf(cell: Cell): string {
  return `${String(cell.col)},${String(cell.row)}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws something on the field on the tick a kill earns a ship, and still draws it half a second later", async () => {
  startPlaying(h);
  h.debug.setScore(EXTRA_LIFE_STEP - SCORE_SMALL);
  const rock = poseRock(h, "small", KILL_SPOT.x, KILL_SPOT.y);
  await h.advance(1);

  const field = sampleField(readPainted(h));
  const read = (): InkGrid => readInk(readPainted(h), WHOLE_FIELD, CELL, field);
  const opening = read();

  // The control: the HUD told the same two numbers, by operations that grant
  // nothing and announce nothing. Everything it moves is the HUD's own doing.
  h.debug.setScore(EXTRA_LIFE_STEP);
  h.debug.setLives(START_LIVES + 1);
  await h.advance(1);
  const hud = new Set(
    changedCells(opening, read(), CHANGE, clearOfTheKill).map(keyOf),
  );

  h.debug.setScore(EXTRA_LIFE_STEP - SCORE_SMALL);
  h.debug.setLives(START_LIVES);
  await h.advance(1);
  const before = read();

  /** What the build drew that neither the frame before nor the HUD accounts for. */
  const announced = (after: InkGrid): number =>
    changedCells(before, after, CHANGE, clearOfTheKill).filter(
      (cell) => !hud.has(keyOf(cell)),
    ).length;

  const target = requireRock(
    h.snapshot(),
    rock,
    "the Small whose destruction carries the score across the boundary — " +
      "addRock appends one rock of the size named (specs/instrumentation.md)",
  );
  const round = aimedRound(target);
  poseBullet(h, round.x, round.y, round.vx, round.vy);
  const kill = await h.until((s) => !s.rocks.some((one) => one.id === rock), {
    maxFrames: FLIGHT_TICKS,
    poll: 1,
  });
  const awarded = read();
  captureStill(h, "award");
  await h.advance(HELD_TICKS);
  const held = read();

  assertEqual(
    kill.hit,
    true,
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} frames by a ` +
      `round placed on its doorstep and closing at ${String(MUZZLE_SPEED)} ` +
      "units per second (specs/collision.md)",
  );

  assertEqual(
    kill.snapshot.score,
    EXTRA_LIFE_STEP,
    `the score after a ${String(SCORE_SMALL)}-point kill taken from ` +
      `${String(EXTRA_LIFE_STEP - SCORE_SMALL)}, which is the crossing this ` +
      "point is about (specs/scoring.md)",
  );

  assertGreaterThanOrEqual(
    announced(awarded),
    MIN_ANNOUNCED,
    "how many square units of the field, clear of the kill and of the HUD's " +
      "own answer to the same score and ship count, the build painted on the " +
      `tick the score crossed ${String(EXTRA_LIFE_STEP)} that it had not ` +
      "painted the frame before (specs/scoring.md)",
  );

  assertGreaterThanOrEqual(
    announced(held),
    MIN_ANNOUNCED,
    `the same count ${String(EXTRA_LIFE_SHOW_MIN)} seconds of game time after ` +
      "the award, where the announcement must be drawn for at least that long " +
      "(specs/scoring.md)",
  );
});
