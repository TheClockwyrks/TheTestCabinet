// audio/delete-cue-ring — removing the ring sounds the delete cue.
//
// specs/ui.md § Audio: "| `delete` | a structure edit removes one of those, and
// every `undo` |", where "those" are the member, the ring and the counterweight
// the `place` row above it names. Each part removed is a requirement of its own;
// this is the ring's.
//
// THE WORLD HOLDS THE RING AND NOTHING ELSE. Everything is cleared and the ring
// is placed by its base corner one lattice pitch off the ground, which is what
// specs/structure.md requires of it ("the base corner's `y` is `0`" is the only
// height it refuses, "since the ring sits on a tower, not on the ground") — and
// with no member built, nothing else about the placement can be refused either.
// The placement sounds its own `place`, so the queue is drained after it and the
// removal's cue is read on its own.
//
// The removal is posed rather than clicked with the delete tool, because
// specs/instrumentation.md has a pose enter the same rule pipeline the tools
// feed: a build whose pointer picking is broken must fail the picking items and
// pass this one. specs/structure.md makes the removal itself unrefusable —
// "Removing a member, the ring, or a counterweight is always allowed".
//
// A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, so one frame is
// advanced before the queue is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull, assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on; the editor's cues are the same on every one. */
const SITE = 0;

/** The ring's base corner: one lattice pitch off the ground, as the rule asks. */
const RING = { x: 0, y: 2, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the delete cue when an edit removes the ring", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.advance(1);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the ring standing before the removal, so there is one to remove",
  );
  await h.cues(); // the placement's own `place`, drained

  await h.debug.clearRing();
  await h.advance(1);
  const played = await h.cues();
  const state = await h.snapshot();
  await h.capture("state", "the yard the removed ring left empty");

  assertNull(
    state.structure.ring,
    "the ring standing after the removal: removing it is always allowed " +
      "(specs/structure.md)",
  );
  assertContains(
    played,
    "delete",
    "the cues the edit sounded: `delete` plays when a structure edit removes " +
      "the ring (specs/ui.md § Audio)",
  );
});
