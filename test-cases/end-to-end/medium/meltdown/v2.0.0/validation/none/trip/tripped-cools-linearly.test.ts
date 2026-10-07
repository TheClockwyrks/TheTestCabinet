// Meltdown — trip/tripped-cools-linearly: a tripped tower bleeds to zero.
//
// `specs/heat.md` gives a tripped emitter one flow and one rate: it "bleeds its
// heat to `0` at `TRIP_HEAT / TRIP_TIME`, which is `20` per second, whatever its
// faces and whatever stands beside it". LINEAR is the whole of the point — every
// other flow in this game is proportional to something, and this one is not, so
// a tripped tower loses the same `20` in its first second as in its last.
//
// THE READING IS A RATE, TAKEN BETWEEN TWO SAMPLES A WHOLE SECOND APART. Reading
// the rate rather than the absolute heat is what makes it independent of which
// frame a build starts the bleed on: both samples are taken at frame boundaries,
// so a build that begins bleeding a frame later than another still loses exactly
// `20` per second between them. And it is taken between the FIRST and the LAST
// sample rather than at one point, so a bleed that started right and sagged
// cannot pass.
//
// THE FOUR SAMPLES ARE THEN CHECKED AGAINST THE LINE ITSELF, at `80`, `60`, `40`
// and `20`. A rate alone would accept a curve with the right endpoints; the line
// is what rejects one. Together they are a single requirement measured in one
// drive.
//
// THE TOWER STANDS ALONE, all four faces onto open floor, which is the "whatever
// its faces" half of the rule read at its hardest. `specs/towers.md` gives the
// Arc a 2x2 footprint with radiator faces N and S, so an ONLINE Arc at heat
// `100` sheds `(3.6 * 4 + 1.1 * 4) * 1.00` per second through its four radiator
// edge-tiles and its four plain ones, which is `18.8`. A build that goes on
// shedding air while tripped therefore starts out losing `38.8` per second and
// has emptied the tower long before the last sample; one that sheds air INSTEAD
// of bleeding loses `18.8` at the top and less every second after. That a
// NEIGHBOUR cannot change the figure either is `trip/tripped-takes-no-flow`'s
// item.
//
// THE DRIVE STOPS AT FOUR SECONDS, one short of the cooldown, so nothing here
// reads the clamp at `0` or the return — `trip/returns-cold` decides those.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseTrippedTower,
  startRun,
  type Harness,
} from "../harness";
import { TRIP_SITE, readTower } from "./bench";

/** The emitter posed tripped, at the heat and cooldown a trip leaves it with. */
const TOWER = "arc";
const POSED_HEAT = TRIP_HEAT;
const POSED_TIMER = TRIP_TIME;

/** The bleed `specs/heat.md` states: `TRIP_HEAT / TRIP_TIME`, so 20 per second. */
const BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/**
 * When the bleed is sampled, in seconds of game time from the pose.
 *
 * Every whole second up to one short of the cooldown, so the last sample sits at
 * heat `20` and no reading is taken where the clamp at `0` or the return could
 * reach it.
 */
const SAMPLE_TIMES: readonly number[] = [1, 2, 3, 4];

/** The heat the line puts the tower at, `t` seconds into the cooldown. */
function lineAt(t: number): number {
  return POSED_HEAT - BLEED_RATE * t;
}

/**
 * How close the measured RATE must come to `20`, as decimal places.
 *
 * Two places is `0.005` of a heat point per second. Both samples are taken at
 * frame boundaries an exact three seconds of game time apart and the rate is a
 * constant the specification states outright, so a conformant build lands on it
 * to float slack whatever frame it began on. What the bound excludes is every
 * wrong model by whole heat points a second: air cooling running alongside the
 * bleed empties the tower before the window closes, air cooling INSTEAD of it
 * reads a falling rate under `18.8`, and a bleed sized to the tower's own heat
 * rather than to `TRIP_HEAT` reads a curve.
 */
const RATE_DIGITS = 2;

/**
 * How close each sample must come to the line, as decimal places.
 *
 * Zero places is `0.5` of a heat point on a scale of `100`, which is three
 * frames of the bleed at `20` per second. The room is there for one thing: a
 * build may begin bleeding on the frame that follows the pose rather than on the
 * pose's own, and a frame of `0.167` either way is not a difference in the rule.
 * What it excludes is any curve at all — a bleed proportional to heat passes
 * through `81.9`, `67.0` and `54.9` where the line requires `80`, `60` and `40`.
 */
const LINE_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A tripped tower bleeds to zero", async () => {
  await startRun(h);
  const id = await poseTrippedTower(h, TOWER, TRIP_SITE.col, TRIP_SITE.row, {
    heat: POSED_HEAT,
    timer: POSED_TIMER,
  });

  const samples = await captureReplay(h, "bleed", async () => {
    const read: { t: number; heat: number }[] = [];
    let spent = 0;
    for (const t of SAMPLE_TIMES) {
      await h.advance(framesFor(t - spent));
      spent = t;
      read.push({
        t,
        heat: (await readTower(h, id, `the tripped ${TOWER} at ${t}s`)).heat,
      });
    }
    return read;
  });

  const first = samples[0];
  const last = samples[samples.length - 1];
  assertCloseTo(
    (first.heat - last.heat) / (last.t - first.t),
    BLEED_RATE,
    RATE_DIGITS,
    `the heat per second a tripped ${TOWER} standing on open floor sheds, ` +
      `measured from ${first.heat.toFixed(3)} at ${first.t}s to ` +
      `${last.heat.toFixed(3)} at ${last.t}s`,
  );
  for (const sample of samples) {
    assertCloseTo(
      sample.heat,
      lineAt(sample.t),
      LINE_DIGITS,
      `the heat a tripped ${TOWER} carries ${sample.t}s into its ` +
        `${POSED_TIMER}s cooldown, on the line from ${POSED_HEAT} at ` +
        `${BLEED_RATE} per second`,
    );
  }
});
