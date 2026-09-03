// audio/place-cue-member — the place cue sounds when an edit places a member.
//
// specs/ui.md § Audio gives the `place` row as "a structure edit places a member,
// the ring, or a counterweight". This decides the first of those three: the edit
// that puts a member on the lattice is one the player hears.
//
// THE WORLD IS EMPTIED FIRST AND THE QUEUE IS DRAINED. Opening a site and
// clearing it are themselves edits, and the title screen carries the music bed
// (specs/ui.md), so everything that sounded on the way in is read away before the
// one edit under test is made. What `cues()` answers afterwards is that edit's.
//
// AND IT ASKS WHETHER THE CUE SOUNDED, NOT HOW MANY SOURCES IT TOOK. A build is
// free to build one clack out of a tone and a noise burst over the same decoded
// buffer, which the probe sees as two starts of one cue
// (validation/none/cues-init.js), so a count would grade the shape of the build's
// audio rather than the rule specs/ui.md states.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A strut on the anchor at the lattice origin: inside every site's envelope. */
const A = { x: 0, y: 0, z: 0 } as const;
const B = { x: 0, y: 2, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the place cue when a structure edit places a member", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.advance(1);
  await h.cues();

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  // A cue a pose raises sounds on the FRAME THAT FOLLOWS it, never at the call.
  await h.advance(1);
  const played = await h.cues();

  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the member the edit placed, so a cue has an edit to sound for",
  );
  assertContains(
    played,
    "place",
    "the cue a structure edit that places a member plays (specs/ui.md)",
  );

  await h.capture("member", "The member the edit placed");
});
