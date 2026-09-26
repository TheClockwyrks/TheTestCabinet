// audio/refused-edit-plays-no-cue — a refused edit is silent.
//
// specs/ui.md § Audio binds `place` to "a structure edit places a member, the
// ring, or a counterweight" and `delete` to "a structure edit removes one of
// those". A refused edit does neither: specs/structure.md § The editor's rules
// says "The editor refuses any edit that would break a rule, and a refused edit
// changes nothing", and specs/instrumentation.md says the same of the poses that
// stand for those edits — "a refused edit leaves the structure exactly as it
// was", and a removal with nothing to remove "is a refusal rather than an invalid
// argument, so it is silent". Nothing is placed and nothing is removed, so
// neither cue has an event to play on. The refusal is shown, not sounded: "A
// refused edit is visible in the moment it is refused" (specs/ui.md § Build).
//
// FOUR REFUSALS, ONE FROM EACH KIND OF EDIT the two cues cover, so a build that
// gates one kind of edit on acceptance and plays another's cue unconditionally is
// caught:
//
//   - a second ring, refused because "the crane already has a ring";
//   - a strut longer than `STRUT_MAX_LEN` (`6`), refused because "its length
//     exceeds its material's maximum";
//   - a counterweight on a node the structure does not use, which
//     specs/structure.md refuses outright;
//   - a `removeCounterweight` on a lattice node carrying none, which
//     specs/instrumentation.md names as the removal that removes nothing: "a
//     removal with nothing to remove is a refusal rather than an invalid
//     argument, so it is silent".
//
// THE WORLD HOLDS A RING AND NOTHING ELSE. The yard is emptied and the structure
// cleared, then one ring is placed and its own `place` cue is drained — so the
// window this check reads holds the four refusals and no accepted edit at all.
// The ring is what makes the second-ring refusal available, and it uses no node
// the counterweight is offered, so that refusal stands on its own rule.
//
// THE STRUCTURE IS READ BACK FIRST, because the point rests on these edits being
// refused: a build that ACCEPTED one of them would have an event to sound, and
// its silence would say nothing. The cost and `historyDepth` are read with it,
// since "a refused edit changes nothing" and "Each edit that lands pushes the
// undo history exactly as a click would".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { STRUT_MAX_LEN } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The one accepted edit: a ring on a tower node, its `y` not `0`. */
const RING = { x: 0, y: 2, z: 0 };

/** A strut of length 8, past `STRUT_MAX_LEN` (6), inside the envelope. */
const LONG = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 0, y: 8, z: 0 },
} as const;

/** A lattice node inside the envelope that no member and no flange touches. */
const UNUSED_NODE = { x: 6, y: 0, z: 6 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays no cue for a structure edit the editor refuses", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.advance(1);
  await h.cues();

  const before = await h.snapshot();
  assertEqual(
    before.structure.ring?.corner.x,
    RING.x,
    "the one ring standing before the refused edits (specs/structure.md)",
  );

  // The four refusals, in turn, each given a frame to sound on.
  await h.debug.setRing(RING.x + 2, RING.y + 2, RING.z + 2);
  await h.advance(1);
  await h.debug.addMember(
    LONG.a.x,
    LONG.a.y,
    LONG.a.z,
    LONG.b.x,
    LONG.b.y,
    LONG.b.z,
    "strut",
  );
  await h.advance(1);
  await h.debug.addCounterweight(UNUSED_NODE.x, UNUSED_NODE.y, UNUSED_NODE.z);
  await h.advance(1);
  await h.debug.removeCounterweight(
    UNUSED_NODE.x,
    UNUSED_NODE.y,
    UNUSED_NODE.z,
  );
  await h.advance(1);

  const sounds = await h.cues();
  const after = await h.snapshot();
  await h.capture("refused", "The yard after the refused edits");

  // The edits were refused, which is what makes their silence mean anything.
  assertLength(
    after.structure.members,
    0,
    `the members standing: a strut of length ${LONG.b.y - LONG.a.y} exceeds ` +
      `STRUT_MAX_LEN (${STRUT_MAX_LEN}) and is refused (specs/structure.md)`,
  );
  assertLength(
    after.structure.counterweights,
    0,
    "the counterweights standing: a counterweight is refused on a node the " +
      "structure does not use (specs/structure.md)",
  );
  assertEqual(
    after.structure.ring?.corner.y,
    RING.y,
    "the ring standing: a second ring is refused, so the first is untouched " +
      "(specs/structure.md)",
  );
  assertEqual(
    after.structure.cost,
    before.structure.cost,
    "the crane's cost across four refused edits, which change nothing " +
      "(specs/structure.md § The editor's rules)",
  );
  assertEqual(
    after.historyDepth,
    before.historyDepth,
    "the undo history across four refused edits: only an edit that lands " +
      "pushes it (specs/instrumentation.md)",
  );

  assertLength(
    sounds,
    0,
    "the sounds four refused structure edits play: `place` follows " +
      '"a structure edit places a member, the ring, or a counterweight" and ' +
      '`delete` follows "a structure edit removes one of those" (specs/ui.md ' +
      "§ Audio), and a refused edit places and removes nothing. They " +
      `sounded ${JSON.stringify(sounds)}`,
  );
});
