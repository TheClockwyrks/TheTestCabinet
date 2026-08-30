// Wireworm — screens/title-descend-starts: confirming DESCEND on the title opens
// a run.
//
// One transition of the menu state machine `specs/ui.md` fixes: DESCEND "opens a
// new run, as `specs/progression.md` states, and moves to `playing`". The title
// is posed by `reset`, which restores the highlight to the first item, and the
// item under that highlight is checked to be DESCEND before the press — so a
// build whose title opens on some other item fails on the precondition it
// breaks rather than on the transition.
//
// The press is the `confirm` action's own bound key, dispatched as a real key
// event at the target the engine listens on: the menus are keyboard only
// (`specs/controls.md`), and nothing here poses the screen the press is supposed
// to reach. What the run OPENS with — level 1, three lives, a score of 0 — is
// what `screens/ending-play-again` and `screens/pause-restart` decide; this one
// decides only that the run opens at all, which is why its cap is `broken`.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run from the first title item", async () => {
  resetTo(h);
  assertEqual(TITLE_ITEMS[0], "DESCEND", "DESCEND is the first title item");
  const title = h.snapshot();
  assertEqual(title.screen, "title", "reset restores the title screen");
  assertEqual(
    title.menuIndex,
    0,
    "the title's highlight rests on DESCEND before the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "playing");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "confirming DESCEND leaves the game on the playing screen (specs/ui.md)",
  );
});
