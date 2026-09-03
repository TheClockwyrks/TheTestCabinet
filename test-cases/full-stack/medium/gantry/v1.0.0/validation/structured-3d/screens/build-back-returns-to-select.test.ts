// screens/build-back-returns-to-select — back leaves the build screen for the
// site list when no node is held.
//
// specs/ui.md, "Build": "`program` switches to the tape, `run` starts the run,
// and `back` returns to `select`, or clears a pending node when one is held."
// specs/controls.md resolves the same rule as an ordered table whose first row
// is "The build screen, with a pending node held", so with NO pending node held
// the row that applies is "Anywhere else | Leaves the screen for the one
// `specs/ui.md` gives it" — the site list.
//
// So the pose is the build screen with the pending node cleared, which is the
// one precondition this point turns on, and the check reads it back before it
// presses anything. `back` is delivered as its binding, `Escape`
// (specs/controls.md), held across a tick so a build reading held state at the
// top of a frame sees it exactly as one latching the edge does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** `back`, as specs/controls.md binds it. */
const BACK = BINDINGS.back[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to select from the build screen with no pending node", async () => {
  await openSite(h, SITE);
  await h.debug.clearPendingNode();

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");
  assertNull(
    posed.pendingNode,
    "the pending node this point needs unheld (specs/ui.md)",
  );

  await h.press(BACK);

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    "the screen back leaves the build screen for with no pending node held " +
      "(specs/ui.md)",
  );

  await h.capture("state", "the select screen back left the build screen for");
});
