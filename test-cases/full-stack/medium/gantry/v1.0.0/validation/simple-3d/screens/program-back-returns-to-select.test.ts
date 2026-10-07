// screens/program-back-returns-to-select — back leaves the tape screen for the
// site list.
//
// specs/ui.md, "Program": "`build` switches back, `run` starts the run, and
// `back` returns to `select`." The program screen carries none of the build
// screen's pending-node case, so specs/controls.md's ordered table lands
// straight on "Anywhere else | Leaves the screen for the one `specs/ui.md` gives
// it".
//
// The screen is reached with `setScreen`, which "shows a named screen and sets
// nothing else", rather than by pressing the `program` key from the build
// screen: a build whose `program` binding is broken must fail that binding's
// point and pass this one.
//
// `back` is delivered as its binding, `Escape` (specs/controls.md), held across
// a tick so a build reading held state at the top of a frame sees it exactly as
// one latching the edge does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("returns to select from the program screen", async () => {
  await openSite(h, SITE);
  await h.debug.setScreen("program");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "program", "the screen this point presses back on");

  await h.press(BACK);

  const after = await h.snapshot();
  await h.capture(
    "state",
    "the select screen back left the program screen for",
  );

  assertEqual(
    after.screen,
    "select",
    "the screen back leaves the program screen for (specs/ui.md)",
  );
});
