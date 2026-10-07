// controls/pause-escape — `Escape` pauses a game in play.
//
// `specs/controls.md` binds `Escape` to the `pause` action AND to `back`, and
// settles which screens read each: "`back` is read on `title`, `howto`, `paused`,
// and `gameover`, and `pause` is read on `playing` and `paused`. `Escape` raises
// both on one frame, so a single `Escape` press on `playing` pauses once and a
// single `Escape` press on `paused` resumes once." `specs/ui.md` names what
// pausing reaches: the `paused` screen, "Reached by pausing during live play."
//
// THE DOUBLE BINDING IS THE POINT. A real `Escape` key event raises BOTH actions
// at once, so a build has to resolve them by the screen it is on rather than by
// the key. Driving the key rather than an action is what puts that in front of the
// build, and it is why this check reaches for the literal `KeyboardEvent.code`
// instead of `harness.ts`'s `tapAction`, which would raise one named action and
// ask the build nothing.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. Half a second is driven after the
// press with nothing down. A build that reads the one `Escape` edge as a pause AND
// as a back inside the same tick — or that re-reads it on the next — lands back on
// `playing`, which is exactly the failure the double binding invites, and a
// reading taken only on the tick of the press would miss it. Nothing else can move
// the screen across that stretch: `specs/ui.md` fixes that a paused game advances
// nothing at all.
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
// (`screens/resume-returns-to-play` and the two beside it), that `Escape` leaves a
// screen that is not in play (`controls/back-escape`), and the other pause
// binding, which is `controls/pause-p`'s.

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
const KEY = "Escape";

/** The stretch of live play driven before the key goes down, in ticks. */
const LIVE_TICKS = ticksFor(0.25);

/**
 * The stretch driven after the press with nothing down, in ticks.
 *
 * Half a second, long enough that a build reading the one `Escape` edge as a back
 * as well as a pause — or re-reading it on a later tick — has fallen off the
 * paused screen by the end of it.
 */
const HELD_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the paused screen when Escape is pressed during play", async () => {
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
    `the screen on the tick ${KEY} was pressed while playing — Escape drives ` +
      "pause while the game is being played (specs/controls.md), and pausing " +
      "reaches the paused screen (specs/ui.md)",
  );
  assertEqual(
    after,
    "paused",
    `the screen ${String(HELD_TICKS)} ticks after the press, with nothing ` +
      "down — one press opens the pause menu and leaves it open; Escape " +
      "drives back as well as pause, and the screen decides which applies " +
      "(specs/controls.md)",
  );
});
