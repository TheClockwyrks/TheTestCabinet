// sonar/heard-by-gloamfin — the sound has to get there.
//
// specs/sensing.md: "It is heard. When the front arrives at a Gloamfin it hands
// that Gloamfin a fix on the forager, on arrival rather than at the moment the
// pulse was emitted." specs/predators/gloamfin.md gives the same as one of its
// three senses — "The forager's pulse. The front of the forager's sonar pulse
// reaches the Gloamfin's tile" — and its state table has `"wander"` become
// `"chase"` when any sense takes a fix.
//
// THE POINT IS THE DELAY, so the scenario is built to make the delay large and
// the alternatives impossible. The Gloamfin is posed `GAP_TILES` steps down a
// straight corridor, which is `GAP_TILES / SONAR_WAVE_SPEED` seconds of flight —
// long enough that "on arrival" and "at the press" are half a second apart and a
// build that hands the fix out with the press is caught halfway through, still
// wandering by the page's own account and already chasing by its own.
//
// THE HUNTER'S EARS RUN AND ITS BODY IS HELD. What this point grades is a sense —
// the front arriving, and the fix that arrival hands over — so the Gloamfin's mind
// runs untouched through the code play runs and only its travel is off
// (`specs/instrumentation.md`). That is what makes the flight time a FACT: the
// front covers `SONAR_WAVE_SPEED` corridor steps a second toward a tile that does
// not move, so "when the front gets there" is `steps / SONAR_WAVE_SPEED` exactly
// rather than a closing rate against a wanderer whose direction the build chose.
// Nothing here reads where a Gloamfin goes; that is `gloamfin/wander-speed`'s and
// `maze-movement/predators-keep-to-corridors`'.
//
// THE OTHER TWO SENSES ARE SHUT OUT, not hoped away.
// specs/predators/gloamfin.md gives the Gloamfin three ways to be caught, and the
// other two would both produce a chase this scenario would read as the pulse's
// doing. CLOSE HEARING reaches `GLOAMFIN_HEAR` (`64`) units, and the pair is posed
// well over twice that apart with neither body travelling, so the sweep reads the
// gap every tick and FAILS if it is ever inside the reach. ITS OWN PING would
// catch the forager `d / SONAR_WAVE_SPEED` seconds after it is cast, which on this
// board is the same arithmetic as the pulse being timed — so the sweep FAILS if a
// Gloamfin ping is ever in flight, and confirms none is before the press. Both are
// verdicts, not deferrals.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { GLOAMFIN_HEAR, SONAR_WAVE_SPEED, TICK_HZ } from "../../src/constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { emitPulse, gloamfinPulses, sinceEmit } from "./pulse";

/**
 * How far down the corridor the Gloamfin is posed, in tiles.
 *
 * Five, which is `160` units — well over twice the `GLOAMFIN_HEAR` (`64`) close
 * hearing reaches — and which is comfortably inside the `9` corridor steps a
 * depth-1 pulse carries.
 */
const GAP_TILES = 5;

/**
 * Corridor beyond the Gloamfin, in tiles.
 *
 * Four, which takes the run out to the ninth step and no further. The front
 * floods the corridor rather than stopping at the hunter, so the tiles past it
 * are the ones a build that only reaches its own last step would come up short
 * on.
 */
const TAIL_TILES = 4;

/**
 * Ticks run before the press, so the pose has been simulated once.
 *
 * The hunter's mind runs across them — it senses, it minds its ping timer — and
 * its body holds, so the state read at the end of them is the state the pulse is
 * cast into.
 */
const SETTLE_TICKS = 15;

/**
 * Where inside the flight the "still wandering" reading is taken, as a fraction.
 *
 * Half way. A conforming front stands `GAP_TILES / 2` steps out there and the
 * hunter's tile has not moved, so the front is genuinely several steps short of
 * it and "it has not been reached yet" is a fact about the board rather than a
 * tolerance.
 */
const MID_FRACTION = 0.5;

/**
 * The corridor steps that must still separate the front from the hunter at the
 * mid reading.
 *
 * One whole step. Below that the mid reading would be a tolerance rather than a
 * fact about the board, and the scenario should be widened rather than the
 * reading trusted.
 */
const MID_MARGIN_STEPS = 1;

/**
 * How long past the front's arrival the fix may land, in seconds.
 *
 * Fifteen hundredths: two whole corridor steps of the front's own flight, which
 * is more than the longest it can be inside the hunter's tile before the tick
 * that sweeps it, and a beat. A HARD ceiling — a build that hands the fix over
 * late, or not at all, FAILS here rather than leaving the point undecided.
 */
const LATE_SLACK = 0.15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("hands a wandering Gloamfin its fix when the front arrives, not when the pulse is cast", async () => {
  startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: 0,
    tail: TAIL_TILES,
  });
  await parkForager(h, line.forager);

  // Its ears are the subject, so its mind runs and its body is held: the tile the
  // front has to reach is the tile it was posed on, for the whole flight.
  const gloamfin = await spawnPredator(h, "gloamfin", line.pred, {
    travel: false,
    dir: line.dir,
  });

  const watch = await sceneGuard(h);

  const heard = await captureReplay(h, "heard", async () => {
    await h.advance(SETTLE_TICKS);
    const settled = h.snapshot();
    if (settled.predators[gloamfin].state !== "wander") {
      fail(
        "the Gloamfin to be wandering when the pulse is cast, so that the turn " +
          "this point times is the pulse's doing; specs/predators/gloamfin.md " +
          "gives it three ways to take a fix and the other two are shut out here",
        settled.predators[gloamfin].state,
      );
    }
    if (gloamfinPulses(settled).length > 0) {
      fail(
        "no Gloamfin ping in flight when this scenario casts its pulse; " +
          "specs/predators/gloamfin.md has a ping that reaches the forager hand " +
          "the Gloamfin the same fix this point is timing",
        gloamfinPulses(settled).length,
      );
    }

    const steps = Math.abs(settled.predators[gloamfin].tx - settled.forager.tx);
    const arrival = steps / SONAR_WAVE_SPEED;

    const emitted = await emitPulse(h);
    const sweepTicks = Math.ceil((arrival + LATE_SLACK) * TICK_HZ);
    let opening: { elapsed: number; state: string } | null = null;
    let mid: { elapsed: number; state: string } | null = null;
    let chased: number | null = null;
    for (let tick = 1; tick <= sweepTicks; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = h.snapshot();
      const elapsed = sinceEmit(emitted, snapshot);
      const hunter = snapshot.predators[gloamfin];
      const gap = Math.hypot(
        hunter.x - snapshot.forager.x,
        hunter.y - snapshot.forager.y,
      );
      if (gap <= GLOAMFIN_HEAR) {
        fail(
          "the wandering Gloamfin to stay outside the GLOAMFIN_HEAR " +
            `(${GLOAMFIN_HEAR}) units specs/predators/gloamfin.md gives its ` +
            "close hearing, so that a fix taken here can only be the pulse's",
          `${gap.toFixed(0)} units apart`,
        );
      }
      if (gloamfinPulses(snapshot).length > 0) {
        fail(
          "no Gloamfin ping in flight while this scenario's pulse travels; " +
            "specs/predators/gloamfin.md has a ping that reaches the forager " +
            "hand the Gloamfin the same fix this point is timing",
          gloamfinPulses(snapshot).length,
        );
      }
      if (opening === null) opening = { elapsed, state: hunter.state };
      if (mid === null && elapsed >= MID_FRACTION * arrival) {
        mid = { elapsed, state: hunter.state };
      }
      if (chased === null && hunter.state === "chase") chased = elapsed;
      if (chased !== null) break;
    }
    // Held on past the turn, so the clip shows the hunter setting off rather
    // than stopping on the tick its state changed.
    await h.advance(60);
    return { steps, arrival, opening, mid, chased };
  });

  requireSceneHeld(h.snapshot(), watch);

  // One tick after the press the sound has gone nowhere, so nothing can have
  // been heard: this is the half of the claim that says "not at the moment the
  // pulse was emitted".
  assertEqual(
    heard.opening?.state,
    "wander",
    `the Gloamfin's state one tick after the press, with the front barely off ` +
      `the forager's own tile and ${heard.steps} corridor steps still to travel`,
  );

  // Half way through the flight the front is several steps short of the
  // hunter, and the hunter has heard nothing.
  assertEqual(
    heard.mid !== null,
    true,
    `a reading taken ${MID_FRACTION} of the way through the front's ` +
      `${heard.arrival.toFixed(3)} s flight`,
  );
  if (heard.mid !== null) {
    assertEqual(
      heard.mid.state,
      "wander",
      `the Gloamfin's state ${heard.mid.elapsed.toFixed(3)} s after the press, ` +
        `with the front ${(SONAR_WAVE_SPEED * heard.mid.elapsed).toFixed(1)} ` +
        `steps out of the ${heard.steps} it must travel to reach the hunter`,
    );
    // And the mid reading is a fact about the board rather than a tolerance: the
    // hunter's tile has not moved, so the front is still this many steps short of
    // it.
    assertGreaterThanOrEqual(
      heard.steps - SONAR_WAVE_SPEED * heard.mid.elapsed,
      MID_MARGIN_STEPS,
      "the corridor steps still between the front and the tile the hunter was " +
        "posed on, at the mid reading",
    );
  }

  // And by the time the front gets there, it is chasing.
  assertEqual(
    heard.chased !== null,
    true,
    `the Gloamfin turned to chase within ${LATE_SLACK} s of the front reaching ` +
      `it, ${heard.arrival.toFixed(3)} s after the press`,
  );
  if (heard.chased !== null && heard.mid !== null) {
    assertGreaterThanOrEqual(
      heard.chased,
      heard.mid.elapsed,
      "when the Gloamfin turned to chase, against the mid-flight reading at " +
        "which it was still wandering",
    );
    assertLessThanOrEqual(
      heard.chased,
      heard.arrival + LATE_SLACK,
      `when the Gloamfin turned to chase, of the ${heard.arrival.toFixed(3)} s ` +
        `the front takes to travel the ${heard.steps} corridor steps between ` +
        "the forager's tile and the one the hunter is held on",
    );
  }
});
