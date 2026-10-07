// controls/tool-key-delete — `Digit6` selects the delete tool on the build screen.
//
// `specs/controls.md` § The actions: the `tool-delete` action is bound to `Digit6`
// and does "select the delete tool, on the build screen". § The build tools states
// what the selection is for: "The selected tool decides what a click does", and
// under the delete tool "a click removes what it picks", the nearest
// of a member, a counterweight, or the ring in screen distance.
//
// The tool is posed to `strut` first — `setTool` "selects a build tool, as the
// tool actions do" (`specs/instrumentation.md`) — so the press has somewhere to
// move the selection from, and a build that answers every tool key with the tool
// it was already holding fails rather than passing by standing still. `strut` is
// also what a `reset` leaves, so the pose asks the build for nothing unusual.
//
// The build screen is reached by opening a site, which leaves it showing. WHAT A
// CLICK UNDER THIS TOOL DOES IS NOT ASSERTED HERE: the placement rules are the
// editor items' own, and this one decides the binding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `tool-delete` action's binding, as `specs/controls.md` fixes it. */
const KEY = BINDINGS["tool-delete"][0]!;

/** The tool selected before the press, so the press has to move it. */
const BEFORE = "strut";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the delete tool on the build screen", async () => {
  await openSite(h, 0);
  await h.debug.setTool(BEFORE);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "build",
    "the screen the tool action is pressed on",
  );
  assertEqual(posed.tool, BEFORE, "the tool selected before the press");

  await h.press(KEY);
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the build screen with the delete tool selected");

  assertEqual(
    after.tool,
    "delete",
    `the tool after ${KEY}, which is the tool-delete action's binding ` +
      "(specs/controls.md)",
  );
});
