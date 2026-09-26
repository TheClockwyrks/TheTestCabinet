// screens/build-readout-selected-tool-marked — the build screen marks which tool
// is selected.
//
// `specs/ui.md` § Build: "Its readouts show the site's name, the cost against the
// budget, THE TOOL PALETTE WITH EACH TOOL'S BINDING AND THE SELECTED TOOL MARKED,
// and the tape's step count." A palette that shows the tools without saying which
// one a click will use leaves the player guessing what their next click does.
//
// WHERE AND HOW IT IS MARKED IS THE BUILD'S. `specs/instrumentation.md` has
// `drawn()` carry the mark by name — the reading reports that it is on screen,
// and fixes nothing about where it sits or what it looks like.
//
// THE MARK IS ASKED FOR ON THE BUILD SCREEN AND NOWHERE ELSE, since that is the
// only screen with a tool palette to mark.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the selected tool on the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.debug.setTool("strut");
  await h.advance(1);

  const drawn = await h.drawn();

  await h.capture(
    "build-selected-tool",
    "The build screen marking the selected tool",
  );

  assertTrue(
    entriesOf(drawn, "mark", "selected-tool").length > 0,
    "the selected tool marked among what the build screen drew (specs/ui.md)",
  );
});
