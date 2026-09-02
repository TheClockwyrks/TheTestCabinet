// Meltdown — trip/posed-at-100-and-cooling-does-not-trip: sitting at 100 is not
// itself a trip.
//
// specs/heat.md, The trip: "The trip is a crossing, not a value. An emitter trips
// on the frame in which its newly written heat reaches `100` having opened that
// frame below `100`. An emitter whose heat is already `100` when a frame opens
// and falls during that frame does not trip."
//
// THE THREE MODELS THIS TELLS APART. A build that writes the crossing the
// specification states, one that writes `tripped = heat >= 100` over the heat the
// frame OPENED with, and one that writes it over the heat the frame CLOSED with
// all agree on a tower that climbs into the trip, which is what `trips-at-100`
// drives. They part company only on a tower handed `100` outright, and only this
// item can reach that tower, because only the debug surface can put one there:
// `setTowerHeat` "does not trip the tower: the trip belongs to the heat model,
// and this is a precondition" (specs/instrumentation.md).
//
// SO THE ITEM POSES TWO TOWERS AT 100, WHICH IS ONE REQUIREMENT READ WHERE EACH
// WRONG MODEL SHOWS.
//
//   THE COOLING TOWER stands alone on open floor, so specs/heat.md's air term
//   takes `(3.6 * 4 + 1.1 * 4) * (H / 100)` a second off it (specs/towers.md
//   gives the Arc four radiator and four plain edge-tiles) and the frame after
//   the pose resolves it BELOW `100`. A build reading the value the frame opened
//   with trips it; the specification does not.
//
//   THE HELD TOWER has a tower against each of its four faces, so no edge-tile
//   sheds to air at all, and every one of those neighbours is a level-I Forge —
//   a mover, which specs/heat.md says neither conducts nor carries heat, whose
//   own flow is `FORGE_K * sharedEdges * max(0, setpoint - H)` with a setpoint of
//   `72` (specs/towers.md), which at heat `100` is exactly nothing. Its guns are
//   held too, so no shot adds anything. Every term of the frame is zero and the
//   tower closes the frame at `100` having opened it at `100`. A build reading
//   the value the frame CLOSED with trips it; the specification does not, because
//   nothing crossed anything.
//
// A BUILD THAT SHEDS ON A BLOCKED FACE cannot be failed by the held tower for
// that: it would merely cool, which is the first tower's case, and the first
// tower's verdict is the same. So the second pose can only ever catch the model
// it is for.
//
// THE COOLDOWN IS READ BESIDE THE FLAG. A build that trips on the value and
// un-trips on the next frame would slip past a reading of `tripped` alone; a trip
// starts a `TRIP_TIME` cooldown, so `tripTimer` staying at `0` says no trip
// happened at any point in the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  boxIn,
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { freeSite } from "./bench";

/** The emitter posed at the top of the scale, and the rotation it stands at. */
const TOWER = "arc";
const ROTATION = 0;

/** What the held tower's four faces are blocked with: a mover with no flow here. */
const BLANKET = "forge";

/** How long each tower is watched after the pose, in seconds of game time. */
const WATCH_SECONDS = 1.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Sitting at 100 is not itself a trip", async () => {
  startRun(h);

  const cooling = poseIdleTower(
    h,
    TOWER,
    freeSite(0).col,
    freeSite(0).row,
    ROTATION,
    TRIP_HEAT,
  );

  const held = poseIdleTower(
    h,
    TOWER,
    freeSite(2).col,
    freeSite(2).row,
    ROTATION,
    TRIP_HEAT,
  );
  boxIn(h, held, { N: BLANKET, E: BLANKET, S: BLANKET, W: BLANKET });

  const posed: [string, number][] = [
    ["cooling on open floor", cooling],
    ["held at 100 with every face blocked", held],
  ];

  for (let frame = 0; frame < ticksFor(WATCH_SECONDS); frame += 1) {
    await h.advance(1);
    if (frame === 0) captureStill(h, "cooling");
    for (const [where, id] of posed) {
      const tower = towerOf(h.snapshot(), id);
      assertEqual(
        tower.tripped,
        false,
        `whether a ${TOWER} handed heat ${TRIP_HEAT} outright, ${where}, ` +
          `reports tripped ${seconds(frame + 1).toFixed(3)}s later, having ` +
          `resolved to heat ${tower.heat.toFixed(3)}`,
      );
      assertEqual(
        tower.tripTimer,
        0,
        `the cooldown a ${TOWER} handed heat ${TRIP_HEAT} outright, ` +
          `${where}, carries ${seconds(frame + 1).toFixed(3)}s later`,
      );
    }
  }
});
