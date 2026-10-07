// Meltdown — combat/flak-hits-air: the Flak fires on a flyer.
//
// specs/combat.md: the Flak "targets flying units alone". specs/surge.md gives the
// Drift `Flies: yes`, so the one kind of unit the Flak may fire on is in range here,
// and it must fire.
//
// THE POSITIVE HALF OF THE FLAK'S CLAUSE, and it needs a point of its own because
// the negative half alone is passed by a Flak that fires at nothing whatsoever. A
// build that read `airOnly` as "cannot target" rather than "targets only air"
// removes nothing here and everything from `combat/flak-ignores-ground`, so the
// pair names which way round a build got it.
//
// THE MARK IS THREE TILES OUT, inside the Flak's `8.0` several times over and off
// its footprint, with motion off so its flight line cannot carry it away while an
// interval is waited out. What the shot removes is `combat/damage-per-shot`'s
// figure; what this point claims is that hp fell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readGun,
  readHp,
  ticksForShots,
  unitOf,
} from "./duel";

/** The emitter read, the heat it is pinned at, and the flyer it fires on. */
const TOWER = "flak";
const HEAT = 0;
const MARK = "drift";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Flak hits flyers", async () => {
  const gunId = poseGun(h, TOWER, HEAT);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksForShots(1, fireRateOf(TOWER)));
  captureStill(h, "air");
  const hit = unitOf(h.snapshot(), mark);

  assertEqual(
    readGun(h, gunId).targeting,
    mark,
    `the unit a ${TOWER} targeted with a flying ${MARK} the only unit in range`,
  );
  assertGreaterThan(
    opened - hit.hp,
    0,
    `hp a ${TOWER} removed from a flying ${MARK} in range, after one ` +
      `${(1 / fireRateOf(TOWER)).toFixed(4)}s interval`,
  );
});
