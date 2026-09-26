// audio/place-cue-ring — the place cue sounds when an edit places the slew ring.
//
// specs/ui.md § Audio gives the `place` row as "a structure edit places a member,
// the ring, or a counterweight". The ring is one edit of the three, and it is the
// one that is not a member: a build that wired the cue to `addMember` alone would
// place the bearing the whole crane turns on in silence.
//
// THE WORLD IS EMPTIED FIRST AND THE QUEUE IS DRAINED, so what `cues()` answers
// is this edit's and not the site opening's or the music bed's. The ring goes on
// an empty structure, where the only refusals left are the envelope and the
// budget (specs/structure.md): its base corner sits at `y` `2`, not on the
// ground, every one of its eight flange nodes is inside site 1's envelope, and
// `RING_COST` is far inside the budget.
//
// It asks whether the cue SOUNDED rather than how many sources it took: one cue
// may reach the bus as several starts over the same decoded buffer
// (validation/none/cues-init.js).

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The ring's base corner: off the ground, and clear of every envelope edge. */
const CORNER = { x: 0, y: 2, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the place cue when a structure edit places the ring", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.advance(1);
  await h.cues();

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  // A cue a pose raises sounds on the FRAME THAT FOLLOWS it, never at the call.
  await h.advance(1);
  const played = await h.cues();

  const after = await h.snapshot();

  await h.capture("ring", "The slew ring the edit placed");

  assertNotNull(
    after.structure.ring,
    "the ring the edit placed, so a cue has an edit to sound for",
  );

  assertContains(
    played,
    "place",
    "the cue a structure edit that places the ring plays (specs/ui.md)",
  );
});
