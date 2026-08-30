// Cascade — posing one of the four screens. PRIVATE to the screens/ category.
//
// `openTable` in the shared harness poses the `playing` screen and nothing else,
// because that is the screen every other group works on. The three helpers here
// are its siblings for the screens this group is about, built out of the same
// three atomic operations and in the same order: `reset()`, `setScreen(...)`,
// `clearTable()` (`specs/instrumentation.md`).
//
// WHY `setScreen` RATHER THAN THE ROUTE A PLAYER TAKES. A check about what the
// how-to screen draws must not fail because the title's `HOW TO PLAY` control is
// broken — `screens/title-how-to-opens` is the item that grades that control. So
// every check here that is NOT about a control poses its screen directly, and
// the ones that ARE about a control pose the screen the control lives on and then
// press it.
//
// WHY THE TABLE IS CLEARED. `specs/screens.md` lets the table show behind the
// title and how-to screens, "dimmed or otherwise quieted", so what sits behind
// the copy is the build's. Clearing it is the isolation rule: the world holds
// only what the requirement concerns, and none of these requirements concerns a
// card. It also fixes what the captured frame shows, so two runs of the same
// check leave comparable evidence.
//
// NONE OF THEM ASSERTS A VERDICT. They arrange; the check decides.

import { type Harness } from "../harness";

/** The title screen, over an empty table. */
export async function openTitle(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.clearTable();
}

/** The how-to screen, over an empty table. */
export async function openHowto(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  await h.debug.clearTable();
}

/**
 * The `won` screen, over an empty table, with nothing in flight and nothing
 * painted.
 *
 * `reset` already leaves all three of those (`specs/instrumentation.md`), so
 * this is `openTitle` with a different screen. It is the direct route to the one
 * requirement `specs/victory.md` states about the screen rather than about the
 * cascade: "A press anywhere, during the cascade or after it, deals a fresh game
 * and moves to the `playing` screen." A check whose subject IS the cascade wins
 * the game through `startCascade` instead.
 */
export async function openWon(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("won");
  await h.debug.clearTable();
}
