// lives/starts-with-three — a game opened from the title has three ships.
//
// THE RULE. `specs/progression.md`: "A new game begins with `START_LIVES` (`3`)
// ships, counting the one being flown." `specs/instrumentation.md` says the same
// of the count itself — "`lives` counts every ship left including the one being
// flown, so a fresh game reports `3`" — so the figure read here is the total,
// never the `lives - 1` glyphs the HUD draws (`presentation/hud-lives-are-drawn`
// is the item that reads those).
//
// THE ROUTE IS THE PLAYER'S, BECAUSE NO POSE CAN PRODUCE ONE. `setLives` sets the
// counter and opens nothing, so a check that posed `3` and read `3` would grade
// the pose. What opens a new game is confirming `PLAY` on the title
// (`specs/ui.md`), and that is what is driven here: `reset()` to the title, the
// highlight on the first entry, and a real key at the event target the engine
// listens on.
//
// AND THE COUNTER IS POSED TO ONE FIRST, WHICH IS WHAT MAKES THE READING DECIDE
// ANYTHING. `reset()` itself restores `lives` to `START_LIVES`
// (`specs/instrumentation.md`), so a build whose `PLAY` entry did nothing at all
// would still report `3` and pass. Posing `1` into the title state makes every
// wrong model read a different number: a build that opens a new game reads `3`, a
// build that merely changed screen reads `1`, and a build that opens a game with
// some other complement reads that.
//
// WHAT THIS DOES NOT DECIDE. That confirming reaches the `playing` screen at all,
// which is `screens/play-starts-a-game`'s; the opening wave, which is
// `waves/wave-one-spawns-four`'s; and the opening score, which is `scoring`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, START_LIVES, TITLE_ITEMS } from "../../src/constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";

/** The confirm key the title menu is driven with (`specs/controls.md`). */
const CONFIRM = "Enter";

/** The title menu's first entry, `PLAY` (`specs/ui.md`). */
const PLAY_ENTRY = 0;

/**
 * The count posed into the title state, so the reading cannot pass on a build
 * whose `PLAY` did nothing.
 *
 * Any value other than `START_LIVES` would do; one ship is the furthest a run can
 * be from a fresh game while still being a run.
 */
const POSED_LIVES = 1;

/**
 * The ticks the opening is given, past the two `tap` itself runs.
 *
 * A build is free to open its game on the tick the key lands or on the next; a
 * fifth of a second is many ticks either way, and the opening wave's rocks are
 * spawned at least `WAVE_MIN_SHIP_DIST` (`300`) from the ship
 * (`specs/progression.md`), so nothing can reach the ship inside it.
 */
const OPENING_TICKS = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with three ships, counting the one in play", async () => {
  assertContains(
    BINDINGS.confirm.keys,
    CONFIRM,
    "the keys specs/controls.md binds the `confirm` action to",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title menu's first entry, which specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(PLAY_ENTRY);

  await h.tap(CONFIRM);
  await h.advance(OPENING_TICKS);
  const opened = h.snapshot();
  captureStill(h, "opening");

  assertEqual(
    opened.lives,
    START_LIVES,
    `the ships a game opened from the title has, counting the one being flown, ` +
      `with the title state posed to ${POSED_LIVES} first so a build that ` +
      `opened no game reads that instead (specs/progression.md)`,
  );
});
