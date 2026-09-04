// screens/mapselect-lists-three — the map select lists the three maps.
//
// THE REQUIREMENT. `specs/ui.md`: the map select "lists the three maps of
// `specs/yard.md`, The Substation, The Switchyard and The Transformer Yard, each
// with its name and a preview of its waypoint layout, and The Transformer Yard's
// preview showing its two fixed housings." The names are the part the
// specification fixes as text; the preview is drawn work whose look, like every
// other look in this game, belongs to the build.
//
// HOW IT IS DECIDED. The map select is opened directly, through the operation that
// reaches a screen "exactly as reaching it in play does", so a build with a broken
// title menu still has this point decided on its own terms. The frame's own text
// draws are then read for all three names, and the screen is kept as a still.
//
// WHAT IS DECIDED HERE AND WHAT IS NOT. Neither `specs/ui.md` nor
// `specs/instrumentation.md` gives a preview any machine-readable form: no
// reading reports the preview's geometry, and `specs/ui.md` fixes no layout for
// the screen, so there is no coordinate a check could sample and no shape it
// could count that would be fair to every conforming build. What this check
// decides is that the screen names all three maps; the previews and the
// Transformer Yard's two housings are left to the reviewer, who has the captured
// still in front of them.

import { afterEach, beforeEach, it } from "vitest";
import { MAPS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("names all three maps on the map select", async () => {
  h.debug.reset();
  h.debug.setScreen("mapselect");
  const calls = await h.frameCalls();
  captureStill(h, "maps");

  assertEqual(
    h.snapshot().screen,
    "mapselect",
    "the map select showing (specs/ui.md)",
  );

  for (const map of MAPS) {
    assertEqual(
      drewText(calls, map.name),
      true,
      `the map select to draw the name ${map.name} (specs/ui.md, ` +
        "specs/yard.md)",
    );
  }
});
