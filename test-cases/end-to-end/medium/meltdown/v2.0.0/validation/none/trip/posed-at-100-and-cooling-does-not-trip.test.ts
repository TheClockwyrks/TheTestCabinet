// Meltdown — trip/posed-at-100-and-cooling-does-not-trip: sitting at 100 is not
// itself a trip.
//
// `specs/heat.md` opens the rule with the distinction and then states the case
// outright: "The trip is a crossing, not a value. An emitter trips on the frame
// in which its newly written heat reaches `100` having opened that frame below
// `100`. An emitter whose heat is already `100` when a frame opens and falls
// during that frame does not trip."
//
// SO THE SCENARIO IS EXACTLY THAT FRAME. An emitter is posed at `100` with its
// guns held and its thermal model running, and one frame is resolved. Nothing
// adds heat, and air cooling is proportional to `H / 100` and therefore at its
// maximum here, so the frame opens at `100` and writes something below it — a
// fall, not a crossing. A build that reads the trip as a value takes the tower
// offline on this frame; a build that reads it as a crossing leaves it online.
//
// THE GUNS ARE HELD, and that is what makes the frame unambiguous. With firing
// enabled a shot landing on this very frame would push the write back up to the
// clamp at `100`, and a tower that opened at `100` and was written at `100`
// still has not crossed — but the reading would then be about the clamp rather
// than about the opening value, and a build could pass it for the wrong reason.
// `setTowerFiring(id, false)` holds targeting, the shot and its `heatPerShot`
// and leaves the thermal model — the trip included — running exactly as an idle
// tower's does (`specs/instrumentation.md`).
//
// ONE FRAME, because the question is about the frame that opens at `100` and no
// other. A second frame would open below `100`, which is an ordinary frame this
// item says nothing about.
//
// THE FALL IS ASSERTED LAST, as a precondition and in its own words: a build
// whose lone tower does not shed at all has not reached the situation this item
// describes, and that failure belongs to `heat/air-cooling-rate` rather than
// here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
} from "../harness";
import { TRIP_SITE, readTower } from "./bench";

/** The emitter posed at the trip, and the level `addTower` starts it at. */
const TOWER = "arc";

/**
 * The heat the frame OPENS at: the trip itself.
 *
 * `setTowerHeat` takes a number in `[0, 100]` and does not trip the tower — the
 * trip belongs to the heat model, and this is a precondition
 * (`specs/instrumentation.md`). So the tower opens the next frame sitting at the
 * value, which is the whole scenario.
 */
const POSED_HEAT = TRIP_HEAT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Sitting at 100 is not itself a trip", async () => {
  await startRun(h);
  const id = await poseIdleTower(h, TOWER, TRIP_SITE.col, TRIP_SITE.row, {
    heat: POSED_HEAT,
  });

  await h.advance(1);
  await captureStill(h, "cooling");
  const gun = await readTower(h, id, `the ${TOWER} posed at ${POSED_HEAT}`);

  assertEqual(
    gun.tripped,
    false,
    `a ${TOWER} that OPENED a frame at ${POSED_HEAT} and fell during it to ` +
      `stay online: the trip is the crossing, not the value`,
  );
  assertEqual(
    gun.tripTimer,
    0,
    `no cooldown on a ${TOWER} that never crossed into ${TRIP_HEAT} from below`,
  );
  assertLessThan(
    gun.heat,
    POSED_HEAT,
    `precondition: a lone ${TOWER} at ${POSED_HEAT} sheds to air on all four ` +
      `faces, so the frame it opened at ${POSED_HEAT} resolves it below that ` +
      `(specs/heat.md)`,
  );
});
