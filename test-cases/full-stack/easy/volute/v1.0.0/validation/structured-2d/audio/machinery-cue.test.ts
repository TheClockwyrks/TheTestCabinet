// audio/machinery-cue — the cue a grant plays is `machinery`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `machinery` is played when
// "Machinery is granted". `specs/machinery.md` fixes when that is: extracting
// a run one of whose cores carries a mark grants the marked kind, which is
// what `machinery/grant-on-extraction` decides and what this drive reproduces.
//
// WHY THE GRANT IS EARNED RATHER THAN POSED. The surface's `grantMachinery` is
// a pose, and "a pose changes the state alone and sounds nothing", so a
// granted machinery a check wants to HEAR has to be granted by the ticks. A
// pair of matching cores is posed with the rear one marked `choke`, and a
// third of the same charge is fired into them.
//
// WHAT ELSE SOUNDS ON THAT TICK, AND WHY THAT IS FINE. The insertion and the
// extraction resolve on the same tick, so `seat` and `extract-1` sound beside
// the grant — which `specs/ui.md` allows: "a tick raising several different
// cues sounds each of them once". What is read is that `machinery` is among
// them, exactly once.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  INJECTOR,
  PROJECTILE_SPEED,
  SPACING,
  STRIKE_DISTANCE,
  TICK_DT,
  levelSpec,
} from "../constants";
import {
  captureReplay,
  channelPoint,
  createHarness,
  distance,
  driveShot,
  fireToward,
  poseHall,
  watchCues,
  type Harness,
  type PosedCore,
} from "../harness";
import { assertHeardOnce, openHall } from "./cues";

/** The level the hall opens on, whose feed speed the specs fix at 22 units/s. */
const LEVEL = 1;

/** The charge the run is made of, and the mark one of its cores carries. */
const CHARGE = "halide";
const MARK = "choke";

/** The front core of the pair, on the straight top run above the injector. */
const FRONT_S = 380;

const CORES: PosedCore[] = [
  [FRONT_S, CHARGE, null],
  [FRONT_S - SPACING, CHARGE, MARK],
];

/** Ticks the projectile needs to come within striking distance of the pair. */
const FLIGHT_TICKS = Math.ceil(
  (distance(INJECTOR, channelPoint(FRONT_S)) - STRIKE_DISTANCE) /
    (PROJECTILE_SPEED * TICK_DT),
);

/** Where the front core will stand when the projectile reaches it. */
const TARGET = channelPoint(
  FRONT_S + levelSpec(LEVEL).feed * FLIGHT_TICKS * TICK_DT,
);

/** Ticks recorded after the grant, so the clip shows what it left. */
const TRAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the machinery cue on the tick a mark grants its kind", async () => {
  await openHall(h);
  await poseHall(h, { level: LEVEL, cores: CORES, loaded: CHARGE });
  await fireToward(h, TARGET);

  const played = watchCues(h);
  const granted = await captureReplay(h, "machinery", async () => {
    const landed = await driveShot(h);
    const measured = { landed, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(granted.landed.landed, "the fired core resolved within the sweep");
  assertEqual(
    granted.landed.snapshot.machinery?.kind,
    MARK,
    "the kind the extracted run's mark granted, so a grant really happened",
  );
  assertHeardOnce(
    granted.cues,
    granted.tick,
    "machinery",
    "the machinery cue on the tick the grant resolved",
  );
});
