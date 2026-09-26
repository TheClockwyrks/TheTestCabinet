// machinery/grant-on-extraction — drawing out a marked core grants its machinery.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Granting"): "A run extracted while
// it contains a marked core grants that core's machinery on the tick of the
// extraction. ... Extraction is the only source of a grant". `specs/channel.md`
// ("The order of a tick") puts the grant on the same tick as the removal that
// caused it: step 3 seats the projectile and extracts the run it completes, and
// step 4 "grants the machinery the marks among the cores it took carry". So the
// snapshot taken at the end of the tick the projectile lands on already reports
// the machinery, at the full duration `specs/machinery.md` gives choke.
//
// THE SCENARIO. `specs/extraction.md` ("Extraction on an insertion"): "When an
// insertion resolves, take the maximal same-charge run containing the inserted
// core within that core's segment. That run is extracted on the same tick when
// it holds at least 3 cores." Two cores of one charge are posed a channel
// spacing apart on the straight top run, one of them carrying a choke mark, and
// a third of the same charge is fired into them. Whichever of the two the
// projectile strikes, and whichever side it enters on,
// `specs/injector.md` ("Insertion") leaves the three at consecutive spacings —
// the inserted core takes `p` and everything at or below `p` shifts back by one
// spacing — so the run is three long either way and the marked core is in it.
//
// THE HALL HOLDS THE PAIR AND NOTHING ELSE. `poseHall` holds the inlet with
// `setEmission(false)` and leaves the level's quota where it stands, so nothing
// arrives and the channel the extraction empties does not trip the clear
// `specs/progression.md` gives an EXHAUSTED quota — which is what lets the
// scenario be the two cores the requirement is about, with no third core standing
// anywhere to keep the hall in play.
//
// THE AIM. `specs/channel.md` advances the lead segment every tick of the
// flight, so the shot is aimed where the front core will BE when the projectile
// arrives rather than where it was posed: the flight time follows from
// `PROJECTILE_SPEED` and `STRIKE_DISTANCE` (`specs/injector.md`), and the lead
// it needs from the level's own feed speed. Nothing here is read off the
// reference; both figures come from the specs' tables.
//
// THE TOLERANCE. The kind and the emptied run are equalities. The seconds left
// on the grant are read on the tick it was made, so an ideal build reports the
// full 8 s; the case's standing duration tolerance of 2 ticks is the slack, and
// it is what separates a grant made on the tick of the extraction from one made
// a noticeable time later.

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

/** The charge the run is made of, and the mark one of its cores carries. */
const CHARGE = "halide";
const MARK = "choke";

/** The front core of the pair, on the straight top run directly above the injector. */
const FRONT_S = 380;

/** The core behind it, one channel spacing back, carrying the mark. */
const REAR_S = FRONT_S - SPACING;

const CORES: PosedCore[] = [
  [FRONT_S, CHARGE, null],
  [REAR_S, CHARGE, MARK],
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`grants ${MARK} on the tick the run holding its mark is extracted`, async () => {
  await poseHall(h, { level: LEVEL, cores: CORES, loaded: CHARGE });
  await fireToward(h, TARGET);

  const shot = await captureReplay(h, "grant", async () => {
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
    "the active machinery on the tick the marked run was extracted",
  );
  assertEqual(
    shot.snapshot.machinery?.kind,
    MARK,
    "the kind granted by the mark the extracted run carried",
  );
  assertNear(
    shot.snapshot.machinery?.remaining ?? Number.NaN,
    MACHINERY_DURATION[MARK],
    TICK_TOL * TICK_DT,
    `the seconds left on a ${MARK} granted this tick`,
  );
});
