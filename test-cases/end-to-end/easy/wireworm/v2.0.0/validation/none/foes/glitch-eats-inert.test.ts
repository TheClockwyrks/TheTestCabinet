// foes/glitch-eats-inert — a glitch removes the inert node it is standing on.
//
// `specs/foes.md`, on what the glitch does: "A glitch removes the node on the
// tile its center occupies, whatever that node's charge." The node here is posed
// INERT, at charge `0`, which is the charge a build is likeliest to treat as
// nothing to eat.
//
// WHAT SEPARATES THE WRONG MODELS. What is read is the FIRST change the glitch
// made to the tile. Removal leaves the tile EMPTY, and `specs/nodes.md` keeps
// empty and inert apart — a bolt into an inert node leaves "its tile ... empty",
// a different state from a node standing at charge `0` — so an empty tile reads
// as `null` where an inert one reads as `0`. A build that de-energizes instead
// of removing changes nothing at all and is named by the `0` it left; a build
// that bumped the charge is named by the `1`.
//
// THE SCENARIO CARRIES NO MOTION. `specs/foes.md` fixes a foe's effect as the
// occupancy of the tile its center is on, so a glitch posed with
// `setFoeTravel(id, false)` acts on exactly the tile it was placed on. Its mind
// is left on, because the eating IS the mind (`specs/instrumentation.md`) and
// the eating is what this point is about. The board `startPlaying` leaves is
// empty, so the one node on it is the one posed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { untilTileChanges } from "./watching";

/** The tile the glitch stands on: clear of the entry row and of the band. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge the node is posed at: inert, the bottom of `specs/nodes.md`'s ramp. */
const INERT = 0;

/**
 * How long the glitch is given to act at all, in seconds.
 *
 * `specs/foes.md` fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure derived from one: a quarter second is every chance a build needs
 * to act on the single tile it is standing on. What is graded is the first
 * change inside it, so this decides nothing but how long a build that never acts
 * is waited for.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes the inert node the glitch is standing on", async () => {
  await startPlaying(h);
  await h.debug.setNode(TILE_C, TILE_R, INERT);
  await poseFoe(h, "glitch", TILE_C, TILE_R, { travel: false });

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    framesFor(ACT_SECONDS),
  );

  await captureStill(h, "eaten");
  assertNull(
    change.now,
    `the glitch's first act on the charge-${INERT} node on (${TILE_C}, ` +
      `${TILE_R}) leaves that tile empty`,
  );
});
