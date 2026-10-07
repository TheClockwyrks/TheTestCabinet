// nodes/respawn-keeps-field — the field stands through a lost life.
//
// specs/progression.md lists what a contact costs, with lives to spare: "Lives
// falls by one. Every worm, every foe, and every bolt in flight is removed from
// the board. The node field stands exactly as it was." specs/nodes.md states the
// same rule from the field's side: "Losing a life does not reset it. Every node
// and its charge survive the respawn unchanged, while the worms and the foes do
// not."
//
// THE FIELD IS POSED AT ALL FOUR CHARGES, on four scattered tiles, so a build
// that empties the field, re-scatters it, or flattens it to inert reads back a
// different field in every one of those cases rather than only some of them.
//
// THE CONTACT IS A FOE, NOT A WORM. specs/cursor.md gives both routes, and this
// point takes the one that leaves the worm roster out of it: a board that had a
// worm segment removed is a board specs/progression.md may read as a CLEARED
// level, which would carry the check into a level advance instead of a respawn.
// A single foe is posed with its centre on the cursor's centre, so the two boxes
// coincide and the contact is certain, and with both of its faculties off
// (specs/instrumentation.md's `setFoeMind` and `setFoeTravel`) so it cannot
// travel out of contact and cannot eat the field it is standing in.
//
// THE CURSOR'S CONTACT GATE IS TURNED BACK ON, because the contact IS this
// point's scenario; the harness shuts it for every check whose scenario it is
// not. The cursor's spawn-in invulnerability is posed at zero, since a contact
// during it costs nothing (specs/cursor.md).
//
// The field is read twice: on the frame the life is lost, and again once the
// respawn's own RESPAWN_TIME has been driven through, since the rule is that the
// field survives the WHOLE respawn rather than only its first frame. The worm
// entry gate stays shut throughout, so the worm the respawn brings back never
// arrives to bump a node while the second reading is being taken.
//
// NO TOLERANCE APPLIES: the field is compared node for node, charge for charge.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  CHARGE_MAX,
  RESPAWN_TIME,
  START_LIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  lastFoe,
  poseNodes,
  startPlaying,
  type Harness,
  type NodeView,
  type WirewormSnapshot,
} from "../harness";

/** The field the respawn must leave alone: one tile at each of the four charges. */
const FIELD: readonly (readonly [number, number, number])[] = [
  [3, 3, 0],
  [8, 5, 1],
  [20, 12, 2],
  [33, 7, CHARGE_MAX],
];

/** Lives posed with room to spare, so the contact respawns rather than ending the run. */
const LIVES = START_LIVES;

/** How long the contact is waited for: a fraction of a second is ample. */
const CONTACT_FRAMES = framesFor(0.5);

/** The respawn driven right through, with room to spare (specs/progression.md). */
const RESPAWN_FRAMES = framesFor(RESPAWN_TIME + 0.5);

/** The field as a stable list, so two readings compare by content alone. */
function field(snapshot: WirewormSnapshot): NodeView[] {
  return [...snapshot.nodes].sort((a, b) => a.r - b.r || a.c - b.c);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every node and its charge exactly as they were through a lost life", async () => {
  await startPlaying(h);
  await poseNodes(h, FIELD);
  await h.debug.setLives(LIVES);
  await h.debug.setCursorInvulnerable(0);
  await h.debug.setCursorContact(true);
  await h.debug.addFoe("glitch", BAND_CX, BAND_CY);
  const foe = lastFoe(await h.snapshot());
  assertEqual(
    foe === undefined,
    false,
    "the foe the contact needs, on the board",
  );
  if (foe !== undefined) {
    await h.debug.setFoeMind(foe.id, false);
    await h.debug.setFoeTravel(foe.id, false);
  }
  const before = field(await h.snapshot());

  const lost = await h.until((snapshot) => snapshot.lives < LIVES, {
    maxFrames: CONTACT_FRAMES,
    poll: 1,
  });
  assertEqual(
    lost.hit,
    true,
    "the life the contact costs, which is the scenario this point needs",
  );
  assertDeepEqual(
    field(lost.snapshot),
    before,
    "the node field on the frame the life was lost",
  );

  await h.advance(RESPAWN_FRAMES);
  await captureStill(h, "kept");

  assertDeepEqual(
    field(await h.snapshot()),
    before,
    "the node field once the respawn has run through",
  );
});
