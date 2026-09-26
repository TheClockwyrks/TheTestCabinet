// audio/delete-cue-member — removing a member sounds the delete cue.
//
// specs/ui.md § Audio: "| `delete` | a structure edit removes one of those, and
// every `undo` |", where "those" are the member, the ring and the counterweight
// the `place` row above it names. Each part removed is a requirement of its own;
// this is the member's.
//
// THE WORLD HOLDS ONE MEMBER AND NOTHING ELSE. Everything is cleared and a
// single strut is placed between an anchor node and the node above it — a
// placement specs/structure.md refuses nothing about: both ends are inside the
// site's envelope, the ends differ, the length is one lattice pitch against
// `STRUT_MAX_LEN` (`6`), no member duplicates it, the yard is empty of
// obstacles, and the cost is far under the budget. That placement sounds its own
// `place`, so the queue is drained after it and the removal's cue is read on its
// own — which is what makes this a check on the removal rather than on the
// placement.
//
// The removal is posed rather than clicked with the delete tool, because
// specs/instrumentation.md has a pose enter the same rule pipeline the tools
// feed: a build whose pointer picking is broken must fail the picking items and
// pass this one. It is posed by the member's id, which specs/instrumentation.md
// fixes as the structure's `nextMemberId` at the moment it was placed — `0` on a
// structure that was just emptied.
//
// A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, so one frame is
// advanced before the queue is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on; the editor's cues are the same on every one. */
const SITE = 0;

/** One strut, from an anchor node of every site to the node one pitch above. */
const FROM = { x: 0, y: 0, z: 0 } as const;
const TO = { x: 0, y: 2, z: 0 } as const;

/** The id `addMember` gives it: the emptied structure's `nextMemberId`. */
const MEMBER_ID = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the delete cue when an edit removes a member", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);
  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the member standing before the removal, so there is one to remove",
  );
  await h.cues(); // the placement's own `place`, drained

  await h.debug.removeMember(MEMBER_ID);
  await h.advance(1);
  const played = await h.cues();
  const state = await h.snapshot();
  await h.capture("state", "the yard the removed member left empty");

  assertLength(
    state.structure.members,
    0,
    "the members standing after the removal: removing one is always allowed " +
      "(specs/structure.md)",
  );
  assertContains(
    played,
    "delete",
    "the cues the edit sounded: `delete` plays when a structure edit removes " +
      "a member (specs/ui.md § Audio)",
  );
});
