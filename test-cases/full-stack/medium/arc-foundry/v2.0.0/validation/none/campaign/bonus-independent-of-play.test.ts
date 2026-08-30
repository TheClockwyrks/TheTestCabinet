// campaign/bonus-independent-of-play — the bonus is a function of the wave alone.
//
// specs/economy.md: "The wave-clear bonus is a function of the wave number and of
// nothing else. It does not scale with how many units the wave held, with how
// many of them the player killed, or with how much Charge the player has
// banked." And, twice over in the same file, "Charge never accrues interest."
//
// Three things could make it otherwise, and each is posed and read.
//
// THE BANK. The same wave is cleared from an empty bank and from a hoard, and
// the bonus is the difference across the clear either way.
//
// THE OUTCOME. The same wave is cleared once by killing both its units and once
// by letting both leak. A kill also pays a bounty, so the killed run's
// difference carries two Motes' bounty of `1` on top; taking that away leaves
// the bonus, which must be the leaked run's.
//
// INTEREST. A bank is left sitting across a minute of a build phase and read
// again.
//
// THE WAVE IS TWO MOTES, AND THE CHECK CHOSE THEM. `spawnUnit` puts the run into
// a live wave "whose spawn schedule is empty, so the units on the yard are
// exactly the ones `spawnUnit` released and nothing else arrives", and that wave
// "clears the ordinary way ... and clearing it pays the ordinary wave-clear
// bonus" (specs/instrumentation.md). So every run below clears a wave of exactly
// two Motes at the same posed wave number, which is what makes the four
// differences comparable at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { loadDef, waveBonus } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  releaseUnit,
  type Harness,
} from "../harness";
import { COLLECTOR, KILL_AT, LEAK_FROM, standGun } from "./runs";

/** The wave every run below is posed at, so every bonus compared is the same one. */
const WAVE = 6;

/** How many Motes each wave holds. */
const UNITS = 2;

/** Comfortably above what two Motes leaking costs. */
const INTEGRITY = 50;

/** Five seconds of the default clock: past two kills and two short walks. */
const SWEEP = 600;

/** A minute of simulation, in frames of the default clock. */
const IDLE = 60 * 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Clear a wave of two Motes by killing them, and hand back what Charge did. */
async function clearByKilling(bank: number): Promise<number> {
  await openYard(h, { wave: WAVE, charge: bank, integrity: INTEGRITY });
  await standGun(h);
  for (let n = 0; n < UNITS; n += 1) {
    await parkUnit(
      h,
      "mote",
      { x: KILL_AT.x + n * 20, y: KILL_AT.y },
      { hp: 1 },
    );
  }
  const before = (await h.snapshot()).charge;
  const cleared = await h.until((s) => s.phase === "build", {
    maxFrames: SWEEP,
    poll: 6,
  });
  assertEqual(cleared.hit, true, "the killed wave cleared into a build phase");
  return cleared.snapshot.charge - before;
}

/** Clear a wave of two Motes by letting them leak, and hand back what Charge did. */
async function clearByLeaking(bank: number): Promise<number> {
  await openYard(h, { wave: WAVE, charge: bank, integrity: INTEGRITY });
  for (let n = 0; n < UNITS; n += 1) {
    await releaseUnit(h, "mote", {
      at: { x: LEAK_FROM.x, y: LEAK_FROM.y + n * 20 },
      waypoint: COLLECTOR,
    });
  }
  const before = (await h.snapshot()).charge;
  const cleared = await h.until((s) => s.phase === "build", {
    maxFrames: SWEEP,
    poll: 6,
  });
  assertEqual(cleared.hit, true, "the leaked wave cleared into a build phase");
  return cleared.snapshot.charge - before;
}

it("pays the same bonus over an empty bank, a hoard, a kill and a leak", async () => {
  const bounty = loadDef("mote").bounty;

  const measured = await captureReplay(h, "hoard", async () => ({
    brokeAndKilled: await clearByKilling(0),
    hoardAndKilled: await clearByKilling(5000),
    brokeAndLeaked: await clearByLeaking(0),
    hoardAndLeaked: await clearByLeaking(5000),
  }));

  const expected = waveBonus(WAVE);
  assertEqual(
    measured.brokeAndLeaked,
    expected,
    `clearing wave ${WAVE} on an empty bank, every unit leaked`,
  );
  assertEqual(
    measured.hoardAndLeaked,
    expected,
    `clearing wave ${WAVE} on a hoard, every unit leaked`,
  );
  assertEqual(
    measured.brokeAndKilled - UNITS * bounty,
    expected,
    `clearing wave ${WAVE} on an empty bank, every unit killed, less the ` +
      `${UNITS} bounties of ${bounty} the kills paid`,
  );
  assertEqual(
    measured.hoardAndKilled - UNITS * bounty,
    expected,
    `clearing wave ${WAVE} on a hoard, every unit killed, less the ` +
      `${UNITS} bounties of ${bounty} the kills paid`,
  );

  // And a bank left sitting through a build phase earns nothing.
  await openYard(h, { wave: WAVE, charge: 1234 });
  await h.advance(IDLE);
  assertEqual(
    (await h.snapshot()).charge,
    1234,
    "a bank left across a minute of a build phase earns no interest",
  );
});
