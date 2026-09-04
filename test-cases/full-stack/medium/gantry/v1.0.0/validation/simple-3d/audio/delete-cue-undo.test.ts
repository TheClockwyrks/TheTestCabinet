// audio/delete-cue-undo — an undo sounds the delete cue.
//
// specs/ui.md § Audio: "| `delete` | a structure edit removes one of those, and
// every `undo` |". The undo is the second half of that row and its own
// requirement: a build that sounds the cue when a part is deleted and stays
// silent when an edit is taken back has missed it. specs/structure.md says what
// an undo does — it "restores the structure to what it was before the most
// recent structure-changing edit" — and specs/controls.md binds it to `KeyZ` on
// the build screen.
//
// THE EDIT UNDONE IS A PLACEMENT, which is the case the cue is least obviously
// right for: the undo of a placement removes a member, so `delete` is what
// sounds even though the edit being reversed sounded `place`. Everything is
// cleared and one strut is placed between an anchor node and the node one
// lattice pitch above it, a placement specs/structure.md refuses nothing about.
// The queue is drained after that placement, so the cue read back belongs to the
// undo alone.
//
// THE UNDO IS PRESSED RATHER THAN POSED, because specs/instrumentation.md gives
// the surface no undo operation: `undo` is a bound action, so the only way to
// reach it is the key specs/controls.md binds it to, on the build screen the
// same file says it applies on. That the undo landed is read back from the
// structure before the cue is judged, so a build that heard the key and did
// nothing fails on the undo rather than on the sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on; the editor's cues are the same on every one. */
const SITE = 0;

/** One strut, from an anchor node of every site to the node one pitch above. */
const FROM = { x: 0, y: 0, z: 0 } as const;
const TO = { x: 0, y: 2, z: 0 } as const;

/** The key specs/controls.md binds `undo` to. */
const UNDO_KEY = BINDINGS.undo[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the delete cue on an undo", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);
  const placed = await h.snapshot();
  assertLength(
    placed.structure.members,
    1,
    "the member standing before the undo, so there is an edit to take back",
  );
  assertEqual(
    placed.screen,
    "build",
    "the screen the undo is pressed on, which is where specs/controls.md " +
      "binds it",
  );
  await h.cues(); // the placement's own `place`, drained

  await h.press(UNDO_KEY);
  await h.advance(1);
  const played = await h.cues();
  const state = await h.snapshot();
  await h.capture("state", "the structure the undo put back");

  assertLength(
    state.structure.members,
    0,
    `the members standing after ${UNDO_KEY}: an undo restores the structure ` +
      "to what it was before the most recent edit, which was empty " +
      "(specs/structure.md)",
  );
  assertContains(
    played,
    "delete",
    "the cues the undo sounded: `delete` plays on every `undo` " +
      "(specs/ui.md § Audio)",
  );
});
