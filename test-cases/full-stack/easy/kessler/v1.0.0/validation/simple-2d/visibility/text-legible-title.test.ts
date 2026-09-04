// visibility/text-legible-title — every run of text the title screen draws
// contrasts with what sits behind it.
//
// `specs/screens.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical stage size of `1000 x 1000`." Each of
// the six screens is its own point, because a build whose title reads and whose
// game-over screen does not must grade differently from one where none of them
// does. How a run is found and how its contrast is read is `legible.ts`.
//
// THE SCREEN IS ENTERED DIRECTLY THROUGH THE SURFACE, never through the menus,
// which are other items' business.

import { afterEach, beforeEach, it } from "vitest";
import { openHarness, type Harness } from "../harness";
import { assertRunsLegible, screenRuns } from "./legible";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the title screen's text legibly", async () => {
  h.reset();
  h.debug.setScreen("title");
  await assertRunsLegible(h, "title", "title", await screenRuns(h));
});
