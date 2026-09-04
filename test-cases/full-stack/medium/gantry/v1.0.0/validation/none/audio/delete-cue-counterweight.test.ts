// audio/delete-cue-counterweight — removing a counterweight sounds the delete
// cue.
//
// specs/ui.md § Audio: "| `delete` | a structure edit removes one of those, and
// every `undo` |", where "those" are the member, the ring and the counterweight
// the row above it names. Each part removed is a requirement of its own; this is
// the counterweight's.
//
// THE WORLD HOLDS THE LEAST THE EDIT NEEDS. The yard is emptied and the
// structure is the empty one the harness's opening reset left, the ring is put
// back so a flange node exists for the counterweight to sit on
// (specs/structure.md: "placed on any node the structure uses … or a flange node
// of the ring"), and the counterweight is placed on one. Both of those edits
// sound `place` themselves, so the queue is drained after them and the removal's
// cue is read on its own — which is also what makes this a check on the removal
// rather than on the placement.
//
// The removal is posed rather than clicked with the delete tool, because
// specs/instrumentation.md has a pose enter the same rule pipeline the tools
// feed: a build whose pointer picking is broken must fail the picking items and
// pass this one. specs/structure.md makes the removal itself unrefusable —
// "Removing a member, the ring, or a counterweight is always allowed" — and the
// snapshot is read back to confirm it landed before the cue is judged.
//
// A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, so one frame is
// advanced before the queue is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The site this runs on; the editor's cues are the same on every one. */
const SITE = 0;

/** The ring's base corner: one lattice pitch off the ground, as the rule asks. */
const RING = { x: 0, y: 2, z: 0 } as const;

/** A bottom-flange node of that ring, so the structure uses it. */
const NODE = { x: 0, y: 2, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the delete cue when an edit removes a counterweight", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  assertLength(
    (await h.snapshot()).structure.counterweights,
    1,
    "the counterweight standing before the removal, so there is one to remove",
  );
  await h.cues(); // the two placements' own `place` cues, drained

  await h.debug.removeCounterweight(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const played = await h.cues();
  const state = await h.snapshot();
  await h.capture("state", "the ring, its counterweight removed");

  assertLength(
    state.structure.counterweights,
    0,
    "the counterweights standing after the removal: removing one is always " +
      "allowed (specs/structure.md)",
  );
  assertContains(
    played,
    "delete",
    "the cues the edit sounded: `delete` plays when a structure edit removes " +
      "a counterweight (specs/ui.md § Audio)",
  );
});
