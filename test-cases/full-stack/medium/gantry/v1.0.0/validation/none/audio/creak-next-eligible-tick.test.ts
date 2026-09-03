// audio/creak-next-eligible-tick — the next creak falls exactly
// CREAK_COOLDOWN * TICK_HZ ticks after the last one.
//
// specs/ui.md § Audio fixes the gate as a tick count and says where the count
// starts: "at most one `creak` across the structure per `CREAK_COOLDOWN`
// (`0.5`) run-clock seconds, counted in whole ticks from the tick the last one
// played: the first tick eligible again is `CREAK_COOLDOWN * TICK_HZ` (`30`)
// ticks after that one, and a tick that has an eligible member but falls inside
// the cooldown plays nothing and starts no new cooldown."
//
// A BUILD IS ONLY HELD TO THAT IF ITS STRUCTURE IS ELIGIBLE THE WHOLE WAY. The
// rule's "eligible" is a fresh crossing — utilization at or above `0.8` on a
// tick, below it on the tick before — so a member that simply stays loaded is
// eligible once and never again, and a run that stayed loaded would be silent
// after its first creak for a reason that has nothing to do with the cooldown.
// So the crane is made to cross the threshold from below as often as the rule
// allows, which is every OTHER tick: a crossing needs the tick before it to be
// under the threshold, so two crossings can never be adjacent, and the earliest
// eligible tick after one is two later. Thirty is even, so the tick the rule
// names as eligible again is one of the ticks this scenario crosses on.
//
// THE CROSSING IS A CRATE GOING ON AND OFF THE HOOK. `setLoadPhase` hangs a load
// "exactly as a successful `attach` leaves it" and every other phase "takes the
// load off the hook" (specs/instrumentation.md), and specs/rigging.md makes the
// bob's mass the hook's alone or the hook's plus the load's accordingly — so
// alternating the two alternates the cable tension, and with it the crane's worst
// utilization, between a figure over `0.8` and one far under it. Both readings
// are taken off the run's own forces on every tick rather than assumed. A crate
// of `180` keeps the loaded figure under `1`, so nothing ever breaks and the
// crane solving each tick is the same crane.
//
// WHAT IS THEN DECIDED is the gap between the first creak and the next: forty
// ticks are driven, and the two creaks in them must fall exactly thirty ticks
// apart, with the fourteen eligible ticks in between silent.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import {
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  GRIP_MAX_RATE,
  HOIST_START,
  TICK_HZ,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; the crane and the load are the whole scenario. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;

/** Where the run hangs the bare hook, and so where the load is put. */
const HOOK = {
  x: PIVOT.x,
  y: PIVOT.y - HOIST_START,
  z: PIVOT.z,
  yaw: 0,
} as const;

/** Over the threshold on the hook, under `1` so nothing breaks. */
const LOAD_MASS = 180;

/** The gate, in whole ticks: `CREAK_COOLDOWN * TICK_HZ`. */
const COOLDOWN_TICKS = CREAK_COOLDOWN * TICK_HZ;

/** Long enough to hold a creak, the whole cooldown, and the creak after it. */
const TICKS = COOLDOWN_TICKS + 10;

/** A move that keeps the run alive and applies no force to the structure. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

/** The highest utilization the tick's solve reported, over the intact members. */
function worst(snapshot: GantrySnapshot): number {
  return snapshot.run.forces.reduce(
    (high, one) => Math.max(high, one.utilization),
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the next creak exactly the cooldown's ticks after the last", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.cues(); // the start's own `run-start`, drained

  const creaked: number[] = [];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const loaded = tick % 2 === 1;
    await h.debug.setLoadPhase(0, loaded ? "attached" : "waiting");
    const state = await runTicks(h, 1);
    const played = await h.cues();

    assertEqual(
      state.run.phase,
      "running",
      `the run on tick ${tick}: nothing in this scenario ends it, so every ` +
        "tick of it is a tick the creak rule is being read on",
    );
    if (loaded) {
      assertGreaterThanOrEqual(
        worst(state),
        CREAK_THRESHOLD,
        `the worst utilization on tick ${tick}, with the crate on the hook: ` +
          `at or above CREAK_THRESHOLD (${CREAK_THRESHOLD}), so this tick ` +
          "has a member the creak rule calls eligible (specs/ui.md § Audio)",
      );
    } else {
      assertLessThan(
        worst(state),
        CREAK_THRESHOLD,
        `the worst utilization on tick ${tick}, with the crate off the hook: ` +
          `below CREAK_THRESHOLD (${CREAK_THRESHOLD}), so the tick after it ` +
          "is a fresh crossing (specs/ui.md § Audio)",
      );
    }
    if (played.includes("creak")) creaked.push(tick);
  }
  await h.capture("state", "the crane after forty ticks of crossing 0.8");

  assertGreaterThanOrEqual(
    creaked.length,
    2,
    `the creaks in ${TICKS} ticks of a crane crossing CREAK_THRESHOLD every ` +
      "other tick: one, then the next once the cooldown is spent " +
      `(the ticks that creaked were [${creaked.join(", ")}])`,
  );
  assertEqual(
    (creaked[1] as number) - (creaked[0] as number),
    COOLDOWN_TICKS,
    `the ticks between the first creak (tick ${creaked[0]}) and the next: ` +
      `the first tick eligible again is CREAK_COOLDOWN * TICK_HZ ` +
      `(${COOLDOWN_TICKS}) ticks after the one the last creak played, and ` +
      "every eligible tick inside the cooldown plays nothing " +
      `(specs/ui.md § Audio; the ticks that creaked were ` +
      `[${creaked.join(", ")}])`,
  );
  assertLength(
    creaked.filter(
      (tick) =>
        tick > (creaked[0] as number) &&
        tick < (creaked[0] as number) + COOLDOWN_TICKS,
    ),
    0,
    "the creaks sounded inside the cooldown that followed the first one " +
      "(specs/ui.md § Audio)",
  );
});
