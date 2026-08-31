// bullets/max-four — at most MAX_BULLETS of the ship's rounds are up at once.
//
// specs/weapons.md, "The gun", the On-screen limit row: "`MAX_BULLETS` (`4`) of
// the ship's bullets in flight at once. While four are live, firing adds none
// until one leaves."
//
// THE SCENARIO POSES THREE AND FIRES THE FOURTH, which is what makes the item
// about the number four rather than about a cap in general. Three rounds are
// placed through `addBullet` and the gun then takes the fourth itself with the
// gate open, so a build whose cap is three refuses that shot and fails here, and
// a build whose cap is five or is absent adds a fifth over the held second that
// follows and fails there. Only a cap of exactly four passes both readings.
//
// THE HELD KEY IS WHAT ASKS FOR THE FIFTH. specs/controls.md reads firing as a
// press AND as a hold, and specs/weapons.md gates a held key to one shot every
// `FIRE_INTERVAL_TICKS`, so holding through three whole gates is three separate
// requests the cap has to refuse. The count is taken after each gate rather than
// only at the end, so a build that adds a fifth and lets it expire before the
// reading is still caught.
//
// EVERY ROUND IN THE SCENARIO OUTLIVES IT. The four are up for at most seventy
// ticks, and specs/weapons.md gives each a `BULLET_LIFE` of `1.5` seconds, which
// is a hundred and eighty — so no slot falls free on its own and the refusals
// this reads are refusals by the cap.
//
// AND NONE OF THEM MEETS ANYTHING. specs/collision.md removes a round that lands
// or that the core absorbs. `startPlaying` leaves the field empty of rocks and of
// the saucer, and the lane is the bottom of the field with the ship on it firing
// along it, so no round in this scenario comes within three hundred units of the
// core over the span it is measured across.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  poseBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { FIRE_ACTION, fireOnce } from "./gun";

/** The lane every round in this scenario flies along, and where the ship sits on it. */
const LANE_Y = 690;
const SHIP_X = 200;
/** The facing: along the lane, away from the star. */
const FACING = 0;

/** Where the three placed rounds start, spaced along the lane ahead of the ship. */
const POSED_X = [600, 800, 1000];

/** How many whole gates the fire key is held through after the field is full. */
const GATES = 3;
/** The ticks each of those gates is measured over: one gate, and a tick to spare. */
const GATE_TICKS = FIRE_INTERVAL_TICKS + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no round beyond MAX_BULLETS while four are in flight", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, LANE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);
  for (const x of POSED_X) poseBullet(h, x, LANE_Y, MUZZLE_SPEED, 0);
  h.debug.setFireCooldown(0);

  // The gun takes the fourth itself, so the field is full by the game's own rule
  // rather than by the pose alone.
  await fireOnce(h);
  assertLength(
    h.snapshot().bullets,
    MAX_BULLETS,
    `MAX_BULLETS (${MAX_BULLETS}) rounds in flight once the gun has fired the ` +
      `one this scenario left room for (specs/weapons.md)`,
  );

  const counts: number[] = [];
  h.hold(keyFor(FIRE_ACTION));
  try {
    for (let gate = 0; gate < GATES; gate += 1) {
      await h.advance(GATE_TICKS);
      counts.push(h.snapshot().bullets.length);
    }
  } finally {
    h.release(keyFor(FIRE_ACTION));
  }
  // Four rounds up and the gun adding no more.
  captureStill(h, "capped");

  for (const [gate, count] of counts.entries()) {
    assertEqual(
      count,
      MAX_BULLETS,
      `still exactly MAX_BULLETS (${MAX_BULLETS}) rounds in flight after ` +
        `${gate + 1} of ${GATES} held gates of ${FIRE_INTERVAL_TICKS} ticks, ` +
        `none of which has expired (specs/weapons.md: while four are live, ` +
        `firing adds none until one leaves)`,
    );
  }
});
