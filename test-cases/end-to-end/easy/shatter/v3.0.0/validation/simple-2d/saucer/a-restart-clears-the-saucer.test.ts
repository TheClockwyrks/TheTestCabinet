// saucer/a-restart-clears-the-saucer — RESTART begins a game with no saucer on
// the field.
//
// THE RULE. `specs/ui.md` gives the pause menu three entries in a fixed order —
// `RESUME`, `RESTART`, `QUIT TO MENU` — and says `RESTART` "opens a new game, as
// `specs/progression.md` states, and moves to `playing`". `specs/progression.md`
// says what a new game is: `START_LIVES` ships, a score of `0`, wave `1`, and a
// field "cleared of everything the previous game left: no rock, no bullet, no
// saucer bullet, AND NO SAUCER".
//
// WHY THIS ITEM EXISTS AT ALL (see `changelog.md`). Nothing else in this case
// grades that clause. A build that rebuilds its world on a restart but leaves the
// saucer flying passes every other item in this group, and hands a fresh wave 1
// an enemy that is already up and already firing.
//
// THREE DEVICES, AND EACH ONE STOPS A FALSE POSITIVE:
//
//   1. THE SAUCER IS READ AT THE PAUSE, not only after the restart. A visit is
//      finite — `specs/saucer.md` gives it twelve seconds — so a saucer that left
//      of its own accord leaves a field indistinguishable from one the restart
//      cleared. Requiring it up on the tick before the confirm is what makes its
//      absence afterwards the restart's doing. It is posed with all three
//      faculties off, so it cannot travel, weave or fire its way out of the
//      reading, and the pause itself advances nothing (`specs/ui.md`).
//   2. A LIFE IS SPENT FIRST. A game that merely RESUMED also reports three ships
//      unless one has been spent, so `lives` back at `START_LIVES` is what
//      separates a restart from a resume — and `screen` reading `playing` is what
//      separates it from a quit to the title.
//   3. THE SELECTION IS ADDRESSED, NEVER COUNTED. `specs/ui.md` fixes the ORDER
//      of the pause entries but not which one the menu opens on, so a fixed
//      number of menu presses is a requirement the specification never made.
//      `setMenuIndex(1)` names `RESTART` by its place in that order, and it is
//      also the more direct route: which keys move a menu selection is
//      `controls/menu-down`'s requirement, not this item's.
//
// THE SCREEN IS POSED RATHER THAN PAUSED INTO, for the same reason: that `P` and
// `Escape` reach the pause screen is `controls/pause-p`'s and
// `controls/pause-escape`'s. What is driven with a real key is the one thing this
// item is about — confirming the highlighted entry. The key is the one bound to
// `confirm`, so this check keeps working under either variant's bindings, and it
// is `Enter` rather than `Space`, which `specs/controls.md` also gives the gun.
//
// THE SAUCER IS READ TWICE AFTER THE RESTART: on the tick the new game begins,
// and two seconds in. The second reading is what catches a build that clears the
// field and then hands the new game the saucer it was holding. Two seconds is
// well inside `SAUCER_FIRST_DELAY` (`18` s), so nothing a new game's own spawner
// does can reach it however the restart leaves the arrival gate.
//
// THE READINGS THE RESTART DECIDES ARE ALL TAKEN ON ITS OWN TICK. The new game's
// wave loop and the ship's contact test may be live from that tick on, so a rock
// reaching the ship two seconds later would cost a life the check never meant to
// read — which is why `lives` is read at the restart and only the saucer is read
// afterwards.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  tapAction,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the saucer stands while the game is paused: quiet ground, far from the star. */
const STAND = { x: 320, y: 620 };

/** The ships left when the pause is opened: one spent, so a resume cannot read three. */
const SPENT_LIVES = START_LIVES - 1;

/** `RESTART`'s place in the order `specs/ui.md` fixes for the pause menu. */
const RESTART_ENTRY = 1;

/** The two seconds of the new game the saucer must still be absent through. */
const WATCH_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with no saucer when RESTART is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[RESTART_ENTRY],
    "RESTART",
    "the pause menu's second entry, which specs/ui.md fixes",
  );

  startPlaying(h);
  h.debug.setLives(SPENT_LIVES);
  poseVisit(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART_ENTRY);

  const restarted = await captureReplay(h, "restart", async () => {
    const paused = h.snapshot();
    theSaucer(paused, "the saucer up when the pause menu was opened");
    assertEqual(
      paused.screen,
      "paused",
      "the screen the pause menu was read on",
    );
    assertEqual(
      paused.lives,
      SPENT_LIVES,
      "the ships left when the pause was opened",
    );

    await tapAction(h, "confirm");
    const began = h.snapshot();
    await h.advance(WATCH_TICKS);
    return { began, later: h.snapshot() };
  });

  assertEqual(
    restarted.began.screen,
    "playing",
    "the screen RESTART opened from the pause menu (specs/ui.md)",
  );
  assertEqual(
    restarted.began.lives,
    START_LIVES,
    "the ships a new game begins with, against the one that was spent " +
      "(specs/progression.md)",
  );
  assertNull(
    restarted.began.saucer,
    "the saucer on the field the instant the restarted game began " +
      "(specs/progression.md)",
  );
  assertNull(
    restarted.later.saucer,
    "the saucer on the field two seconds into the restarted game " +
      "(specs/progression.md)",
  );
});
