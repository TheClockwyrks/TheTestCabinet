// director/dark-pursues — the Dark comes straight on, every tick.
//
// THE SPEC LINE. `specs/enemies.md`, "Chase": "Each tick a chasing enemy
// recomputes its heading as the unit vector from its center to the
// lamplighter's center and advances one step along it. The heading is
// recomputed every tick, so a chaser turns with the lamplighter as it moves."
// "Movement" fixes the step: "one tick's step is `speed * TICK_DT` units". The
// roster gives `dark` behavior `chase` and speed `170`, so the step is
// `170 × TICK_DT`.
//
// WHY IT IS DECIDED HERE. The Dark is the director's last arrival, and what
// makes it the night's threat is that it never stops closing. This item reads
// what the Dark does AFTER the 9:00 event puts it on the field, so it is
// driven exactly as the night drives it: the clock posed one tick short of
// tick 32400, `events` on for the one tick that spawns it, and `events` off
// again afterwards so nothing else arrives during the pursuit.
//
// WHAT "RECOMPUTED EVERY TICK" IS READ AGAINST. Each tick's step is checked
// against the unit vector from where the Dark stood at the top of that tick to
// the lamplighter's center, so a build that fixed its heading at spawn passes
// the first leg and fails the second: halfway through the drive the
// lamplighter is posed somewhere else, and the steps after it must point the
// new way. The lamplighter itself never moves under its own power here — no
// key is held — so the center each step is checked against is the one the
// snapshot reports.
//
// THE DRIVE. The isolated world, `enemyMotion` alone on after the spawn, for
// ten ticks, a pose of the lamplighter, and ten more. `enemyContact` is off,
// so a Dark that closes the distance lands no hit that would end the run; the
// distance from the ring is 760 and twenty steps cover 56.7, so the pursuit is
// read well before it arrives.
//
// THE TOLERANCE. `MOTION_EPS`, a millionth of a unit: each reading is one
// integrated step, a unit vector times `170 / 60`, on top of a position the
// build reached by the same arithmetic.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertPointNear } from "../assert";
import { ENEMIES, EVENTS, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  disable,
  enable,
  enemyById,
  isolate,
  unit,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { driveArrivals, eventTick } from "./spawns";

/** The 9:00 arrival, and the tick it fires on. */
const EVENT = EVENTS[6];
const FIRES_ON = eventTick(EVENT.time);

/** One tick's step for the Dark: `speed × TICK_DT`. */
const STEP = ENEMIES.dark.speed * TICK_DT;

/** Ticks driven before the lamplighter is posed elsewhere, and after. */
const LEG_TICKS = 10;

/** Where the lamplighter is posed for the second leg. */
const MOVED_X = -240;
const MOVED_Y = 310;

/** Where the Dark stands and where the lamplighter is, in one snapshot. */
function legOf(snapshot: WickSnapshot, id: number) {
  const dark = enemyById(snapshot, id);
  return { dark, player: snapshot.run.player };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("steps the Dark 170 × TICK_DT toward the lamplighter's center on every tick", async () => {
  isolate(h);
  h.debug.setTick(FIRES_ON - 1);
  enable(h, "events");
  const spawned = await driveArrivals(h, 1);
  assertEqual(
    spawned.arrivals.length,
    1,
    `the enemies the ${EVENT.time} s event spawned`,
  );
  const id = spawned.arrivals[0].enemy.id;
  disable(h, "events");
  enable(h, "enemyMotion");

  const steps: { from: WickSnapshot; to: WickSnapshot }[] = [];
  await captureReplay(h, "pursuit", async () => {
    let before = h.snapshot();
    for (let leg = 0; leg < 2; leg += 1) {
      if (leg === 1) {
        h.debug.setPlayerPosition(MOVED_X, MOVED_Y);
        before = h.snapshot();
      }
      for (let tick = 0; tick < LEG_TICKS; tick += 1) {
        const after = await advanceTicks(h, 1);
        steps.push({ from: before, to: after });
        before = after;
      }
    }
  });

  for (const [index, step] of steps.entries()) {
    const { dark, player } = legOf(step.from, id);
    const moved = enemyById(step.to, id);
    assertEqual(
      moved === undefined,
      false,
      `the Dark still on the field after step ${index + 1}`,
    );
    const toward = unit(player.x - (dark?.x ?? 0), player.y - (dark?.y ?? 0));
    assertPointNear(
      moved ?? { x: 0, y: 0 },
      {
        x: (dark?.x ?? 0) + toward.x * STEP,
        y: (dark?.y ?? 0) + toward.y * STEP,
      },
      MOTION_EPS,
      `step ${index + 1}: where the Dark stood after the tick`,
    );
  }
});
