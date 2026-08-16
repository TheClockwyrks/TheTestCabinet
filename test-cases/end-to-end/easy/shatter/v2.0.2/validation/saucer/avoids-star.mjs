// Automated validation for the Saucer item `avoids-star`. `specs/hazards.md` asks for two
// things in one sentence — the saucer "steers to avoid the star's core, never overlapping
// it" — and this item drives both, in two scenarios.
//
//   1. THE STEER. A saucer is posed at rest just below the core and the real sim run for
//      0.8 s. Its distance from the star must grow.
//   2. THE CROSSINGS. A saucer enters at an edge and crosses the field horizontally at
//      cruise — the entry `specs/hazards.md` describes — and must never bring its centre
//      within `CONTACT` of the star's. Fifty-four crossings are flown and the closest
//      approach of any of them decides the item.
//
// The two scenarios measure different things. A saucer parked at rest is moved out by any
// push at all, so scenario 1 sees only whether a build reacts to the star; scenario 2 gives
// it a real approach to steer through and reads how close it comes.
//
// The crossings are nine rows, from 80 px below the star's row to 80 px above it in 20 px
// steps, each flown from the left edge and from the right, and the whole set flown three
// times from different seeds. Rows either side of the star measure avoidance that only works
// on one side; the repeats vary where a build's weave reroll falls in the approach, which
// moves the closest approach around by tens of pixels on the same row.
//
// A live saucer is posed rather than one conjured at the sample point: `spawnSaucer` puts a
// real one on the field and `setSaucer` moves it, so what is measured is the build's own body
// under its own steering. Each crossing is flown in a game of its own from its own seed
// (`poseCrossing`), so it can be reproduced exactly, and a crossing is sampled every `STRIDE`
// ticks with the closest approach between samples computed from the pair
// (`segmentMinToStar`).
//
// THE CLIP is one crossing at the speed it actually runs: `FILMED`, the dead-on approach
// along the star's own row, an ordinary member of the sweep measured with the rest. `arrange`
// poses it and `act` flies it; the measurements then sit behind an `advance` that overruns
// the filming budget, which ends the record pass there and leaves them to the validate pass.
// The assertion names the crossing that came closest, which the clip does not show — the
// sweep that finds it has to run after the filming.
//
// A bystander rock keeps the field occupied. `newGame` leaves it empty, an empty field is a
// cleared wave, and a build may treat the wave banner that raises as a lull with nothing to
// move — which would hold the saucer still for the whole measurement.

import {
  newGame,
  arrangeBystanderRock,
  distToStar,
  hyp,
  CORE_R,
  SAUCER_R,
  SAUCER_CRUISE,
  STAR_X,
  STAR_Y,
  TICK,
  TICK_HZ,
} from "../_helpers.mjs";

// The saucer's centre may come no closer to the star's than this: the core's radius
// plus the saucer's, the contact distance `specs/hazards.md` forbids it to cross.
const CONTACT = CORE_R + SAUCER_R;

// Where a crossing starts, and the rows it is flown on: from 80 px below the star's row
// to 80 px above it in 20 px steps, as offsets from `STAR_Y`. Each row is flown from the
// left edge (`vx` positive) and from the right (`vx` negative).
const ENTRY_LEFT = 40;
const ENTRY_RIGHT = 1240;
const ROWS = [-80, -60, -40, -20, 0, 20, 40, 60, 80];

// Each crossing is its own game, seeded from here plus its index — see `poseCrossing`.
const CROSSING_SEED = 101;

// How many times the whole set of rows is flown, each repeat from a fresh set of seeds. At
// fifty-four crossings, a fault that shows on one crossing in ten is caught about 997 times
// in a thousand.
const REPEATS = 3;

// How far a crossing is followed. At cruise, 660 ticks carries the saucer 770 px from its
// entry edge — from one side to well past the star — and stays inside the saucer's own
// lifetime, so the body being measured is never a despawn away from the field.
const CROSS_TICKS = 660;

// How often a crossing is sampled, in ticks — about 17 px of travel at cruise. The closest
// approach between two samples comes from `segmentMinToStar`, so the stride can stay coarse.
const STRIDE = 8;

// A step longer than this is the field wrapping rather than the saucer moving: at cruise
// plus a hard weave a stride covers about 20 px, so 200 px can only be a seam crossing.
const WRAP_STEP = 200;

// The filming budget covers the one filmed crossing and 300 ms more; `CLIP_END` is the
// advance that overruns it and ends the record pass.
const MS_PER_TICK = 1000 / TICK_HZ;
const CLIP_MS = CROSS_TICKS * MS_PER_TICK + 300;
const CLIP_END = 240;

/** The entry pose for one crossing: `row` is an offset from the star's row. */
function entry(row, fromLeft) {
  return {
    x: fromLeft ? ENTRY_LEFT : ENTRY_RIGHT,
    y: 360 + row,
    vx: fromLeft ? SAUCER_CRUISE : -SAUCER_CRUISE,
    vy: 0,
  };
}

/**
 * Every crossing the sweep flies, in order, each with the seed that reproduces it. Built
 * once at module load so `FILMED` can be picked out of the same list the sweep walks.
 */
function allCrossings() {
  const out = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    for (const row of ROWS) {
      for (const fromLeft of [true, false]) {
        out.push({
          row,
          fromLeft,
          repeat,
          seed: CROSSING_SEED + out.length,
          pose: entry(row, fromLeft),
          label:
            `row ${row >= 0 ? "+" : ""}${row}, ` +
            `from the ${fromLeft ? "left" : "right"}, game ${repeat + 1}`,
        });
      }
    }
  }
  return out;
}

const CROSSINGS = allCrossings();

// The crossing the clip shows: straight along the star's own row, from the left, on the
// first game — the approach that runs dead at the core.
const FILMED = CROSSINGS.find(
  (crossing) =>
    crossing.row === 0 && crossing.fromLeft && crossing.repeat === 0,
);

/**
 * Put a fresh saucer on the line for one crossing, in a game of its own.
 *
 * A build's weave comes off its seeded generator, so giving each crossing its own `seed`
 * and its own `newGame` both fixes the weave a crossing meets — the same calls from the
 * same seed reproduce it exactly — and varies it from one crossing to the next.
 */
async function poseCrossing(api, pose, seed) {
  await newGame(api, seed);
  await arrangeBystanderRock(api); // keeps the field occupied — see the header
  await api.call("spawnSaucer");
  await api.call("setSaucer", pose);
}

/**
 * How close the star's centre comes to the straight line between two consecutive
 * samples of the saucer — the closest approach the sampling itself steps over.
 *
 * A stride is 0.067 s, over which even a hard steer bows the saucer's path by about a
 * pixel, so the point-to-segment distance is the closest approach to within that.
 *
 * `Infinity` for a step that crossed a wrap seam, where the line between the two samples
 * runs across the field rather than along the saucer's path.
 */
function segmentMinToStar(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (hyp(dx, dy) > WRAP_STEP) return Infinity;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distToStar(from);
  // Where along the segment the star's centre projects, clamped to the segment itself.
  const t = Math.max(
    0,
    Math.min(1, ((STAR_X - from.x) * dx + (STAR_Y - from.y) * dy) / len2),
  );
  return distToStar({ x: from.x + t * dx, y: from.y + t * dy });
}

/**
 * Fly one crossing and return the closest the saucer came to the star's centre, following
 * it until it is past the star or leaves the field. Instant in both passes.
 */
async function crossingMin(api, pose, seed) {
  await poseCrossing(api, pose, seed);

  let previous = (await api.snapshot()).saucer;
  let min = distToStar(previous);
  for (let spent = 0; spent < CROSS_TICKS; spent += STRIDE) {
    await api.skip(STRIDE);
    const saucer = (await api.snapshot()).saucer;
    if (!saucer) return { min, survived: false };
    min = Math.min(min, distToStar(saucer), segmentMinToStar(previous, saucer));
    previous = saucer;
  }
  return { min, survived: true };
}

export default function item() {
  // Scenario 1: the saucer's distance from the star at the start, its closest
  // approach, and its distance at the end.
  let startD;
  let minD;
  let endD;
  let steerSurvived;
  // Scenario 2: the closest any crossing came to the star, which crossing that was,
  // and whether every crossing still had a saucer on the field to be measured.
  let worst;
  let worstLabel;
  let allSurvived;

  return {
    id: "saucer.avoids-star",

    clipMs: CLIP_MS,

    // Pose the one crossing the clip shows; everything else runs in `act`, behind the
    // budget overrun.
    async arrange(api) {
      await poseCrossing(api, FILMED.pose, FILMED.seed);
    },

    async act(api) {
      // The clip: one crossing, at the speed it actually runs.
      await api.advance(CROSS_TICKS);

      // The end of the clip. This overruns the filming budget, which unwinds the record
      // pass out of `act`; the validate pass has no budget and reads it as one more
      // instant step, so everything below is measured but never filmed.
      await api.advance(CLIP_END);

      // Scenario 1: the steer. A build is free to despawn the saucer mid-sweep, so the
      // loop stops if it goes and `steerSurvived` reports that rather than throwing.
      await newGame(api);
      await arrangeBystanderRock(api);
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 640, y: 430, vx: 0, vy: 0 }); // just below the core
      startD = distToStar((await api.snapshot()).saucer);
      minD = startD;
      endD = startD;
      steerSurvived = true;
      for (let i = 0; i < 96; i += 1) {
        await api.skip(TICK);
        const saucer = (await api.snapshot()).saucer;
        if (!saucer) {
          steerSurvived = false;
          break;
        }
        minD = Math.min(minD, distToStar(saucer));
        endD = distToStar(saucer);
      }

      // Scenario 2: the crossings, the filmed one among them.
      worst = Infinity;
      worstLabel = "";
      allSurvived = true;
      for (const crossing of CROSSINGS) {
        const { min, survived } = await crossingMin(
          api,
          crossing.pose,
          crossing.seed,
        );
        allSurvived = allSurvived && survived;
        if (min < worst) {
          worst = min;
          worstLabel = crossing.label;
        }
      }
    },

    async assert(api, check) {
      check.expectGt("the saucer never overlaps the core", minD, CONTACT);
      check.expectGt("the saucer steers away from the star", endD, startD + 20);
      check.expectOk(
        "the saucer stayed on the field to be measured, on the steer and on every crossing",
        steerSurvived && allSurvived,
      );
      // A build that clamps the saucer out lands exactly ON the contact distance, so
      // allow a pixel for it and for the float arithmetic behind it.
      check.expectGt(
        `crossing the field, the saucer never overlaps the core (closest on ${worstLabel})`,
        worst,
        CONTACT - 1,
      );
    },
  };
}
