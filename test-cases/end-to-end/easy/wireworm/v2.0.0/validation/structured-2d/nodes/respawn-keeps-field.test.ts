// Wireworm — nodes/respawn-keeps-field: the node field stands through a respawn.
//
// specs/nodes.md, "The field persists": "Losing a life does not reset it. Every
// node and its charge survive the respawn unchanged, while the worms and the foes
// do not." specs/progression.md, "Losing a life", says the same from the run's
// side: on the contact, "Every worm, every foe, and every bolt in flight is
// removed from the board. The node field stands exactly as it was."
//
// The contact is real, so the cursor's contact gate is turned back on — this is
// one of the items whose requirement that gate IS. Everything else stays as
// `startPlaying` left it.
//
// The thing that makes the contact is a glitch posed on the cursor's own centre
// with BOTH FACULTIES OFF. It is a body and nothing else: a glitch with its mind
// on eats the node on its tile (specs/foes.md), which is a different route into
// the field and would decide `foes.glitch-eats-node`'s requirement here by
// accident, and one with its travel on would drift off the cursor before the
// frame that reads it.
//
// THE LOST LIFE IS THIS POINT'S PRECONDITION, and it is asserted as one: a
// validator that could not pose the world it needs fails the item it decides
// rather than leaving it undecided. That the count falls is
// `progression.life-lost-decrements`'s requirement; what is decided here is what
// the field looks like on the other side of the respawn.
//
// The run is given a full complement of lives, because the rule is about losing
// one WITH LIVES TO SPARE: a contact that takes lives to `0` ends the run instead
// (specs/progression.md), which is `progression.game-over-at-zero-lives`.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_TIME, START_LIVES } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  chargeAt,
  createHarness,
  poseFoePoint,
  startPlaying,
  type Harness,
} from "../harness";

/** The field posed, one node at each of the four charges, spread across the board. */
const FIELD = [
  { c: 3, r: 4, charge: 0 },
  { c: 12, r: 7, charge: 1 },
  { c: 25, r: 11, charge: 2 },
  { c: 34, r: 15, charge: 3 },
];

/** Frames run for the contact to be tested: the cursor's test runs every update. */
const CONTACT_FRAMES = 1;

/**
 * Seconds run after the contact, so the respawn pause gives way to live play.
 *
 * The respawn phase runs for `RESPAWN_TIME` (`1.4` s, specs/progression.md) and
 * the phase becomes `active` when its timer runs out; half again as long is past
 * that moment whichever frame boundary the timer lands on.
 */
const THROUGH_RESPAWN = RESPAWN_TIME * 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every node and its charge exactly as it was through a respawn", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  for (const node of FIELD) h.debug.setNode(node.c, node.r, node.charge);

  h.debug.setCursorContact(true);
  const glitch = poseFoePoint(h, "glitch", BAND_CX, BAND_CY);
  h.debug.setFoeMind(glitch, false);
  h.debug.setFoeTravel(glitch, false);

  await h.advance(CONTACT_FRAMES);
  assertEqual(
    h.snapshot().lives,
    START_LIVES - 1,
    "the lives left after the contact, which is the life this point loses",
  );

  await h.advanceSeconds(THROUGH_RESPAWN);
  captureStill(h, "kept");

  const after = h.snapshot();
  for (const node of FIELD) {
    assertEqual(
      chargeAt(after, node.c, node.r),
      node.charge,
      `the charge on tile (${node.c}, ${node.r}) after the respawn`,
    );
  }
  assertLength(after.nodes, FIELD.length, "nodes standing after the respawn");
});
