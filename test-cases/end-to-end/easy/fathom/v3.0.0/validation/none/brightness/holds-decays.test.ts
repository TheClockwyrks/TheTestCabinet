// brightness/holds-decays — brightness holds for a second, then halves every
// `BRIGHT_HALFLIFE`, and a further plankton arms the hold again in full.
//
// `specs/sensing.md`: "Eating arms a hold of `BRIGHT_HOLD` (`1.0 s`), in full each
// time. While the hold runs `G` is steady. Once the hold expires `G` decays
// continuously, halving every `BRIGHT_HALFLIFE` (`0.9 s`), so a tick of length
// `dt` takes `G` to `G * 0.5 ^ (dt / 0.9)`."
//
// Three claims, and a build can hold any two of them. So this reads `G` at four
// points across the hold, at both halflives past it, and then across a second hold
// the forager earns by eating again mid-decay. A build that drains `G` at a
// constant rate fails the hold; a build with no hold at all fails the first sample
// past the eat; a build that arms only a partial hold the second time fails the
// last stretch.
//
// THE FIRST HOLD IS POSED, THE SECOND IS EARNED. `setBrightness(g)` "also arms the
// `BRIGHT_HOLD` brightness hold, exactly as eating a plankton does, so the value it
// poses is steady for that full second" (`specs/instrumentation.md`) — it is the
// documented way to put a full hold on the clock, and it is not the same thing as
// posing a result: what is measured afterwards is the build's own timer and its own
// decay. Posing it is also what keeps this point honest. Reached by eating, the
// whole curve would rest on `G` having risen at all, and a build whose eating
// raises nothing would decay from zero and pass every bound here vacuously — while
// `brightness/from-eating` is the point that actually owns that fault.
//
// The RE-ARM is the one claim a pose cannot make, because it is about what EATING
// does to a hold already running down. So the second half swims the forager into
// the next plankton along the corridor and reads the hold that eat armed.
//
// THE STARTING VALUE is `0.8` rather than `1`. Two halflives take it to `0.2`, and
// the eat that follows adds `BRIGHT_PER_EAT` (`0.34`) to reach `0.54` — clear of
// the clamp at `1`, so the re-armed hold is read on a value the build chose rather
// than on a ceiling. That the clamp exists at all is `brightness/from-eating`'s.

import { afterEach, beforeEach } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { ARROW_KEY, BRIGHT_HALFLIFE, BRIGHT_HOLD } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  ticks,
  type Harness,
  startPlaying,
} from "../harness";
import {
  check,
  clearUnderfoot,
  parkForager,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
} from "../scene";

/** The brightness the first hold is posed at. See the header for why not `1`. */
const POSED_G = 0.8;

/** The hold and the halflife, in whole ticks of the fixed timestep. */
const HOLD_TICKS = ticks(BRIGHT_HOLD); // 120
const HALFLIFE_TICKS = ticks(BRIGHT_HALFLIFE); // 108

/**
 * Where inside the hold `G` is sampled, in ticks from the moment it was armed.
 *
 * The last of them is two ticks short of the hold's end. `specs/sensing.md` says
 * `G` is steady "while the hold runs" and does not say which side of the boundary
 * the last tick of it falls on, so reading two ticks early asks the build for the
 * claim the page makes rather than for a tie-break it never fixed. Two ticks of
 * decay would be worth about `0.001` in any case — far inside the tolerance —
 * so nothing is being let through by the margin.
 */
const HOLD_SAMPLES = [0, 30, 60, 90, HOLD_TICKS - 2] as const;

/**
 * How far `G` may sit from the value armed, across the whole hold.
 *
 * The item's bound: `0.01`. A hold is a hold, so the only slack this needs is for
 * a build that stores `G` as a float and recomputes it each tick.
 */
const HOLD_TOLERANCE = 0.01;

/**
 * How far `G` may sit from the halving curve, at each halflife past the hold.
 *
 * The item's bound: `0.02`. Wider than the hold's because a decay is integrated
 * tick by tick and a build is free to apply it before or after the rest of its
 * step, which is worth a tick's worth of curve either way.
 */
const DECAY_TOLERANCE = 0.02;

/**
 * The corridor the second eat is swum along, in tiles.
 *
 * Six is more than the forager can cross in the whole scenario, so the eat that
 * re-arms the hold is a real approach into a pellet rather than a scramble at the
 * end of a run — and the fixture's sealed larder means grazing it could not clear
 * the maze in any case.
 */
const RUN_TILES = 6;

/** How long the sweep waits for the second eat, in ticks. */
const EAT_TICKS = 90; // 0.75 s; one tile takes 30 at FORAGER_SPEED

/**
 * How far into the re-armed hold `G` is read, in ticks from the eat.
 *
 * Short of `HOLD_TICKS` by the tick spent settling below plus a margin, so the
 * reading is inside the second hold under any reading of where its first tick
 * falls.
 */
const REARM_TICKS = 110;

/** The value the halving curve gives `g` after `elapsed` seconds of decay. */
function halved(g: number, elapsed: number): number {
  return g * 0.5 ** (elapsed / BRIGHT_HALFLIFE);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

check(
  "holds brightness for BRIGHT_HOLD, halves it every BRIGHT_HALFLIFE, and re-arms the hold on a further plankton",
  async () => {
    await startPlaying(h);
    const run = await poseStraightRun(h, RUN_TILES);
    // Parked facing rock and its own pellet eaten, so the posed hold below is read
    // on a forager that is neither swimming into the next plankton nor standing on
    // one: an eat mid-measurement would re-arm the very hold being measured.
    await parkForager(h, run.start);
    await clearUnderfoot(h);
    // The forager is a bystander for the first half and the subject for the second,
    // where it is meant to swim into the next plankton — so the guard is not held to
    // where it parked. What it still catches is a life lost or the dive leaving live
    // play, either of which would reset brightness under the measurement.
    const guard = await sceneGuard(h, null, { foragerParked: false });

    const curve = await captureReplay(h, "decay", async () => {
      await h.debug.setBrightness(POSED_G);

      // The hold.
      const hold: { at: number; g: number }[] = [];
      let stood = 0;
      for (const at of HOLD_SAMPLES) {
        await h.advance(at - stood);
        stood = at;
        hold.push({ at, g: (await h.snapshot()).brightness });
      }

      // The decay, sampled at each of the first two halflives past the hold's end.
      const decay: { elapsed: number; g: number }[] = [];
      for (const halflives of [1, 2]) {
        const at = HOLD_TICKS + halflives * HALFLIFE_TICKS;
        await h.advance(at - stood);
        stood = at;
        decay.push({
          elapsed: seconds(halflives * HALFLIFE_TICKS),
          g: (await h.snapshot()).brightness,
        });
      }

      // And the re-arm, earned by swimming into the next plankton along.
      const before = await h.snapshot();
      await h.debug.setForagerDir(run.dir);
      const key = ARROW_KEY[run.dir];
      await h.hold(key);
      const eaten = await h.until(
        (s) => s.planktonRemaining < before.planktonRemaining,
        { maxTicks: EAT_TICKS, poll: 1 },
      );
      await h.release(key);
      // One tick past the eat before `G` is read. `specs/sensing.md` fixes what an
      // eat adds and what the hold does, and leaves the order of the two inside a
      // tick to the build: a build that raises `G` after it arms the hold reports
      // the old value for exactly that one tick, and both orders honour the page.
      await h.advance(1);
      const armed = (await h.snapshot()).brightness;
      // Parked again, so nothing else is eaten inside the window being read.
      await parkForager(h);
      await h.advance(REARM_TICKS);
      const stillHeld = (await h.snapshot()).brightness;

      return { hold, decay, before, eaten, armed, stillHeld };
    });

    requireSceneHeld(await h.snapshot(), guard);

    // The hold: steady for the whole second.
    for (const sample of curve.hold) {
      assertLessThanOrEqual(
        Math.abs(sample.g - POSED_G),
        HOLD_TOLERANCE,
        `|G - ${POSED_G}| ${sample.at} ticks into the ${BRIGHT_HOLD} s hold`,
      );
    }

    // The decay: halved at each halflife past it.
    for (const sample of curve.decay) {
      assertLessThanOrEqual(
        Math.abs(sample.g - halved(POSED_G, sample.elapsed)),
        DECAY_TOLERANCE,
        `|G - ${halved(POSED_G, sample.elapsed).toFixed(4)}| after ` +
          `${sample.elapsed.toFixed(2)} s of decay`,
      );
    }

    // The re-arm. The eat has to have happened for there to be a hold to read, and
    // whether the forager can swim into a plankton at all belongs to the movement
    // checks rather than to this one.
    if (!curve.eaten.hit) {
      requireSwim(
        curve.before.forager,
        curve.eaten.snapshot.forager,
        "reach the plankton ahead of it",
      );
    }
    assertEqual(
      curve.eaten.hit,
      true,
      "the forager ate a further plankton mid-decay",
    );
    assertGreaterThan(
      curve.armed,
      curve.decay[curve.decay.length - 1].g,
      "G after the further plankton, against the value it had decayed to",
    );
    assertLessThanOrEqual(
      Math.abs(curve.stillHeld - curve.armed),
      HOLD_TOLERANCE,
      `|G - ${curve.armed.toFixed(4)}| ${REARM_TICKS} ticks into the hold the ` +
        `further plankton armed, of the ${HOLD_TICKS} ticks BRIGHT_HOLD runs`,
    );
  },
);
