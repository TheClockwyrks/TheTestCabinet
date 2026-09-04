// economy/wave-clear-bonus — clearing wave w pays 20 + 5w into the money.
//
// `specs/economy.md`'s income table: the Wave-clear bonus line pays
// `WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * w`, "which is `20 + 5w` for wave
// `w`", "On the frame wave `w` clears". `specs/waves.md` fixes when that frame
// is: "A wave clears on the frame in which its last live unit dies or leaks with
// none of it left to release", and "On that frame the wave-clear bonus and its
// score are paid".
//
// THREE WAVES, BECAUSE ONE READING CANNOT TELL A LINE FROM A CONSTANT. Wave `1`
// pays `25`, wave `7` pays `55`, and wave `19` pays `115`. A build that pays a
// flat bonus reads the same figure three times; one that pays `5w` without the
// base, or the base without the `5w`, or pays for the wave it is about to open
// rather than the one just cleared, lands on a different figure at every one of
// the three. The three are spread across the run — its first wave, an early one,
// and its last ordinary one — so no build could be special-casing all of them.
//
// WHY THE MODE IS DEEP POCKETS. `specs/economy.md` pays interest "On entering a
// build phase between waves", which is the very transition a cleared wave opens,
// so in a mode that pays interest this reading would be the clear bonus plus a
// percentage of what the bonus left — and a build with a perfect clear bonus and
// a broken interest would fail this item instead of the interest one. Deep
// Pockets is the mode `specs/modes.md` gives `interest` `no`, and
// `specs/economy.md` says a mode whose interest reads false "pays none at all".
// So the transition pays exactly one thing here, and the figure this point reads
// is the figure the item names. Every other rule of the game is unchanged: "Every
// mode plays the same game ... the same economy" (`specs/modes.md`), and Deep
// Pockets runs the standard twenty-wave progression, so waves `1`, `7` and `19`
// are all ordinary waves that clear into a build phase.
//
// THE MONEY IS POSED TO `0` BEFORE EACH CLEAR, so the balance after the clear is
// the payment itself and the reviewer reads the figure rather than a difference
// of two large numbers.
//
// EACH WAVE IS CLEARED BY A LEAK, which pays nothing of its own
// (`economy/payment.ts`), so the clear's own figure is the only thing the money
// can move by. Each leg opens from `reset`, which restores every declared field
// to its title-screen value, so a leg is a fresh run rather than a clear posed on
// top of the last one's build phase.
//
// WHAT EVERY WRONG MODEL READS. A build paying a flat `20` reads `(20, 20, 20)`;
// one paying `5w` alone reads `(5, 35, 95)`; one paying `20 + 5(w + 1)` reads
// `(30, 60, 120)`; one paying nothing reads `(0, 0, 0)`. None is
// `(25, 55, 115)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { WAVE_CLEAR_BASE, WAVE_CLEAR_PER_WAVE } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./payment";

/** The waves whose clears are read: the run's first, an early one, its last ordinary one. */
const WAVES: readonly number[] = [1, 7, 19];

/**
 * What clearing wave `w` must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: money is a whole number
 * and `specs/economy.md` fixes the figure exactly, so the assertion is equality.
 */
function expectedBonus(wave: number): number {
  return WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * wave;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/**
 * Open a fresh Deep Pockets run at the end of wave `wave` with an empty purse,
 * leak its last unit away, and hand back what the clear paid.
 */
async function clearFor(
  wave: number,
): Promise<{ paid: number; cleared: boolean }> {
  await h.debug.reset();
  await startRun(h, "deeppockets");
  await poseWaveEnd(h, wave);
  await h.debug.setMoney(0);
  await poseLeaker(h);

  const before = (await h.snapshot()).money;
  const cleared = await runUntilLeaked(h);
  return { paid: (await h.snapshot()).money - before, cleared };
}

it("pays 20 + 5w into the money on the frame wave w clears", async () => {
  const paid: number[] = [];
  for (const wave of WAVES) {
    const leg = await clearFor(wave);
    assertTrue(
      leg.cleared,
      `precondition: wave ${wave}'s last unit left the floor`,
    );
    paid.push(leg.paid);
  }

  await captureStill(h, "bonus");
  for (const [index, wave] of WAVES.entries()) {
    assertEqual(
      paid[index],
      expectedBonus(wave),
      `the money clearing wave ${wave} paid`,
    );
  }
});
