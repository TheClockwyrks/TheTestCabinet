// controls/space-confirms — Space accepts the highlighted menu entry.
//
// specs/controls.md binds `confirm` to `Space` and `Enter`, and notes that
// "`Space` carries both `launch` and `confirm`, and the two never answer on
// the same screen" — on `title` there is no session to launch into, and the
// row makes `confirm` the action the screen reads. So Space on the title's
// START entry does exactly what Enter does there: specs/screens.md's
// "`confirm` on `START` starts a fresh session and sets `screen` to
// `playing`".
//
// Same arrangement as controls/enter-confirms, deliberately, with only the
// key changed: a build that wired `confirm` to Enter alone fails here and
// passes there, which is exactly the separation the two points exist for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { confirmStart } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a session with Space on the title's START entry", async () => {
  assertEqual(KEY, "Space", "the binding this point presses");
  const press = await confirmStart(h, KEY, "start");
  assertEqual(
    press.after.screen,
    "playing",
    "the screen after Space accepts START",
  );
});
