// bands/mismatch-spares — an opposite-band shot never destroys.
//
// specs/bands.md, "Your shots: match to destroy", second row of its table: "The
// bullet's effective band is the opposite | The drone is not destroyed, and the
// bullet is consumed". This point reads the DRONE half of that row, and only the
// half that holds under either mode: "not destroyed". What else a mismatched shot
// does to the drone is specs/mode.md's — nothing at all under Sortie, a charge
// under Overload — so nothing here reads the drone's phase, its slot, its band or
// its charge, and this file is graded identically whichever mode the build ships.
//
// THE WORLD IS ONE SHARD AND ONE SHOT, posed exactly as `bands.match-destroys`
// poses it, and the single variable between the two points is the band the bullet
// carries. That is what makes a failure here name the match rule's direction: a
// build that destroys on any contact fails this and passes that, and a build that
// destroys on nothing fails that and passes this.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless — a drone nothing reached
// is trivially "not destroyed". So the check first reads that the bullet resolved
// at the drone or climbed past it, which is `PLAYER_BULLET_SPEED` doing what
// specs/ship.md fixes, and only then reads the roster. It is not a second
// requirement of this point: it is the shot this point is about being fired at
// all, and a build whose bullets never travel fails it here as it fails
// `bands.match-destroys`.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED, SHARD_HALF } from "../../src/constants";
import { assertNotNull, assertTrue } from "../assert";
import {
  LANE_CENTER,
  SHOT_GAP,
  captureStill,
  createHarness,
  fireAt,
  findBullet,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target stands: the posture `bands.match-destroys` uses. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a cyan Shard standing under a magenta shot", async () => {
  startPosed(h);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: DRONE_BAND,
  });

  const bulletId = await fireAt(h, TARGET_X, TARGET_Y, SHOT_BAND);
  captureStill(h, "spared");

  const shot = findBullet(h.snapshot(), bulletId);
  assertTrue(
    shot === null || shot.y < TARGET_Y,
    `the ${SHOT_BAND} shot reached the Shard: fired ${SHOT_GAP} units below ` +
      `y ${TARGET_Y} and flown the frames PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} needs to cover them, it has either resolved on ` +
      "contact or climbed past the drone's centre (specs/ship.md)",
  );

  assertNotNull(
    findDrone(h.snapshot(), droneId),
    `the ${DRONE_BAND} Shard is still on the field after a ${SHOT_BAND} ` +
      `bullet reached its ${SHARD_HALF}-unit contact circle — specs/bands.md: ` +
      "a bullet whose effective band is the opposite of the drone's does not " +
      "destroy it",
  );
});
