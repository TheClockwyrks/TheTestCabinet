// sonar/cooldown — the pulse recharges over SONAR_COOLDOWN, and nothing gets
// through while it does.
//
// specs/sensing.md: "A pulse is emitted when its cooldown is `0`, and emitting
// one sets the cooldown to `SONAR_COOLDOWN` (`1.5 s`), which then runs down.
// Pulses are unlimited, and the cooldown is the only limit on them."
// specs/state.md: "`sonar.cooldown` is the seconds left until the sonar pulse is
// ready and `sonar.ready` is `true` exactly when that is `0`."
//
// FOUR CLAIMS, AND A BUILD CAN HOLD ANY THREE. The cooldown is armed at the full
// figure; it runs down against simulated time; a press inside it is refused; and
// readiness is exactly the cooldown having reached zero. So this reads the meter
// the moment it is armed, presses again halfway down and counts what entered
// flight, then walks the last of the recharge a tick at a time and takes the
// exact moment `ready` turned over.
//
// "NOTHING ENTERED FLIGHT" IS READ AS A COUNT ACROSS THE PRESS, not as an empty
// list. A build whose spent pulses linger on `pulses` has a fault, and it is
// `sonar/wavefront`'s: read as an empty list, that one fault would fail this
// point too. What this asks instead is that the press ADDED nothing, which is
// exactly what the claim says and is decidable whatever the list already held.
// The press is taken a full second in — two thirds of the way down the cooldown
// — and it also catches the other way a build can fail this: a refused press that
// re-arms the cooldown anyway would push readiness out, and the meter is read
// across the press.
//
// WHAT THIS DOES NOT DECIDE. Whether `Space` emits a pulse at all, which is
// `controls/sonar-key`'s and which `castPulse` defers to by name; and how far or how
// fast the front travels, which is `sonar/wavefront`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { SONAR_COOLDOWN, TICK_DT, TICK_HZ } from "../../src/constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import {
  SONAR_KEY,
  castPulse,
  foragerPulses,
  requirePress,
  sinceEmit,
} from "./pulse";

/** A corridor for the forager to stand in as a bystander, in tiles. */
const RUN_TILES = 6;

/**
 * How far the armed cooldown may sit from `SONAR_COOLDOWN`, in seconds.
 *
 * Two ticks. The meter is read one tick after the key went down, and
 * specs/sensing.md leaves the order of arming the cooldown and running it down
 * inside that tick to the build, so a conforming build reports `1.5` or
 * `1.5 - TICK_DT` there. Two ticks is that ambiguity and a tick's rounding, and
 * it is a sixtieth of the figure being asserted.
 */
const ARM_TOLERANCE = 2 * TICK_DT;

/**
 * When the refused second press is taken, in ticks after the first.
 *
 * A full second, which is two thirds of the way down the cooldown and well past
 * the `9 / SONAR_WAVE_SPEED` seconds the first wavefront lives for. See the
 * header.
 */
const SECOND_PRESS_TICKS = TICK_HZ;

/**
 * How far the moment `ready` turns over may sit from `SONAR_COOLDOWN`, in
 * seconds, measured from the tick the first press ran on.
 *
 * Two ticks, for the same reason as {@link ARM_TOLERANCE}: the arming happened
 * somewhere inside that first tick. "Exactly when the cooldown reaches `0`" is
 * asserted separately and exactly, as the value of the meter on the tick
 * readiness returned.
 */
const READY_TOLERANCE = 2 * TICK_DT;

/**
 * How long the sweep for readiness runs, in ticks from the first press.
 *
 * A hard ceiling a fifth of a second past the figure, so a build whose cooldown
 * merely runs slow FAILS on the bound rather than leaving the point undecided.
 */
const READY_MAX_TICKS = Math.round((SONAR_COOLDOWN + 0.2) * TICK_HZ);

/** One reading of the meter as it ran down. */
interface Sample {
  elapsed: number;
  ready: boolean;
  cooldown: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms SONAR_COOLDOWN on a pulse, refuses a press inside it, and is ready again exactly when it reaches 0", async () => {
  startPlaying(h);
  const run0 = await poseStraightRun(h, RUN_TILES);
  await parkForager(h, run0.start);
  const watch = await sceneGuard(h);

  const run = await captureReplay(h, "cooldown", async () => {
    const emitted = await castPulse(h);
    // The cooldown is readable whatever became of the wavefront the press cast,
    // so this asks only that the press landed at all.
    requirePress(emitted);

    // Down to the refused press, then the press itself and the tick that
    // delivers it.
    await h.advance(SECOND_PRESS_TICKS - 1);
    const beforeSecond = h.snapshot();
    await h.tap(SONAR_KEY);
    const afterSecond = h.snapshot();

    // And the rest of the recharge, a tick at a time, so the moment readiness
    // returns is read to the tick.
    const samples: Sample[] = [];
    let ready: Sample | null = null;
    while (
      ready === null &&
      sinceEmit(emitted, h.snapshot()) * TICK_HZ < READY_MAX_TICKS
    ) {
      await h.advance(1);
      const snapshot = h.snapshot();
      const sample: Sample = {
        elapsed: sinceEmit(emitted, snapshot),
        ready: snapshot.sonar.ready,
        cooldown: snapshot.sonar.cooldown,
      };
      samples.push(sample);
      if (sample.ready) ready = sample;
    }

    return { emitted, beforeSecond, afterSecond, samples, ready };
  });

  requireSceneHeld(h.snapshot(), watch);

  // Armed, at the full figure, with the pulse it armed for in flight.
  assertEqual(
    run.emitted.before.sonar.ready,
    true,
    "sonar.ready with the cooldown posed to 0, before the pulse",
  );
  assertEqual(
    run.emitted.after.sonar.ready,
    false,
    "sonar.ready one tick after the pulse was emitted",
  );
  assertLessThanOrEqual(
    Math.abs(run.emitted.after.sonar.cooldown - SONAR_COOLDOWN),
    ARM_TOLERANCE,
    `|sonar.cooldown - SONAR_COOLDOWN| one tick after the pulse, of the ` +
      `${SONAR_COOLDOWN} s specs/sensing.md arms`,
  );

  // Running down against simulated time.
  assertGreaterThan(
    run.emitted.after.sonar.cooldown - run.beforeSecond.sonar.cooldown,
    0,
    `how much of the cooldown ran off over the ${SECOND_PRESS_TICKS} ticks ` +
      "before the second press",
  );

  // The second press, inside the cooldown: nothing in flight, and no re-arm.
  assertEqual(
    run.beforeSecond.sonar.ready,
    false,
    `sonar.ready ${SECOND_PRESS_TICKS} ticks in, with the cooldown still running`,
  );
  assertLessThanOrEqual(
    foragerPulses(run.afterSecond).length,
    foragerPulses(run.beforeSecond).length,
    `the forager wavefronts in flight one tick after a second ${SONAR_KEY} ` +
      "press taken while the cooldown was still running, against how many were " +
      "in flight the tick before it",
  );
  assertLessThanOrEqual(
    run.afterSecond.sonar.cooldown,
    run.beforeSecond.sonar.cooldown,
    "sonar.cooldown across the refused press, which must keep running down " +
      "rather than being armed again",
  );

  // Ready exactly when the meter reaches zero, and not before.
  for (const sample of run.samples) {
    assertEqual(
      sample.ready,
      sample.cooldown === 0,
      `sonar.ready ${sample.elapsed.toFixed(4)} s after the pulse, where ` +
        `sonar.cooldown is ${sample.cooldown.toFixed(4)} — specs/state.md has ` +
        "ready true exactly when the cooldown is 0",
    );
  }
  assertEqual(
    run.ready !== null,
    true,
    `sonar.ready returned within ${READY_MAX_TICKS} ticks of the pulse, of ` +
      `the ${SONAR_COOLDOWN} s SONAR_COOLDOWN runs`,
  );
  if (run.ready !== null) {
    assertLessThanOrEqual(
      Math.abs(run.ready.elapsed - SONAR_COOLDOWN),
      READY_TOLERANCE,
      `|elapsed - SONAR_COOLDOWN| at the tick sonar.ready returned, measured ` +
        "from the tick the pulse was emitted on",
    );
    assertEqual(
      run.ready.cooldown,
      0,
      "sonar.cooldown on the tick sonar.ready returned",
    );
  }
});
