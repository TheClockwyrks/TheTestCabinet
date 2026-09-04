// controls/build-key — `KeyB` takes the program screen back to the build screen.
//
// `specs/controls.md` § The actions: the `build` action is bound to `KeyB` and
// does "program screen to build screen". `specs/ui.md` § Program says the same of
// the screen: "`build` switches back, `run` starts the run, and `back` returns to
// `select`."
//
// The program screen is reached with `setScreen`, which "shows a named screen and
// sets nothing else" (`specs/instrumentation.md`), rather than by pressing the
// `program` action on the way: that binding is its own review point, and a build
// with a broken `KeyP` must fail that item and be decided fairly on this one.
// The site is opened first because the program screen is one of the yard screens,
// so what the press is read on is a screen a player could be standing on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `build` action's binding, as `specs/controls.md` fixes it. */
const BUILD_KEY = BINDINGS.build[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the build screen from the program screen", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("program");
  assertEqual(
    (await h.snapshot()).screen,
    "program",
    "the screen the `build` action is pressed on",
  );

  await h.press(BUILD_KEY);
  assertEqual(
    (await h.snapshot()).screen,
    "build",
    `the screen after ${BUILD_KEY}, which is the build action's binding ` +
      "(specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the build screen the build action returned to");
});
