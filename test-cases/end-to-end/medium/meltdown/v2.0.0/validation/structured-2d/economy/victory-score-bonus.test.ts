// Meltdown — economy/victory-score-bonus: victory scores 250 for every life left.
//
// `specs/economy.md`'s score table: "Victory" is worth
// `SCORE_VICTORY_PER_LIFE * lives`, "which is `250` per life remaining".
// `specs/waves.md` fixes when a run is won: a wave clears, and "If the wave
// cleared was Wave `N`, the run ends in victory, and the victory screen opens" —
// where `N` is the wave count `specs/modes.md` gives the mode and difficulty,
// twenty for Containment Medium. So the victory is reached the way the run
// reaches it, by clearing the final wave, because `setScreen` runs no entry
// effect (`specs/instrumentation.md`).
//
// WHY THIS POINT READS A DIFFERENCE RATHER THAN A TOTAL. A victory pays two
// things at once: `specs/waves.md` pays the wave-clear bonus and its score on the
// very frame the final wave clears, and the victory bonus lands on top. A point
// asserting the total would be asserting the clear score too, so a build with a
// correct victory bonus and a wrong `100 * w` would fail this item as well as
// `economy.wave-clear-score`, and a grade could no longer say which one the build
// got wrong. Two runs are won instead, identical in every way but the lives in
// hand: the same mode, the same final wave, the same last unit leaked away the
// same way. The clear score is therefore the same in both, whatever this build
// pays for it, and the DIFFERENCE between what the two victories scored is
// `SCORE_VICTORY_PER_LIFE` for each of the two extra lives — the `500` this point
// names.
//
// WHY THE DIFFERENCE IS TWO LIVES AND NOT ONE. A one-life difference would read
// `250`, which is also what a build scoring a flat victory bonus of `250` reads
// on the first leg and `250` on the second, difference `0` — indistinguishable
// from several other errors only by the sign. Two lives put the figure at `500`,
// which no per-run constant can produce.
//
// WHY THE LIVES POSED ARE `8` AND `10`. Neither is a boundary a build could be
// treating specially: both are well below `START_LIVES` (`20`) and well above the
// `0` that ends a run in loss. The final wave is cleared by a LEAK, which costs
// lives (`specs/surge.md`), and both counts leave enough in hand that the run is
// still won afterward however large that cost is — `specs/waves.md` is explicit
// that a leak taking the lives to `0` on the final wave "ends the run in loss,
// not in victory", which is a different item's requirement and must not be
// reached here. Because the same one leak is taken in both legs, whatever it
// costs cancels out of the difference, and the two victories are exactly two
// lives apart.
//
// THE FINAL WAVE IS THE CASE'S OWN FIGURE, derived from `MODE_TABLE` and
// `DIFFICULTY_TABLE` rather than read off the snapshot, so a build that derives
// its own wave count wrongly fails the `modes` item that decides that and this
// point still clears the wave `specs/modes.md` says is last.
//
// THE CLEAR IS A LEAK RATHER THAN A KILL, so no bounty enters either reading
// (`economy/payment.ts`), and each leg opens from `startRun`, which resets first
// and restores the score to `0` along with every other declared field — so the
// second leg is a second run rather than a second victory posed on top of the
// first one's victory screen.
//
// WHAT EVERY WRONG MODEL READS. A build that pays a flat victory bonus reads `0`;
// one that pays per life STARTED with rather than per life remaining reads `0`,
// since both runs start from the same posed count only in the sense that neither
// uses it; one that pays no victory bonus reads `0`; one that pays for the lives
// LOST reads `-500`. The distinguishing figure is `500`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIFFICULTY_TABLE,
  MODE_TABLE,
  SCORE_VICTORY_PER_LIFE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type Screen,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./payment";

/** The wave whose clear ends a Containment Medium run (`specs/modes.md`). */
const FINAL_WAVE =
  MODE_TABLE.containment.waveCount ?? DIFFICULTY_TABLE.medium.waves;

/** The two life counts the two runs are won with: ordinary counts, two apart. */
const FEWER_LIVES = 8;
const MORE_LIVES = 10;

/**
 * What those two further lives must add to the second victory's score.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/economy.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_VICTORY_PER_LIFE * (MORE_LIVES - FEWER_LIVES);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Open a fresh run at the end of its final wave with `lives` in hand, leak that
 * wave's last unit away, and hand back what the victory scored.
 */
async function winWith(
  lives: number,
): Promise<{ scored: number; screen: Screen }> {
  startRun(h);
  poseWaveEnd(h, FINAL_WAVE);
  h.debug.setLives(lives);
  h.debug.setScore(0);
  poseLeaker(h);

  const before = h.snapshot().score;
  await runUntilLeaked(h);
  const after = h.snapshot();
  return { scored: after.score - before, screen: after.screen };
}

it("scores 250 for every life still in hand when the last wave clears", async () => {
  const onFewer = await winWith(FEWER_LIVES);
  const onMore = await winWith(MORE_LIVES);

  captureStill(h, "victory");

  assertEqual(
    onFewer.screen,
    "victory",
    `precondition: the run was won with ${String(FEWER_LIVES)} lives in hand`,
  );
  assertEqual(
    onMore.screen,
    "victory",
    `precondition: the run was won with ${String(MORE_LIVES)} lives in hand`,
  );
  assertEqual(
    onMore.scored - onFewer.scored,
    EXPECTED,
    "the score two further lives added to the victory",
  );
});
