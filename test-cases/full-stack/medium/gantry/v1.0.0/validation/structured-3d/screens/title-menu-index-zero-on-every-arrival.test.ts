// screens/title-menu-index-zero-on-every-arrival — arriving at the title screen
// puts the highlight on its first entry, whichever screen the player came from.
//
// specs/ui.md § Title: the title screen shows "the menu `TITLE_ITEMS` (`SITES`,
// `HOW TO PLAY`), with `menuIndex` `0` on arriving". § How to play: "`back`
// returns to `title` with `menuIndex` `0`." § Site select: "`back` returns to
// `title`." specs/controls.md binds `back` to `Escape`.
//
// The two arrivals are the two screens `back` reaches the title from, and both
// are driven here because the requirement is about ARRIVING rather than about
// either route: a build that resets the highlight on one route and carries a
// stale one in on the other leaves the player's cursor somewhere they did not
// put it, and the point is that it never does.
//
// EACH ARRIVAL IS MADE FROM A NONZERO HIGHLIGHT, which is what makes the reading
// mean anything: `menuIndex` is one field over every menu, so a title arriving at
// `0` because nothing ever moved it would be indistinguishable from one that
// resets. The select arrival moves the highlight with the real `down` action; the
// howto arrival poses it, because `howto` shows no menu for `down` to move.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("arrives at the title screen with the highlight on its first entry", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(0);
  await h.press("ArrowDown");
  await h.press("ArrowDown");
  await h.press("ArrowDown");
  const moved = (await h.snapshot()).menuIndex;

  await h.press("Escape");
  const fromSelect = await h.snapshot();

  await h.advance(1);
  await h.capture("title-highlight", "the title menu on arriving from select");

  await h.debug.setScreen("howto");
  await h.debug.setMenuIndex(1);
  await h.press("Escape");
  const fromHowto = await h.snapshot();

  assertGreaterThan(
    moved,
    0,
    "the select screen's highlight after three `down` presses, so the title's " +
      "`menuIndex` below is one the arrival reset (specs/ui.md § Site select)",
  );
  assertEqual(
    fromSelect.screen,
    "title",
    "the screen `back` returns to from `select` (specs/ui.md § Site select)",
  );
  assertEqual(
    fromSelect.menuIndex,
    0,
    "the highlight the title screen carries on arriving from `select` " +
      "(specs/ui.md § Title)",
  );
  assertEqual(
    fromHowto.screen,
    "title",
    "the screen `back` returns to from `howto` (specs/ui.md § How to play)",
  );
  assertEqual(
    fromHowto.menuIndex,
    0,
    "the highlight the title screen carries on arriving from `howto` " +
      "(specs/ui.md § How to play)",
  );
});
