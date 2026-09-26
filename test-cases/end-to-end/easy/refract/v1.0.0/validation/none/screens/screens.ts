// Refract — reaching the title states the screens checks start from. PRIVATE to
// the screens/ category.
//
// A check whose subject is a menu KEY presses that key and reads where the game
// went. Everything it needs on the way there is posed instead, through the
// surface's single-field operations (specs/instrumentation.md): a build with a
// broken `down` binding must fail `screens/title-down` and pass the how-to
// screen's own points, so the how-to screen is reached with `setScreen` rather
// than by walking the menu that another point decides.
//
// These helpers only ARRANGE the state a check starts from, and they fail on the
// precondition they could not pose, with the requirement named, so a check never
// grades a scenario it was not in.

import { assertEqual } from "../assert";
import { type Harness } from "../harness";

/**
 * Put the title highlight on the last item (`TITLE_ITEMS[2]`, HOW TO PLAY),
 * through the pose that sets `menuIndex` and nothing else — never by pressing
 * the `down` binding, which is `screens/title-down`'s subject.
 */
export async function poseLastTitleItem(h: Harness): Promise<void> {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex is 0 on arriving at the title");
  await h.debug.setMenuIndex(2);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "the pose puts the highlight on the last title item",
  );
}

/**
 * Open the how-to screen, through the pose that sets `screen` and nothing else.
 * Confirming HOW TO PLAY from the title is `screens/title-howto`'s subject.
 */
export async function reachHowto(h: Harness): Promise<void> {
  await h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the how-to screen is posed",
  );
}
