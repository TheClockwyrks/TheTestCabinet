// Meltdown — trip/tripped-takes-no-flow: a tripped tower takes part in no flow.
//
// `specs/heat.md` puts a tripped emitter outside the frame's resolution
// altogether: it "takes part in no term of the frame's resolution, so nothing it
// touches heats it, cools it, or conducts with it", and it "bleeds its heat to
// `0` at `TRIP_HEAT / TRIP_TIME` ... whatever its faces and whatever stands
// beside it". `trip/tripped-cools-linearly` reads that rate on a tower standing
// alone; this item reads it with the three strongest flows in the game pressed
// against it at once.
//
// THE THREE NEIGHBOURS ARE CHOSEN SO EVERY WRONG BUILD READS A DIFFERENT NUMBER,
// and every one of them is far outside the tolerance. Against a 2x2 Arc tripped
// at `100` each shares a full face of two edge-tiles (`specs/heat.md`):
//
//   - a hot Arc on its NORTH face, posed at `95` with its guns held. A build
//     that conducts reads `COND_K * 2 * (95 - 100)`, which is `-35` per second
//     on top of the bleed at the opening frame, and the sign FLIPS as the
//     tripped tower falls below its neighbour — by the second sample the same
//     build is gaining `3.5 * 2 * (H_N - H_T)` instead of losing it, so a
//     conducting build cannot come out near `20` at either end.
//   - a level-III Forge on its EAST face, whose setpoint is `96`
//     (`specs/towers.md`). At `100` it drives `FORGE_K * 2 * max(0, 96 - 100)`,
//     which is nothing at all — and then everything, once the bleed has taken
//     the tower under `96`: `0.9 * 2 * (96 - H_T)` reaches `64.8` per second by
//     the time the tower is at `60`. So a build that lets a Forge reach a
//     tripped tower does not merely bleed slowly, it climbs.
//   - a level-III Sink on its SOUTH face, whose output is `36`. A build that
//     lets it drain reads `36 * 2 * (H_T / 100)`, which is `72` per second at
//     the trip: nearly four times the bleed, and the tower would be on the floor
//     within the window.
//
// ITS WEST FACE IS LEFT ON OPEN AIR, deliberately, so the reading also excludes
// a build that keeps a tripped tower's air term: two plain edge-tiles at
// `BASE_K` would take a further `1.1 * 2 * (H_T / 100)` per second, which is `3`
// heat points across this window — six times the tolerance.
//
// THE HOT NEIGHBOUR'S GUNS ARE HELD (`poseIdleTower`) and its thermal model is
// left running, because what is being decided is that the TRIPPED tower ignores
// it — not that a gate can silence it. The neighbour cools on its own three open
// faces while the window runs, which only widens the gradient the tripped tower
// must go on ignoring.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { TRIP_HEAT, TRIP_TIME, type Tile } from "../constants";
import { BOXED_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseIdleTower,
  poseTower,
  poseTrippedTower,
  startRun,
  type Harness,
} from "../harness";
import { readTower } from "./bench";

/** The emitter posed tripped, at the heat and cooldown a trip leaves it with. */
const TOWER = "arc";
const POSED_HEAT = TRIP_HEAT;
const POSED_TIMER = TRIP_TIME;

/** The bleed `specs/heat.md` states: `TRIP_HEAT / TRIP_TIME`, so 20 per second. */
const BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/**
 * Where the subject stands: the anchor with room for a ring of neighbours.
 *
 * Twelve tiles clear of every other named anchor on all four sides, and clear of
 * both vent-to-exhaust corridors, so nothing posed here abuts anything it was
 * not meant to or lengthens a route (`validation/none/fixtures.ts`).
 */
const SITE: Tile = BOXED_SITE;

/** The 2x2 footprint every tower in this scenario has (`specs/towers.md`). */
const SIZE = 2;

/** The hot neighbour's heat: high enough to conduct hard, below the trip. */
const NEIGHBOUR_HEAT = 95;

/** The two movers at their top level, where their flows are strongest. */
const MOVER_LEVEL = 3;

/**
 * The window the bleed is measured over, in seconds of game time.
 *
 * Two seconds takes the tower from `100` to `60` on the specified rate, which
 * leaves it three seconds of cooldown in hand and well clear of the clamp at
 * `0`. It is also long enough for the Forge's flow to have turned right around —
 * see the head — so a build that takes it cannot pass by having it cancel
 * against something.
 */
const WINDOW = 2;

/** Where the line puts the tower at the end of that window: 60. */
const EXPECTED_HEAT = POSED_HEAT - BLEED_RATE * WINDOW;

/**
 * How close the measured rate must come to `20`, as decimal places.
 *
 * Two places is `0.005` of a heat point per second, and the nearest wrong answer
 * is more than a whole heat point a second away — the air term alone, the
 * smallest of the four flows pressed against this tower, runs from `2.2` per
 * second at the top of the window to `1.3` at the bottom. Both readings are
 * taken at frame boundaries an exact two seconds of game time apart, so a
 * conformant build lands on the constant `specs/heat.md` states to float slack.
 */
const RATE_DIGITS = 2;

/**
 * How close the closing heat must come to `60`, as decimal places.
 *
 * Zero places is `0.5` of a heat point, three frames of the bleed — the same
 * room `trip/tripped-cools-linearly` gives, and for the same reason: a build may
 * begin bleeding on the frame after the pose.
 */
const HEAT_DIGITS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A tripped tower takes part in no flow", async () => {
  await startRun(h);
  const id = await poseTrippedTower(h, TOWER, SITE.col, SITE.row, {
    heat: POSED_HEAT,
    timer: POSED_TIMER,
  });

  // North: a hot emitter, flush against the whole face.
  await poseIdleTower(h, TOWER, SITE.col, SITE.row - SIZE, {
    heat: NEIGHBOUR_HEAT,
  });
  // East: a level-III Forge. South: a level-III Sink. West: open air.
  const forge = await poseTower(h, "forge", SITE.col + SIZE, SITE.row);
  await h.debug.setTowerLevel(forge, MOVER_LEVEL);
  const sink = await poseTower(h, "sink", SITE.col, SITE.row + SIZE);
  await h.debug.setTowerLevel(sink, MOVER_LEVEL);

  const opened = await readTower(
    h,
    id,
    `the tripped ${TOWER} among its neighbours`,
  );
  await h.advance(framesFor(WINDOW));
  await captureStill(h, "inert");
  const closed = await readTower(
    h,
    id,
    `the tripped ${TOWER} ${WINDOW}s among its neighbours`,
  );

  assertEqual(
    closed.tripped,
    true,
    `the ${TOWER} to still be serving its ${POSED_TIMER}s cooldown after ` +
      `${WINDOW}s, so the reading is of a tripped tower`,
  );
  assertCloseTo(
    (opened.heat - closed.heat) / WINDOW,
    BLEED_RATE,
    RATE_DIGITS,
    `the heat per second a tripped ${TOWER} sheds with a ${NEIGHBOUR_HEAT} ` +
      `emitter, a level-${MOVER_LEVEL} Forge and a level-${MOVER_LEVEL} Sink ` +
      `on three of its faces and open air on the fourth`,
  );
  assertCloseTo(
    closed.heat,
    EXPECTED_HEAT,
    HEAT_DIGITS,
    `the heat a tripped ${TOWER} carries ${WINDOW}s in, on the line from ` +
      `${POSED_HEAT} at ${BLEED_RATE} per second`,
  );
});
