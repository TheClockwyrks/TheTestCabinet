// controls/tool-keys-do-nothing-off-the-build-screen — a tool key pressed on the
// program screen changes no tool.
//
// `specs/controls.md` § The actions gives every tool row the same "on the build
// screen", and the paragraph under the table fixes the other half of it: "Every
// action applies where the table says and does nothing elsewhere; the menus are
// driven by the four directions, `confirm`, and `back` alone." The program screen
// is not the build screen, so a tool key delivered there operates nothing.
//
// THE PROGRAM SCREEN RATHER THAN A MENU SCREEN, because it is the screen a player
// actually reaches a tool key from by mistake: `program` is one key (`KeyP`) away
// from the build screen and shows the same yard, so a build that read the tool
// keys from a shared 3D-screen handler rather than from the build screen's own
// leaks exactly here. § The run screen states the same rule from the other side:
// that screen "takes the camera actions, a pointer drag on the camera, `speed`,
// `mute`, and `back` alone".
//
// THE TOOL IS POSED AWAY FROM THE ONE THE KEY WOULD SELECT. `Digit3` selects the
// rail, so the selection standing when the key is pressed is `strut` — the tool a
// `reset` leaves (`specs/instrumentation.md`) — and a build that let the key
// through would be read as `rail` rather than as the tool it was already holding.
//
// This decides one direction: that the tool key does NOT apply here. That it DOES
// apply on the build screen is each tool key's own review point, so a build whose
// tool keys do nothing anywhere fails there rather than passing here by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `tool-rail` action's binding, as `specs/controls.md` fixes it. */
const KEY = BINDINGS["tool-rail"][0]!;

/** The tool standing when the key is pressed: not the one `Digit3` selects. */
const BEFORE = "strut";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the selected tool alone under a tool key on the program screen", async () => {
  await openSite(h, 0);
  await h.debug.setTool(BEFORE);
  await h.debug.setScreen("program");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "program",
    "the screen the tool key is pressed on, which is not the build screen the " +
      "tool actions apply on (specs/controls.md)",
  );
  assertEqual(posed.tool, BEFORE, "the tool selected before the press");

  await h.press(KEY);

  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the program screen after a tool key");

  assertEqual(
    after.tool,
    BEFORE,
    `the selected tool after ${KEY} was pressed on the program screen, where ` +
      "the tool actions do not apply (specs/controls.md)",
  );
});
