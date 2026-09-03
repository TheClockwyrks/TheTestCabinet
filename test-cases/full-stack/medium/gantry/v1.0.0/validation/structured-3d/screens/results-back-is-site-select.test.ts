// screens/results-back-is-site-select — back on the results screen does what
// SITE SELECT does.
//
// specs/ui.md, "Results", closes with "`back` does what `SITE SELECT` does", and
// the entry table above it gives `SITE SELECT` as "Returns to `select`, opening
// no site". So the requirement this point decides is where `back` leaves the
// results screen: the site list.
//
// The screen is reached with `setScreen`, which "shows a named screen and sets
// nothing else", rather than by clearing a site: a build whose run never reaches
// results must fail THAT point, and this one is about the key on the screen.
//
// A site is opened first, so the results screen stands over a site the way a
// player ever sees it. `back` is delivered as its binding, `Escape`
// (specs/controls.md), held across a tick so a build reading held state at the
// top of a frame sees it exactly as one latching the edge does.

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

it("returns to select from the results screen", async () => {
  await openSite(h, SITE);
  await h.debug.setScreen("results");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the screen this point presses back on");

  await h.press(BACK);

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    "the screen back leaves the results screen for, as SITE SELECT does " +
      "(specs/ui.md)",
  );

  await h.capture("state", "the select screen back left the results screen for");
});
