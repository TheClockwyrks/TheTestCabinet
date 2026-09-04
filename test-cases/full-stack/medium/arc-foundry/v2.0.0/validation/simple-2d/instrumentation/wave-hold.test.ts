// instrumentation/wave-hold — the wave-clear hold keeps a live wave running, and
// releasing it clears the wave and pays the bonus.
//
// `specs/instrumentation.md` gives the surface a second hold, on the wave's own
// clear-and-pay resolution: "While it is on, a wave whose units have all died or
// leaked stays running, so no wave-clear bonus lands in the middle of a reading.
// Nothing else changes: the bounty is still paid, the leak still costs Grid
// Integrity, and defeat still resolves at zero." `startRun` and `reset` release it.
//
// WHY IT IS A POINT OF ITS OWN. Seventeen other checks in this project read a
// figure across a kill or a leak, and every one of them depends on this hold
// holding: without it a wave-clear bonus lands in the same counter as the bounty
// being measured, and every one of those checks fails for a reason that is not its
// own. So the hold is decided here, once, by name.
//
// WHAT IS DECIDED. Three things, in one drive. The hold keeps a wave running with
// nothing left on the yard and pays nothing while it holds; a kill under the hold
// still pays its bounty, so the hold is on the resolution and not on the economy;
// and releasing it lets the ordinary resolution run on the next advance, which
// pays the bonus and opens the next build phase.

import { afterEach, beforeEach, it } from "vitest";
import { tileCenter, WAVE_BONUS_BASE, WAVE_BONUS_STEP } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  holdWave,
  openYard,
  parkUnit,
  releaseWaveHold,
  standComponent,
  ticks,
} from "../harness";

/** The wave the hold is read at, so the bonus is a figure worth telling apart. */
const WAVE = 4;

/** Where the Mote is held and killed: clear of the chain, and of nothing else. */
const KILL_AT = tileCenter(20, 20);

/** Frames the wave is left running under the hold: two seconds of real advance. */
const HELD_FRAMES = ticks(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the wave's resolution, pays the bounty, and clears once released", async () => {
  openYard(h, { wave: WAVE, charge: 0 });
  holdWave(h);
  standComponent(h, "capacitor", 1, 30, 20);

  const bonus = WAVE_BONUS_BASE + WAVE_BONUS_STEP * WAVE;

  const killed = await captureReplay(h, "hold", async () => {
    // One Mote, held where the Capacitor can reach it, on one point of health.
    parkUnit(h, "mote", KILL_AT, { hp: 1, burn: { dps: 500, seconds: 3 } });
    const gone = await h.until((s) => s.units.length === 0, {
      maxFrames: ticks(5),
    });
    assertEqual(
      gone.hit,
      true,
      "a burned Mote on one point of health to die within five seconds " +
        "(specs/enemies.md)",
    );
    // And then the wave is left running, with nothing on the yard at all.
    await h.advance(HELD_FRAMES);
    return gone.snapshot;
  });

  // The bounty was paid: the hold is on the resolution and not on the economy.
  assertGreaterThan(
    killed.charge,
    0,
    "the Charge a kill pays under the hold, which is the bounty " +
      "(specs/economy.md)",
  );

  const held = h.snapshot();
  assertEqual(held.units.length, 0, "the units left on the yard");
  assertEqual(
    held.waveActive,
    true,
    `the wave still running ${HELD_FRAMES} frames after its last unit died, ` +
      "because its clear-and-pay resolution is held " +
      "(specs/instrumentation.md)",
  );
  assertEqual(held.phase, "wave", "the phase while the resolution is held");
  assertEqual(held.wave, WAVE, "the wave counter while the resolution is held");
  assertEqual(
    held.charge,
    killed.charge,
    "the Charge after the kill and the frames that followed it, which is the " +
      "bounty alone because no wave-clear bonus has been paid",
  );

  // Released, the ordinary resolution runs on the next advance.
  releaseWaveHold(h);
  await h.advance(2);
  const cleared = h.snapshot();
  assertEqual(cleared.waveHeld, false, "the hold after it is released");
  assertEqual(
    cleared.waveActive,
    false,
    "the wave once the hold is released, which clears the ordinary way " +
      "(specs/campaign.md)",
  );
  assertEqual(
    cleared.phase,
    "build",
    "the phase a cleared wave opens (specs/campaign.md)",
  );
  assertEqual(
    cleared.charge - killed.charge,
    bonus,
    `the wave-clear bonus wave ${WAVE} pays once the hold is released, ` +
      `WAVE_BONUS_BASE + WAVE_BONUS_STEP * ${WAVE} (specs/economy.md)`,
  );
});
