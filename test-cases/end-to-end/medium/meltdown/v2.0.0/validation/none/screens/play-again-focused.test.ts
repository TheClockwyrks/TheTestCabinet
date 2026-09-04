// Meltdown — screens/play-again-focused: PLAY AGAIN is focused the moment an end
// screen opens.
//
// THE RULE. `specs/screens.md`, for `victory` and `gameover` together: both "open
// with the highlight on `PLAY AGAIN`, at row `0`."
// `specs/instrumentation.md` reports the highlighted row as `menuIndex`.
//
// WHY THE SCREEN IS REACHED AND NOT POSED. This is an ENTRY EFFECT: the claim is
// about what the screen holds THE MOMENT IT OPENS. `setScreen` "sets that field
// alone and runs no entry effect", and it explicitly "resets no menu index"
// (`specs/instrumentation.md`) — so a posed end screen could never show this, and a
// build that focuses the right row would fail while a build that focuses none would
// pass. The two transitions are therefore driven through the game's own rules.
//
// HOW EACH END IS REACHED, AND WHY EACH IS THE CHEAPEST HONEST ROUTE.
//
//   GAME OVER, on Sudden Death. `specs/modes.md` puts one life on that row and
//   `specs/surge.md` costs a Mote's leak one life, so the single cheapest leak in
//   the game takes the lives to `0`, which `specs/waves.md` says "ends the run at
//   once ... and opens the game-over screen". One Mote is posed two tiles short of
//   its exhaust and walks out under its own power.
//
//   VICTORY, on The Hundred. `specs/waves.md` clears a wave "on the frame in which
//   its last live unit dies or leaks with none of it left to release", and clearing
//   the run's last wave opens the victory screen; The Hundred's one onslaught IS its
//   last wave (`specs/modes.md`), and its twenty lives absorb the leak with room to
//   spare. So the end-of-wave shape is posed — nothing left to release, one unit on
//   the floor — and the clear itself is left to the game.
//
// THE HIGHLIGHT IS PUT SOMEWHERE ELSE FIRST, on row `1`, so that reading `0`
// afterwards can only have come from the transition. It is posed rather than
// asserted, because a build that folds the index while no menu is on screen is not
// in breach of anything and must not fail here; what the posed value was is
// reported in the failure instead.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the transitions happen at all is
// `waves.victory-on-clearing-the-final-wave`'s and `waves.game-over-at-zero-lives`'s
// reading, and what each screen DRAWS is `screens.victory-screen`'s and
// `screens.gameover-screen`'s. This one reads the highlight the screen opens on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  COLS,
  ENDING_ITEMS,
  tileCX,
  tileCY,
  type ModeId,
  type Screen,
} from "../constants";
import { LEFT_LANE_ROW } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/** Where PLAY AGAIN sits on both end screens (`specs/screens.md`). */
const PLAY_AGAIN_ROW = 0;

/**
 * Where the highlight is put before the transition.
 *
 * Any row but the one expected, so a build that left the index where it stood
 * reads `1`. `ENDING_ITEMS` has two rows, so this is the only other one.
 */
const STALE_ROW = ENDING_ITEMS.length - 1;

/**
 * Where the last unit is posed: two tiles short of the right exhaust, on the left
 * corridor's own row.
 *
 * Geometry, not a tolerance. Far enough that the unit is genuinely on the floor and
 * walking when the drive begins, near enough that it arrives in a fraction of a
 * second of game time.
 */
const LEAK_TILE = { col: COLS - 3, row: LEFT_LANE_ROW };

/**
 * How long the Mote is given to cover those two tiles.
 *
 * It covers `60` logical units a second (`specs/surge.md`) and two tiles is `38`,
 * so it arrives in under two thirds of a second. A ceiling on a hung build rather
 * than a bound on anything asserted, which is why it is loose.
 */
const LEAK_WINDOW = 2.0;

/** The two ends of a run, and the mode each is reached on. */
const ENDINGS: readonly { screen: Screen; mode: ModeId }[] = [
  { screen: "gameover", mode: "suddendeath" },
  { screen: "victory", mode: "hundred" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens both end screens with the highlight on PLAY AGAIN", async () => {
  const { debug } = h;
  for (const { screen, mode } of ENDINGS) {
    // The last unit of a wave with nothing left to release, walking out.
    await startRun(h, mode);
    await debug.setPhase("wave");
    await debug.setBuildTimer(0);
    await debug.setWavePending(0);
    const mote = await poseWalker(h, "mote", "left");
    await debug.setUnitPosition(
      mote,
      tileCX(LEAK_TILE.col),
      tileCY(LEAK_TILE.row),
    );
    await debug.setMenuIndex(STALE_ROW);

    const posed = await h.snapshot();
    const where = `${screen}, reached on ${mode} with the highlight left on row ${posed.menuIndex}`;

    const ended = await h.until((snapshot) => snapshot.surge.length === 0, {
      maxFrames: framesFor(LEAK_WINDOW),
    });
    await captureStill(h, "focused");

    assertEqual(ended.hit, true, `the Mote reached its exhaust, for ${where}`);
    assertEqual(
      ended.snapshot.screen,
      screen,
      `the screen the last unit going opened, for ${where}`,
    );
    assertEqual(
      ended.snapshot.menuIndex,
      PLAY_AGAIN_ROW,
      `the highlighted row ${screen} opened on, which ${ENDING_ITEMS[PLAY_AGAIN_ROW]} sits at (${where})`,
    );
  }
});
