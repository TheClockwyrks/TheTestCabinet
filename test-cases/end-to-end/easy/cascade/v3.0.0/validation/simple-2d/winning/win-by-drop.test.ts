// winning/win-by-drop — dragging the last card home wins the game.
//
// THE RULE. specs/victory.md: the win "is reached by whatever move put the last
// card home, whether a released drop or a double click". specs/controls.md says
// what a released drop is and what it does: a gesture whose release lies farther
// than `DRAG_THRESHOLD` (`5`) from its press resolves the run in hand against the
// drop rectangles, and "an applied move is a move like any other, so ... a board it
// completes wins the game, as `specs/victory.md` states".
//
// So this point holds the build to the win being reachable BY THE GESTURE a player
// actually makes with a card. `winning/win-at-fifty-two` reaches the same win
// through `move`, which is the rule stated as a rule; here the same rule has to
// hold at the end of a real press, a real carry and a real release, and the
// companion point `winning/win-by-double-click` holds it for the other gesture.
// Three ways of arriving at one screen, and a build can lose any one of them on its
// own.
//
// THE RELEASE IS WHAT WINS, and the reading says so. The screen is read after the
// press and after every move of the carry, and it is still `playing` there: the run
// is in hand, out of its column, and no card has landed. It is read again straight
// after the release, with no frame advanced, and it is `won`. A build that sent the
// card home on the PRESS — or that resolved the drop from a stale pointer sample
// before the release arrived — reads `won` on the first of those and fails naming
// the frame it jumped.
//
// AND THE CASCADE IS RUNNING WHEN THE GESTURE IS OVER. specs/victory.md: "The
// victory cascade begins with the win." A build that reaches the won screen and
// then sits there has not finished the move the player made, so the frames after
// the release are run and the launch counter has to have moved. HOW SOON it moves —
// on the cascade's very first frame — is `winning/cascade-begins-on-win`, and the
// cadence it keeps afterwards is `cascade/launch-cadence`; this point asks only
// that the cascade is under way, over a span generous enough that no build meeting
// either of those can fail it.
//
// THE GESTURE IS DRIVEN THROUGH THE DEBUG POINTER, which specs/instrumentation.md
// puts on exactly the player's path: "a posed press and a player's press are the
// same event to the game, and nothing is bypassed: the hit test, the grab rule, the
// drop rule, and the double-click rule all run exactly as they do for a player". A
// frame is run between the samples so the recording carries the carry rather than a
// single frame in which everything happened.
//
// THE TRAIL IS LEFT PAINTING. The recording covers the win and the cascade's first
// fractions of a second, nowhere near the recorder's image budget, and the trail is
// most of what there is to see; the `cascade` group's rule to gate it off is that
// group's, for its own much longer sweeps.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { DECK_SIZE, LAUNCH_INTERVAL } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  openTable,
  poseNearlyWon,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";

/**
 * Frames of the nearly-won board recorded before the gesture starts.
 *
 * Evidence rather than measurement: the reviewer sees the board the drop was made
 * on. Nothing happens over them, because Cascade has no autonomous entity and the
 * game moves only when this check moves it.
 */
const LEAD_FRAMES = 12;

/** How many samples the carry is broken into, one frame apart. */
const CARRY_STEPS = 4;

/**
 * How long the cascade is watched after the release, in frames.
 *
 * Two launch intervals (`LAUNCH_INTERVAL` is `0.18` s, specs/victory.md), so a
 * build that launches its first card anywhere inside the first interval has crossed
 * this span with a card away. It is deliberately far looser than the "on the
 * cascade's first frame" this case fixes elsewhere: what is being read here is that
 * the cascade is running at all.
 */
const CASCADE_FRAMES = framesFor(2 * LAUNCH_INTERVAL);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("wins the game on the release of a drag that lands the last card home", async () => {
  openTable(harness);
  const pending = poseNearlyWon(harness);

  const posed = harness.snapshot();
  assertLength(
    posed.foundations.flat(),
    DECK_SIZE - 1,
    "cards on the foundations before the drag, which leaves exactly one to " +
      "carry home (specs/victory.md)",
  );
  const from = pressPoint(
    posed,
    pending.from.pile,
    pending.from.index,
    pending.from.row,
  );
  const to = releasePoint(posed, "foundation", pending.foundation);

  const gesture = await captureReplay(harness, "drop", async () => {
    await harness.advance(LEAD_FRAMES);

    harness.debug.pointerDown(from.x, from.y);
    await harness.advance(1);
    for (let step = 1; step <= CARRY_STEPS; step += 1) {
      const t = step / CARRY_STEPS;
      harness.debug.pointerMove(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      );
      await harness.advance(1);
    }
    const carrying = harness.snapshot();

    harness.debug.pointerUp(to.x, to.y);
    const released = harness.snapshot();

    await harness.advance(CASCADE_FRAMES);
    return { carrying, released, after: harness.snapshot() };
  });

  assertEqual(
    gesture.carrying.screen,
    "playing",
    "the screen with the last card lifted and carried over its foundation but " +
      "not yet released, which is a gesture still in progress and no win " +
      "(specs/controls.md)",
  );
  assertEqual(
    gesture.released.screen,
    "won",
    "the screen the release of the drag left, read on the release itself with " +
      "no frame advanced (specs/victory.md)",
  );
  assertLength(
    gesture.released.foundations.flat(),
    DECK_SIZE,
    "cards on the foundations once the drop had landed (specs/victory.md)",
  );
  assertGreaterThanOrEqual(
    gesture.after.launched,
    1,
    `cards the cascade had launched ${String(CASCADE_FRAMES)} frames after ` +
      "the gesture ended, the cascade beginning with the win " +
      "(specs/victory.md)",
  );
});
