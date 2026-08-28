// Refract — reaching the title states the screens checks start from. PRIVATE to
// the screens/ category.
//
// Every check in this directory presses real keys at a menu and reads where the
// game went, because the menu keys themselves are the subject here — the one
// place the suite drives the title by key rather than through `startMode`
// (specs/ui.md "Menu navigation", specs/controls.md "Actions and bindings").
// These helpers only ARRANGE the title state a check starts from, and they fail
// on the precondition they could not pose, with the requirement named, so a
// check never grades a scenario it was not in.

import { assertEqual } from "../assert";
import { fireAction, type Harness } from "../harness";

/**
 * Put the title highlight on the last item (`TITLE_ITEMS[2]`, HOW TO PLAY) by
 * two plain `down` presses from the arrival index `0` — never by wrapping, so a
 * check about wrapping does not lean on the behaviour it grades.
 */
export async function poseLastTitleItem(h: Harness): Promise<void> {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex is 0 on arriving at the title");
  await fireAction(h, "down");
  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "two down presses pose the last title item",
  );
}

/** Open the how-to screen from the title, with keys, as a player does. */
export async function reachHowto(h: Harness): Promise<void> {
  await poseLastTitleItem(h);
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "confirming HOW TO PLAY opens the how-to screen",
  );
}
