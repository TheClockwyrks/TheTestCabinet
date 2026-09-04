// Meltdown — economy/score-rises-by-the-bounty: a kill scores the killed unit's
// bounty.
//
// `specs/economy.md`'s score table: "A kill" is worth "The killed unit's bounty,
// the same figure the money is paid". `specs/surge.md`'s roster gives a Mote's
// bounty as `3`, which `SURGE_DEFS` restates.
//
// THIS IS THE SCORE, AND ONLY THE SCORE. The money side of the same event is
// `economy.bounty-paid-on-a-kill`'s, so this point reads the score across the
// death and asserts nothing about the balance: a build that banks the bounty into
// the money and forgets the score fails here and passes there, which is what
// tells the two halves of the line apart.
//
// THE FLOOR HOLDS ONE GUN AND ONE MARK, arranged as `economy/payment.ts`
// describes: the Arc's heat cannot move, and the mark holds its tile with one hp
// so it dies to the shot rather than leaking. Nothing else stands on the floor
// and the score is posed to `0` by `startRun`, so the only event that can move
// the score is the one death.
//
// THE PHASE IS `building`. A wave clears only while the phase is `wave`
// (`specs/waves.md`), and clearing one scores `100 * w` — a hundred-fold figure
// that would swamp this one. Driven in a build phase, the death is the only thing
// the score can move by.
//
// WHAT EVERY WRONG MODEL READS. A build that scores nothing for a kill reads `0`;
// one that scores the wave-clear figure reads `100`; one that scores the unit's
// maximum hp reads `1`, since the mark is posed at one hp; one that scores a flat
// point per kill reads `1`. Each is a different number from `3`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseGun, poseMark, runUntilGone } from "./payment";

/** What killing a Mote must add to the score. */
const EXPECTED = SURGE_DEFS.mote.bounty;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds 3 to the score for a killed Mote", async () => {
  startRun(h);
  poseGun(h);
  poseMark(h, "mote");

  const before = h.snapshot().score;
  const died = await runUntilGone(h);

  captureStill(h, "score");
  const after = h.snapshot().score;

  assertTrue(died, "precondition: the Arc's shot killed the Mote");
  assertEqual(after - before, EXPECTED, "the score a killed Mote paid");
});
