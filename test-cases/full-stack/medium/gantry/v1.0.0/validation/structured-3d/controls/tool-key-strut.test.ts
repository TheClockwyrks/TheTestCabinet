// controls/tool-key-strut — `Digit1` selects the strut tool on the build screen.
//
// `specs/controls.md` § The actions: the `tool-strut` action is bound to `Digit1`
// and does "select the strut tool, on the build screen". § The build tools states
// what the selection is for: "The selected tool decides what a click does", and
// the strut is one of the three materials a member placement lays down
// (`specs/structure.md`).
//
// THE KEY IS PRESSED RATHER THAN POSED, because the requirement is the BINDING:
// `setTool` reaches the same field without going anywhere near `Digit1`, so a
// build that registered this action against the wrong key would pass a posed
// check and fail a player.
//
// The tool is posed to `delete` first — `setTool` "selects a build tool, as the
// tool actions do" (`specs/instrumentation.md`) — so the press has somewhere to
// move the selection from. It has to be posed away from `strut` in particular:
// `strut` is what a `reset` leaves, so a build whose `Digit1` does nothing at all
// would otherwise pass by standing still.
//
// The build screen is reached by opening a site, which leaves it showing. WHAT A
// CLICK UNDER THIS TOOL DOES IS NOT ASSERTED HERE: the placement rules are the
// editor items' own, and this one decides the binding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `tool-strut` action's binding, as `specs/controls.md` fixes it. */
const KEY = BINDINGS["tool-strut"][0]!;

/** The tool selected before the press, so the press has to move it. */
const BEFORE = "delete";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the strut tool on the build screen", async () => {
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
  assertEqual(
    (await h.snapshot()).tool,
    "strut",
    `the tool after ${KEY}, which is the tool-strut action's binding ` +
      "(specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the build screen with the strut tool selected");
});
