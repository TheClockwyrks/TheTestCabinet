// controls/pause-p — `KeyP` pauses a game in play.
//
// `specs/controls.md`'s bindings table gives the `pause` action TWO keys, `KeyP`
// and `Escape`. On `playing` the action has one meaning, Pause, which is the one
// this check drives; the other, resuming a paused game, is `screens/resume-p`'s.
// `specs/ui.md` names what pausing reaches: the `paused` screen, "Reached by
// pausing during live play."
//
// THE KEY IS DRIVEN, NOT THE ACTION. This is the whole reason the item exists.
// `harness.ts`'s `tapAction` drives an action's FIRST bound key — `KeyP` for
// `pause` — but nothing about a named action tells a build which keys reach it, so
// each binding is graded by pressing the key itself. `KeyP` is the pause key that
// pauses and NOTHING else: unlike `Escape` it drives no second action, so a build
// that resolved the double binding by always taking `back` still pauses here, and
// the two items separate that fault from a pause that was never wired up at all.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. Half a second is driven after the
// press with nothing down, so a build that pauses and immediately falls back to
// play is caught by a reading a check taken on the tick of the press alone would
// miss. Nothing else can move the screen across that stretch: `specs/ui.md` fixes
// that a paused game advances nothing at all.
//
// THE FIELD IS EMPTY AND QUIET. `startPlaying` leaves the wave loop, the saucer's
// arrival and the ship's lethal contact all off, so no game-over, no wave banner
// and no arrival can move the screen underneath the reading. The screen is read
// before the press as well, so a build that was never on `playing` fails naming
// that rather than the pause.
//
// WHAT THIS DOES NOT DECIDE. That the paused field is frozen
// (`screens/pause-freezes-the-field`), what the pause menu shows
// (`screens/pause-menu-entries`), where its entries lead
// (`screens/resume-returns-to-play` and the two beside it), and the other pause
// binding, which is `controls/pause-escape`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "KeyP";

/** The stretch of live play driven before the key goes down, in ticks. */
const LIVE_TICKS = ticksFor(0.25);

/**
 * The stretch driven after the press with nothing down, in ticks.
 *
 * Half a second, long enough that a build which pauses on the press and falls
 * straight back to play has done so by the end of it.
 */
const HELD_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the paused screen when KeyP is pressed during play", async () => {
  // Live play on the empty, quiet field: no wave loop, no saucer arrival and no
  // lethal contact, so nothing but the key can move the screen.
  startPlaying(h);

  await h.advance(LIVE_TICKS);
  const inPlay = h.snapshot().screen;

  await h.tap(KEY);
  const atPress = h.snapshot().screen;

  await h.advance(HELD_TICKS);
  const after = h.snapshot().screen;
  captureStill(h, "paused");

  assertEqual(
    inPlay,
    "playing",
    `the screen after ${String(LIVE_TICKS)} ticks of live play, before the ` +
      "key went down — the precondition this point is posed on " +
      "(specs/ui.md)",
  );
  assertEqual(
    atPress,
    "paused",
    `the screen on the tick ${KEY} was pressed while playing — KeyP drives ` +
      "the pause action (specs/controls.md), and pausing reaches the paused " +
      "screen (specs/ui.md)",
  );
  assertEqual(
    after,
    "paused",
    `the screen ${String(HELD_TICKS)} ticks after the press, with nothing ` +
      "down — one press opens the pause menu and leaves it open, and a paused " +
      "game advances nothing (specs/ui.md)",
  );
});
