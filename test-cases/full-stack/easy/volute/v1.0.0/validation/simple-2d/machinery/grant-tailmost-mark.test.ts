// machinery/grant-tailmost-mark — when one extracted run carries two marks, the
// one nearest the tail is what is left active.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Granting"): "When one extracted run
// carries more than one marked core, each is granted in train order from the
// head, so the mark nearest the tail decides what is left active." Granting in
// train order from the head means the head's mark is granted first and the tail's
// last, and `specs/machinery.md` ("The active machinery") makes each grant
// replace the one before it — so the last one granted is the one standing.
//
// WHY IT IS A POINT OF ITS OWN. `machinery/grant-on-extraction` decides that a
// run carrying ONE mark grants it. This decides the order two marks resolve in,
// which a build implements separately: a build that grants the first mark it
// finds and stops, or that walks the run from the tail, satisfies the single-mark
// point and misses this one.
//
// THE SCENARIO. Two cores of one charge posed a channel spacing apart on the
// straight top run, the FRONT one carrying `choke` and the REAR one `sightline`,
// with a third of the same charge fired into them. `specs/extraction.md`
// ("Extraction on an insertion") extracts the maximal same-charge run containing
// the inserted core, which is all three whichever of the two the projectile
// strikes and whichever side it enters on: `specs/injector.md` ("Insertion")
// leaves the three at consecutive spacings either way. The seated core carries no
// mark, and the insertion never reorders the two that do — the shift moves cores
// back without passing one another — so the mark nearest the tail is the
// `sightline` posed at the rear.
//
// WHAT IS READ. The kind left active on the tick of the extraction. A build that
// grants head-first and lets each replace the last reports `sightline`; a build
// that stops at the first mark, or walks from the tail, reports `choke`. The two
// kinds also carry different durations (`specs/machinery.md`: choke 8 s,
// sightline 12 s), so the seconds left corroborate the kind.
//
// THE HALL HOLDS THE PAIR AND NOTHING ELSE. `poseHall` holds the inlet with
// `setEmission(false)` and leaves the level's quota where it stands, so nothing
// arrives and the channel the extraction empties does not trip the clear
// `specs/progression.md` gives an EXHAUSTED quota — which is what lets the
// scenario be the two marked cores the requirement is about.
//
// THE AIM. `specs/channel.md` advances the lead segment every tick of the flight,
// so the shot is aimed where the front core will BE when the projectile arrives
// rather than where it was posed: the flight time follows from `PROJECTILE_SPEED`
// and `STRIKE_DISTANCE` (`specs/injector.md`), and the lead it needs from the
// level's own feed speed.
//
// THE TOLERANCE. The kind is an equality. The seconds left are read on the tick
// the grant was made, so an ideal build reports the full 12 s; the case's standing
// duration tolerance of 2 ticks is the slack, and the 8 s a choke would report is
// 120 times that away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertTrue } from "../assert";
import {
  INJECTOR,
  MACHINERY_DURATION,
  PROJECTILE_SPEED,
  SPACING,
  STRIKE_DISTANCE,
  TICK_DT,
  TICK_TOL,
  levelSpec,
} from "../constants";
import {
  captureReplay,
  channelPoint,
  coreCount,
  createHarness,
  distance,
  driveShot,
  fireToward,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/** The level the hall opens on, whose feed speed the specs fix at 22 units/s. */
const LEVEL = 1;

/** The charge the run is made of. */
const CHARGE = "halide";

/** The mark nearer the HEAD, granted first and replaced. */
const HEAD_MARK = "choke";

/** The mark nearer the TAIL, granted last and left standing. */
const TAIL_MARK = "sightline";

/** The front core of the pair, on the straight top run directly above the injector. */
const FRONT_S = 380;

/** The core behind it, one channel spacing back. */
const REAR_S = FRONT_S - SPACING;

const CORES: PosedCore[] = [
  [FRONT_S, CHARGE, HEAD_MARK],
  [REAR_S, CHARGE, TAIL_MARK],
];

/** Ticks the projectile needs to come within striking distance of the pair. */
const FLIGHT_TICKS = Math.ceil(
  (distance(INJECTOR, channelPoint(FRONT_S)) - STRIKE_DISTANCE) /
    (PROJECTILE_SPEED * TICK_DT),
);

/** How far the lead segment rides while it flies, at the level's feed speed. */
const LEAD_S = levelSpec(LEVEL).feed * FLIGHT_TICKS * TICK_DT;

/** Where the front core will stand when the projectile reaches it. */
const TARGET = channelPoint(FRONT_S + LEAD_S);

/** Ticks recorded after the run is drawn out, so the replay shows what it left. */
const TRAILING_TICKS = 40;

/** The +/- 2 ticks the case's standing tolerances put on a duration, in seconds. */
const DURATION_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the tail-most mark's ${TAIL_MARK} active when one run carries two marks`, async () => {
  await poseHall(h, { level: LEVEL, cores: CORES, loaded: CHARGE });
  await fireToward(h, TARGET);

  const shot = await captureReplay(h, "tailmost", async () => {
    const landed = await driveShot(h);
    await h.step(TRAILING_TICKS);
    return landed;
  });

  assertTrue(shot.landed, "the fired core resolved within the sweep");
  assertEqual(
    coreCount(shot.snapshot),
    0,
    "the cores left on the channel once the run of three was drawn out",
  );

  assertNotNull(
    shot.snapshot.machinery,
    "the active machinery on the tick a run carrying two marks was extracted",
  );
  assertEqual(
    shot.snapshot.machinery?.kind,
    TAIL_MARK,
    `the kind left active, which the mark nearest the TAIL (${TAIL_MARK}) decides ` +
      `rather than the one nearest the head (${HEAD_MARK})`,
  );
  assertNear(
    shot.snapshot.machinery?.remaining ?? Number.NaN,
    MACHINERY_DURATION[TAIL_MARK],
    DURATION_TOL,
    `the seconds left on the ${TAIL_MARK} the tail-most mark granted`,
  );
});
