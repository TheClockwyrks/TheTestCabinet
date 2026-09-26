// instrumentation/empty-clear-structure-pushes-no-history — emptying an empty
// structure pushes nothing.
//
// `specs/instrumentation.md` § The structure: "On a structure that is already
// empty it removes nothing and pushes no history, like every other removal with
// nothing to remove, and `nextMemberId` goes back to `0` whether or not anything
// went."
//
// THE SITE IS OPENED AND NOTHING IS BUILT ON IT, which is the state that sentence
// describes and the one a player meets first: opening a site "empties the undo
// history" (`specs/state.md`), and a `reset` leaves "every site's stored structure
// and tape emptied" (`specs/instrumentation.md`), so the structure the call is
// handed is empty and the depth it is measured against is `0`.
//
// THE UNDO IS WHAT MAKES THE DEPTH MEAN SOMETHING. A build that pushed an entry
// here would hand the player an undo that restores an empty structure onto an
// empty structure — invisible in the yard and visible only as a wasted press —
// so the depth is read after the call and an `undo` is then driven, through the
// key `specs/controls.md` binds it to on the build screen, to show there is
// nothing behind it.
//
// The yard is emptied of its loads and obstacles first, because they are the
// site's rather than the structure's ("posing them refuses nothing and changes
// nothing that is built") and this check is about a structure alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The key `specs/controls.md` binds `undo` to, on the build screen. */
const UNDO_KEY = BINDINGS.undo[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pushes no history when there was nothing to remove", async () => {
  // A site opens with an empty structure and an empty history (specs/state.md),
  // which is the whole precondition this point needs: the yard's loads and
  // obstacles are not structure edits and push no undo entry, so nothing is
  // emptied here that a broken clearing pose could take down with it.
  await openSite(h, 0);
  const before = await h.snapshot();

  await h.debug.clearStructure();
  const after = await h.snapshot();

  await h.press(UNDO_KEY);
  const undone = await h.snapshot();

  await h.capture("state", "The driven state this point decides");

  assertLength(
    before.structure.members,
    0,
    "the members standing on a site opened and not built on, which is the " +
      "scenario this point rests on",
  );
  assertEqual(
    before.historyDepth,
    0,
    "the undo history a site opening empties (specs/state.md)",
  );
  assertEqual(
    after.historyDepth,
    0,
    "the undo history after clearStructure on an empty structure, which " +
      "removes nothing and pushes none (specs/instrumentation.md)",
  );
  assertLength(
    undone.structure.members,
    0,
    "the members an undo puts back afterwards, there being no entry behind it " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    undone.historyDepth,
    0,
    "the undo history after that undo (specs/instrumentation.md)",
  );
});
