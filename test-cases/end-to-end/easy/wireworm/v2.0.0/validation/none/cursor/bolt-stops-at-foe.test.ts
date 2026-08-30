// cursor/bolt-stops-at-foe — a bolt resolves against the FIRST foe in its column
// and climbs no further.
//
// `specs/cursor.md`: "it resolves against the first thing its center reaches,
// which is the lowest of the following that lies above it in its column ... A
// foe [is reached when] the bolt's center is inside the foe's box, `FOE_HALF`
// (`12`) units from the foe's center on each axis ... A bolt resolves against
// exactly one thing and is removed from flight in the same update."
// `specs/foes.md` gives the glitch one bolt.
//
// ONE GLITCH, ONE NODE ABOVE IT, AND ONE BOLT. `startPlaying` empties the field
// and the rosters, and the scenario puts back exactly what the requirement
// names: the foe the bolt reaches first, and a node further up the same column
// that a surviving bolt would strike.
//
// THE GLITCH IS POSED WITH BOTH FACULTIES OFF. `setFoeTravel(false)` holds it on
// the tile it was posed on, so the bolt meets it where this check put it rather
// than wherever a dart and a descent had carried it — the glitch's motion is
// `foes.glitch-descends`'s and `foes.glitch-darts`'s requirement, and a scenario
// that let it run would be reading those as well as this one.
// `setFoeMind(false)` stops it eating the field, which would otherwise take the
// node above it off the board and destroy the reading before the bolt ever flew.
//
// THE NODE ABOVE IS POSED AT CHARGE 2, SO EVERY WRONG MODEL READS AS A DIFFERENT
// NUMBER. Untouched it reads 2, which is the pass; a bolt that survived the foe
// and struck it knocks it to 1 (`specs/nodes.md`); a build that clears or
// detonates a charged node leaves the tile empty. At charge 0 a struck node and
// a passed-through node would both leave an empty tile and the reading would
// name no model at all.
//
// WHAT THIS DOES NOT DECIDE. That one bolt is what a glitch takes is
// `foes.glitch-one-bolt`'s requirement and the bounty is
// `scoring.glitch-bounty`'s; neither score nor bolt count is read here. This
// point reads three things: the foe roster, the node above, and the bolt.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF } from "../constants";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  boltById,
  captureStill,
  chargeAt,
  createHarness,
  framesFor,
  poseBolt,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The column the glitch, the node and the bolt all share. */
const COLUMN = 12;

/** The tile the glitch is parked on, between the bolt and the node. */
const FOE_R = 12;

/** The node further up the same column, which the bolt must never reach. */
const NODE_R = 5;

/**
 * The charge the node holds, and the value this check reads back.
 *
 * `2` is the distinguishing pose: see the header. Whole numbers throughout, so
 * the reading needs no tolerance.
 */
const NODE_CHARGE = 2;

/** The row the bolt is posed on: the floor, whose centre y is 704. */
const START_ROW = 19;

/** Foes left on the board once the bolt has taken the one glitch. */
const FOES_AFTER = 0;

/**
 * The drive, in frames of the harness's 100 Hz clock: 0.6 s.
 *
 * From row 19's centre (704) the glitch's box begins at y = 492 — `FOE_HALF`
 * below its centre at 480 — which a bolt at `BOLT_SPEED` covers in 0.236 s, and
 * the node's tile begins at 272, which a surviving bolt would reach at 0.48 s.
 * The drive runs past both, so "the node is untouched" is a verdict about a bolt
 * that had the time to get there.
 */
const DRIVE_FRAMES = framesFor(0.6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("destroys the glitch, leaves the node above it, and takes the bolt out of flight", async () => {
  await startPlaying(h);
  await h.debug.setNode(COLUMN, NODE_R, NODE_CHARGE);
  await poseFoe(h, "glitch", COLUMN, FOE_R, { mind: false, travel: false });
  const boltId = await poseBolt(h, COLUMN, START_ROW);

  await h.advance(DRIVE_FRAMES);
  await captureStill(h, "consumed");

  const board = await h.snapshot();
  assertLength(
    board.foes,
    FOES_AFTER,
    "foes on the board after the bolt reached the glitch parked on " +
      `(${COLUMN}, ${FOE_R}) — specs/foes.md gives the glitch one bolt, and ` +
      "specs/cursor.md reaches it when the bolt's centre is within FOE_HALF " +
      `(${FOE_HALF}) of its own on each axis`,
  );
  assertEqual(
    chargeAt(board, COLUMN, NODE_R),
    NODE_CHARGE,
    `the charge on the node at (${COLUMN}, ${NODE_R}), further up the same ` +
      "column — specs/cursor.md: the bolt resolved against the glitch and was " +
      `removed from flight in that update. A reading of ${NODE_CHARGE - 1} is ` +
      "a bolt that climbed on and struck it; null is one that cleared or " +
      "detonated it",
  );
  assertUndefined(
    boltById(board, boltId),
    `the bolt (id ${boltId}) after it resolved against the glitch — ` +
      "specs/cursor.md removes it from flight in the same update; at " +
      `BOLT_SPEED (${BOLT_SPEED}) a bolt still in flight ${DRIVE_FRAMES} ` +
      "frames on has left the board through the top",
  );
});
