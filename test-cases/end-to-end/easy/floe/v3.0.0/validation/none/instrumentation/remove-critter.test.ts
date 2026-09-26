// Floe — instrumentation/remove-critter: `removeCritter()` takes the critter off
// the strait, leaves everything else standing, and puts it genuinely out of
// reach.
//
// `specs/instrumentation.md` states both halves: "Takes the critter off the
// strait. `present` becomes `false` and nothing on the strait can reach it." The
// snapshot shape says the same of what is left behind — "While the critter is out
// of play, `present` is `false` and its tile, center, and facing report the last
// values it held" — and `specs/progression.md` says it of a death: "Through the
// whole hold the critter is out of play, so nothing on the strait can reach it
// and no second life is lost."
//
// SO THE FLAG IS ONLY HALF THE POINT. A build that reports `present` `false` and
// still runs its hazards against the critter's last centre costs a life the
// moment traffic arrives — under a heading about being crushed, on a scenario
// that never asked for a critter. So after the rosters are held to being
// untouched, a vehicle is released along the critter's own row and driven clear
// across the tile it stood on, and the run is held to losing nothing over the
// three seconds that takes.
//
// THE VEHICLE REALLY CROSSES, AND THE CHECK READS THAT IT DID. Its left edge is
// read at the end and held to being past the centre the critter stood on, so a
// build whose lane never moved cannot pass this by keeping its traffic away.
//
// NOTHING ELSE ON THE STRAIT IS IN THAT LANE. The two bears stand on other rows,
// so the traffic rule `specs/hunter.md` fixes — a vehicle in a moving lane
// covering either tile a bear occupies takes that bear off — never fires, and the
// bears the second reading finds are the bears the first one did. Every other
// lane is held at a speed of `0`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { START_LIVES, TILE, tileCX, tileLeft } from "../constants";
import {
  captureStill,
  createHarness,
  lastVehicle,
  poseBear,
  poseLane,
  requireItem,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the critter stands, on the ice band, before it is taken off. */
const CRITTER_COL = 24;
const CRITTER_ROW = 14;

/** The two ice lanes carrying a held vehicle, both clear of the critter's row. */
const VEHICLES: readonly (readonly [number, "plow" | "car", number])[] = [
  [12, "car", 20],
  [17, "plow", 30],
];

/** The two water lanes carrying a held floe. */
const FLOES: readonly (readonly [number, "raft4", number])[] = [
  [3, "raft4", 10],
  [6, "raft4", 24],
];

/** The two tiles the bears settle on: neither is the lane released below. */
const BEAR_TILES: readonly (readonly [number, number])[] = [
  [5, 15],
  [30, 12],
];

/** The bays posed filled, and the bay the posed bonus catch sits in. */
const FILLED_BAYS: readonly number[] = [0, 3];
const FISH_BAY = 1;

/** The vehicle released along the critter's own row, and where it starts. */
const RELEASE_KIND = "plow" as const;
const RELEASE_COL = 16;
const RELEASE_X = tileLeft(RELEASE_COL);

/**
 * The speed the released lane is posed at, in tiles per second, and how long it
 * is driven for.
 *
 * `4` tiles a second is `128` units a second (`specs/ice.md`), so over the three
 * seconds this item names the vehicle covers `384` units — from eight tiles left
 * of the critter's centre to four tiles right of it, which carries its whole
 * three-tile body clear across that centre. The figure is this check's own pose
 * rather than a lane's table speed, so nothing here rests on `specs/ice.md`'s
 * level-1 speeds.
 */
const RELEASE_SPEED = 4;
const RELEASE_DIR = 1;
const RELEASE_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the critter off the strait and leaves nothing on it able to reach it", async () => {
  await startCrossing(h);

  for (const [row, kind, col] of VEHICLES) await poseLane(h, row, kind, [col]);
  for (const [row, kind, col] of FLOES) await poseLane(h, row, kind, [col]);
  for (const [col, row] of BEAR_TILES) {
    await poseBear(h, col, row, {
      sense: false,
      routing: false,
      travel: false,
    });
  }
  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);
  await h.debug.setFishBay(FISH_BAY);

  const before = await h.snapshot();
  assertEqual(
    before.critter.present,
    true,
    "the critter standing on the strait before it is taken off",
  );
  assertLength(
    before.bears,
    BEAR_TILES.length,
    "the bears this scenario posed",
  );

  await h.debug.removeCritter();
  const after = await h.snapshot();

  assertEqual(
    after.critter.present,
    false,
    "snapshot().critter.present after removeCritter()",
  );
  assertDeepEqual(
    after.vehicles,
    before.vehicles,
    "the vehicles on the ice band, against the same roster read at the " +
      "instant before removeCritter() was called",
  );
  assertDeepEqual(
    after.floes,
    before.floes,
    "the floes on the water band, against the same roster read at the " +
      "instant before removeCritter() was called",
  );
  assertDeepEqual(
    after.bears,
    before.bears,
    "the bears on the strait, against the same roster read at the instant " +
      "before removeCritter() was called",
  );
  assertDeepEqual(
    after.bays,
    before.bays,
    "the five bays, against the same reading taken at the instant before " +
      "removeCritter() was called",
  );
  assertEqual(
    after.fishBay,
    before.fishBay,
    "the bay holding the bonus catch, against the same reading taken at the " +
      "instant before removeCritter() was called",
  );

  // Now the traffic, released along the row the critter stood on.
  await h.debug.addVehicle(CRITTER_ROW, RELEASE_KIND, RELEASE_X);
  const released = lastVehicle(await h.snapshot());
  const sweeper = released?.id ?? -1;
  await h.debug.setLaneSpeed(CRITTER_ROW, RELEASE_SPEED);
  await h.debug.setLaneDirection(CRITTER_ROW, RELEASE_DIR);

  await h.advance(ticksFor(RELEASE_SECONDS));
  const swept = await h.snapshot();
  // Before the assertions, so a build that lost a life still leaves the picture
  // of the strait the vehicle crossed.
  await captureStill(h, "cleared");

  assertGreaterThan(
    requireItem(swept, sweeper, "the released lane").x,
    tileCX(CRITTER_COL),
    `the left edge the released vehicle reached, against the stage x of the ` +
      `centre of tile (${CRITTER_COL}, ${CRITTER_ROW}) — a vehicle whose left ` +
      `edge is past that centre has carried its whole ${TILE * 3}-unit body ` +
      `across it, and a lane that never moved leaves this point deciding ` +
      `nothing`,
  );
  assertEqual(
    swept.lives,
    START_LIVES,
    `the lives left after ${RELEASE_SECONDS} s of a vehicle crossing the tile ` +
      `the critter stood on before removeCritter() — nothing on the strait can ` +
      `reach a critter that is out of play (specs/instrumentation.md)`,
  );
  assertEqual(
    swept.phase,
    "crossing",
    `the phase after that same span — a life lost would have taken it to ` +
      `"dying" (specs/progression.md)`,
  );
});
