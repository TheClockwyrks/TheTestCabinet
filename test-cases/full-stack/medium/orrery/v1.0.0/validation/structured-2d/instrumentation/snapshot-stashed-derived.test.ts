// instrumentation/snapshot-stashed-derived — the stashed lists name the
// challenges a mode is keeping a machine for, and nothing else.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape, declares the field as
// "stashed: [<number>], // ascending indices with a stashed machine" and puts it
// in the derived table: "`campaign.stashed`, `extras.stashed` — the challenges
// each mode holds a stashed machine for". What puts a machine there is
// `specs/editor.md`: "leaving by any route keeps the machine, and every later
// visit in the session restores it exactly, tapes included. Each challenge carries
// its own machine", and `specs/instrumentation.md` says a `setScreen` out of the
// editor is one of those routes: it "leaves it exactly as leaving it in play does:
// a live run is stopped, the open challenge's machine is stashed as
// `specs/editor.md` states, and the challenge is closed".
//
// THE CONFIGURATION. Two Extras challenges, opened and left in the order `4` then
// `1`, each with one arm placed on it — the Extras because every one of them is
// open from the start (`specs/modes/extras.md`), so a visit needs nothing unlocked
// first. A third challenge, `7`, is never opened at all. The campaign is left
// alone entirely.
//
// WHY THE VISITS ARE OUT OF ORDER. The list is "ascending indices", not the order
// the session touched them, so visiting `4` before `1` is what tells the two
// apart: a build that appended as it went would report `[4, 1]`.
//
// THE VERDICT. `extras.stashed` is `[1, 4]` — both visited challenges, ascending,
// and not the one never opened — while `campaign.stashed` is still empty, because
// nothing of the campaign was ever entered.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the ascending indices of the challenges holding a machine", async () => {
  await openTitle(h);
  const fresh = await h.snapshot();
  assertDeepEqual(
    fresh.extras.stashed,
    [],
    "a session that has entered nothing is keeping no machine",
  );

  await h.debug.openChallenge("extras", 4);
  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
  await h.debug.setScreen("title");

  await h.debug.openChallenge("extras", 1);
  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
  await h.debug.setScreen("title");

  await h.advance(1);
  await captureStill(h, "stashed");

  const visited = await h.snapshot();
  assertDeepEqual(
    visited.extras.stashed,
    [1, 4],
    "both challenges visited and left appear, in ascending order rather than visit order",
  );
  assertDeepEqual(
    visited.campaign.stashed,
    [],
    "the campaign holds no machine: none of its challenges was ever entered",
  );
});
