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

// TWO CLOCKS, AND WHY EACH IS THE ONE IT IS. The simulation is frame-division
// independent (`specs/controls.md`: "an interval of simulation time reaches the
// same state however it was divided into frames and whatever frame rate produced
// it"), so every span below is driven at the coarsest step that span allows.
//
//   The four clears carry a Capacitor firing at parked Motes, so a PROJECTILE is
//   in flight and the step is bounded: a shot travelling further than
//   `2 * PROJECTILE_HIT_R` in one frame could pass its target without ever coming
//   within `PROJECTILE_HIT_R` of it. `MAX_STEP_MS` is that bound, computed from
//   this project's own transcription of `specs/components.md`.
//
//   The interest reading holds an EMPTY yard for `IDLE_SECONDS` — no unit, no
//   structure, no projectile, nothing positional read across it — so it is driven
//   on a harness of its own at a far coarser step. The span is the sample; only
//   the number of frames it is cut into is the check's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  releaseUnit,
} from "../harness";
import { KILL_AT, LEAK_FROM, standGun } from "./runs";
import {
  COLLECTOR_WAYPOINT,
  loadDef,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
  waveBonus,
} from "../constants";

/** The wave every run below is posed at, so every bonus compared is the same one. */
const WAVE = 6;

/** How many Motes each wave holds. */
const UNITS = 2;

/** Comfortably above what two Motes leaking costs. */
const INTEGRITY = 50;

/** The longest frame a bolt in flight is still readable on, in milliseconds. */
const MAX_STEP_MS = (2 * PROJECTILE_HIT_R * 1000) / PROJECTILE_SPEED;

/** The rate the four clears run at: the coarsest whole `5` ms step inside that. */
const CLEAR_HZ = 1000 / (Math.floor(MAX_STEP_MS / 5) * 5);

/** Five seconds of that clock: past two kills and two short walks. */
const SWEEP = Math.round(5 * CLEAR_HZ);

/** The rate the interest reading runs at, on an empty yard. */
const IDLE_HZ = 5;

/** How long a bank is left sitting, in seconds of simulation. */
const IDLE_SECONDS = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: CLEAR_HZ });
});

afterEach(() => {
  h.dispose();
});

/** Clear a wave of two Motes by killing them, and hand back what Charge did. */
async function clearByKilling(bank: number): Promise<number> {
  openYard(h, { wave: WAVE, charge: bank, integrity: INTEGRITY });
  standGun(h);
  for (let n = 0; n < UNITS; n += 1) {
    parkUnit(h, "mote", { x: KILL_AT.x + n * 20, y: KILL_AT.y }, { hp: 1 });
  }
  const before = h.snapshot().charge;
  const cleared = await h.until((s) => s.phase === "build", {
    maxFrames: SWEEP,
    poll: 6,
  });
  assertEqual(cleared.hit, true, "the killed wave cleared into a build phase");
  return cleared.snapshot.charge - before;
}

/** Clear a wave of two Motes by letting them leak, and hand back what Charge did. */
async function clearByLeaking(bank: number): Promise<number> {
  openYard(h, { wave: WAVE, charge: bank, integrity: INTEGRITY });
  for (let n = 0; n < UNITS; n += 1) {
    releaseUnit(h, "mote", {
      at: { x: LEAK_FROM.x, y: LEAK_FROM.y + n * 20 },
      waypoint: COLLECTOR_WAYPOINT,
    });
  }
  const before = h.snapshot().charge;
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

  // And a bank left sitting through a build phase earns nothing. The yard is
  // empty for the whole span, so this one runs on a harness of its own at the
  // coarser step above.
  const idle = await createHarness({ hz: IDLE_HZ });
  try {
    openYard(idle, { wave: WAVE, charge: 1234 });
    await idle.advanceSeconds(IDLE_SECONDS);
    assertEqual(
      idle.snapshot().charge,
      1234,
      `a bank left across ${IDLE_SECONDS} seconds of a build phase earns no ` +
        "interest",
    );
  } finally {
    idle.dispose();
  }
});
