// saucer/a-restart-clears-the-saucer — RESTART begins a game with an empty sky.
//
// THE RULE. `specs/ui.md`, the pause menu: `RESTART` "Opens a new game, as
// `specs/progression.md` states, and moves to `playing`", and
// `specs/progression.md` opens a game with `START_LIVES` (`3`) ships on a field
// carrying the new wave and nothing else. A saucer left flying across a restart is
// a hostile the fresh game never spawned, firing at a ship on its first second.
//
// WHY THIS POINT EXISTS AT ALL. It is the item `changelog.md` adds in v3.0.0.
// Nothing graded the restart's effect on the saucer, so a build that rebuilt its
// world and left the craft flying passed every other saucer point while handing a
// fresh wave 1 an enemy already shooting.
//
// ITS THREE ANTI-FALSE-POSITIVE DEVICES, EACH LOAD-BEARING.
//
//  1. THE SAUCER IS READ AT THE PAUSE AS WELL AS AFTER THE RESTART. A visit is
//     finite — `SAUCER_LIFETIME` is `12` s — so a craft that left of its own
//     accord leaves a field indistinguishable from one the restart cleared.
//     Requiring it up on the tick before is what makes its absence afterwards the
//     restart's doing.
//  2. A LIFE IS SPENT FIRST. A game that merely RESUMED also reports three ships,
//     unless one has been spent — so `setLives(2)` before the pause is what makes
//     `lives === START_LIVES` afterwards separate a restart from a resume. The
//     screen reading `playing` is what separates it from a quit to the title.
//  3. THE PAUSE SELECTION IS ADDRESSED, NEVER COUNTED. `specs/ui.md` fixes the
//     ORDER of the pause entries — `RESUME`, `RESTART`, `QUIT TO MENU` — but not
//     which one the menu opens on, so a fixed number of `down` presses would land
//     on a different entry in a build that opens elsewhere. `setMenuIndex(1)`
//     names the entry the specification's order fixes, and it is also the direct
//     route: how the highlight MOVES is `controls/menu-down`'s requirement, not
//     this one's.
//
// THE CONFIRM IS THE REAL KEY. `specs/ui.md` puts the menu on the registered
// `confirm` action, and nothing on the debug surface takes a menu entry — so the
// restart has to be driven the way a player drives it, through one press.
//
// THE ARRIVAL IS SHUT OFF FOR THE WHOLE SCENARIO. `startPlaying` leaves
// `saucerSpawning` off, so the only craft that can be in the sky afterwards is the
// one that was up at the pause: a build that cleared it correctly cannot be
// rescued by the game's own cadence putting another one there, and a build that
// kept it cannot hide behind one.
//
// THE FIELD IS READ TWICE AFTER THE RESTART — on the instant it begins and two
// seconds in — because a build that clears its world one frame late, or that
// re-adopts the craft it was holding, shows up on the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../../src/constants";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureReplay,
  createHarness,
  poseSaucer,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";

/** Where the craft is put up before the pause: clear of the star and the ship. */
const SAUCER_X = 400;
const SAUCER_Y = 200;

/** The ships left when the game is paused: one has been spent. See device 2. */
const SPENT_LIVES = START_LIVES - 1;

/** The entry `specs/ui.md` fixes as second on the pause menu. */
const RESTART_INDEX = PAUSE_ITEMS.indexOf("RESTART");

/** How long the restarted game is watched, in seconds of game time. */
const SETTLE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a game with no saucer, on the playing screen, with START_LIVES ships", async () => {
  startPlaying(h);
  h.debug.setLives(SPENT_LIVES);
  poseSaucer(h, SAUCER_X, SAUCER_Y);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART_INDEX);

  const paused = h.snapshot();
  assertNotNull(
    paused.saucer,
    "the saucer slot at the pause — the craft has to be up for its absence " +
      "after the restart to be the restart's doing",
  );
  assertEqual(
    paused.lives,
    SPENT_LIVES,
    "ships left at the pause — one has been spent, so a game that merely " +
      "RESUMED could not report START_LIVES afterwards (specs/progression.md)",
  );

  const started = await captureReplay(h, "restart", async () => {
    await tapAction(h, "confirm");
    const opened = h.snapshot();
    await h.advanceSeconds(SETTLE);
    return opened;
  });
  const settled = h.snapshot();

  assertEqual(
    started.screen,
    "playing",
    `the screen after confirming ${JSON.stringify(PAUSE_ITEMS[RESTART_INDEX])} ` +
      "on the pause menu — RESTART opens a new game and moves to playing " +
      "(specs/ui.md)",
  );
  assertNull(
    started.saucer,
    "the saucer slot the instant the restarted game began — a new game opens " +
      "on its wave and nothing else (specs/progression.md)",
  );
  assertEqual(
    started.lives,
    START_LIVES,
    `ships the restarted game began with, against START_LIVES ` +
      `(${START_LIVES}) — a resume would have left the ${SPENT_LIVES} the ` +
      "paused game had (specs/progression.md)",
  );
  assertNull(
    settled.saucer,
    `the saucer slot ${SETTLE} s into the restarted game, with the game's own ` +
      "arrival shut off — the craft that was up at the pause has not been " +
      "re-adopted (specs/progression.md)",
  );
  assertEqual(
    settled.screen,
    "playing",
    `the screen ${SETTLE} s into the restarted game (specs/ui.md)`,
  );
});
