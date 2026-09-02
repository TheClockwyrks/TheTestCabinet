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
// the alternatives impossible. The Gloamfin stands `GAP_TILES` steps down a
// straight corridor, which is `GAP_TILES / SONAR_WAVE_SPEED` seconds of flight —
// long enough that "on arrival" and "at the press" are most of half a second
// apart and a build that hands the fix out with the press is caught halfway
// through, still wandering by the page's own account and already chasing by its
// own.
//
// WHAT THE GLOAMFIN IS POSED WITH. Its mind alone. What this point grades is a
// sense being handed a fix, so the hunter runs its own senses and its travel is
// HELD: it stays in `"wander"`, hears what reaches it, and never leaves the tile
// the fixture stood it on. The flight is then exactly the fixture's own
// arithmetic — `GAP_TILES` steps at `SONAR_WAVE_SPEED` — rather than a race
// between a front and a body running away from it. How a Gloamfin travels is
// `gloamfin/wander-speed`'s and `gloamfin/chase-cap`'s.
//
// THE OTHER TWO SENSES ARE SHUT OUT BY THE FIXTURE, and the sweep asserts that
// they stayed shut out. specs/predators/gloamfin.md gives the Gloamfin three ways
// to be caught, and the other two would both produce a chase this scenario would
// read as the pulse's doing. CLOSE HEARING reaches `GLOAMFIN_HEAR` (`64`) units,
// and the pair stands `GAP_TILES` tiles apart for the whole measurement, which the
// sweep reads off the board every tick rather than assuming. ITS OWN PING would
// catch the forager `d / SONAR_WAVE_SPEED` seconds after it is cast, which on this
// board is the same arithmetic as the pulse being timed — and a hunter spawned a
// moment earlier carries a whole `GLOAMFIN_PING_INTERVAL` before its first, far
// longer than this half-second flight, so the sweep FAILS if one is ever in
// flight.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { GLOAMFIN_HEAR, SONAR_WAVE_SPEED, TICK_HZ } from "../constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import {
  fromForager,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { emitPulse, gloamfinPulses, sinceEmit } from "./pulse";

/**
 * How far down the corridor the Gloamfin stands, in tiles.
 *
 * Six, which is `192` units — three times the `GLOAMFIN_HEAR` (`64`) close
 * hearing reaches, so nothing it hears here is heard by ear — and well inside the
 * `9` corridor steps a depth-1 pulse carries. Six steps at `SONAR_WAVE_SPEED` is
 * `0.43 s` of flight, which is the delay this point is about.
 */
const GAP_TILES = 6;

/**
 * Corridor beyond the Gloamfin, in tiles.
 *
 * Three, which takes the run out to the ninth step and no further, so the pulse
 * floods past the tile being timed rather than ending on it and the arrival is an
 * ordinary step of an ordinary wavefront.
 */
const TAIL_TILES = 3;

/** Ticks run after the pose, so the scene is settled before anything is read. */
const SETTLE_TICKS = 15;

/**
 * Where inside the flight the "still wandering" reading is taken, as a fraction.
 *
 * Half way. A conforming front stands `GAP_TILES / 2` steps out there, three whole
 * steps short of the hunter, so "it has not been reached yet" is a fact about the
 * board rather than a tolerance.
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
 * How long past the flight the fix may land, in seconds.
 *
 * Fifteen hundredths, which is two whole steps of the front (`1 / 14 s` each) and
 * a beat — room for the tick a build happens to resolve the arrival on, and
 * nothing like the `0.21 s` that separates the mid reading from the arrival. A
 * HARD ceiling: a build that hands the fix over late, or not at all, FAILS here
 * rather than leaving the point undecided.
 */
const LATE_SLACK = 0.15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands a wandering Gloamfin its fix when the front arrives, not when the pulse is cast", async () => {
  await startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: 0,
    tail: TAIL_TILES,
  });
  await parkForager(h, line.forager);

  // Facing away down the corridor, and held there: its senses run, its body does
  // not, so the fix it takes is one the front brought it.
  const gloamfin = await spawnPredator(h, "gloamfin", line.pred, {
    dir: line.dir,
    state: "wander",
    travel: false,
  });

  const watch = await sceneGuard(h);

  const heard = await captureReplay(h, "heard", async () => {
    await h.advance(SETTLE_TICKS);
    const settled = await h.snapshot();
    // The turn this point times is a turn OUT of a wander, so the hunter has to
    // be wandering when the pulse is cast and nothing else may have handed it
    // the same fix.
    assertEqual(
      settled.predators[gloamfin].state,
      "wander",
      "the Gloamfin's state before any pulse was cast, six tiles down a " +
        "corridor from a dark forager — a hunter already chasing has no turn " +
        "for this point to time",
    );
    assertLength(
      gloamfinPulses(settled),
      0,
      "Gloamfin pings in flight when this scenario was about to cast its " +
        "pulse — a ping that reaches the forager hands the same fix this point " +
        "is timing",
    );

    const steps = Math.abs(settled.predators[gloamfin].tx - settled.forager.tx);
    const arrival = steps / SONAR_WAVE_SPEED;

    const emitted = await emitPulse(h);
    const sweepTicks = Math.ceil((arrival + LATE_SLACK) * TICK_HZ);
    let opening: { elapsed: number; state: string } | null = null;
    let mid: { elapsed: number; state: string } | null = null;
    let chased: number | null = null;
    for (let tick = 1; tick <= sweepTicks; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = await h.snapshot();
      const elapsed = sinceEmit(emitted, snapshot);
      const hunter = snapshot.predators[gloamfin];
      const gap = fromForager(snapshot, hunter.x, hunter.y);
      assertGreaterThan(
        gap,
        GLOAMFIN_HEAR,
        "the units between the two centres while the front was in flight, " +
          `against the GLOAMFIN_HEAR (${GLOAMFIN_HEAR}) close hearing reaches ` +
          "— a fix taken from inside that reach need not be the pulse's",
      );
      assertLength(
        gloamfinPulses(snapshot),
        0,
        "Gloamfin pings in flight while this scenario's pulse was travelling " +
          "— a ping that reaches the forager hands the same fix this point is " +
          "timing",
      );
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

  requireSceneHeld(await h.snapshot(), watch);

  // The fixture's own geometry: the flight this point times is the one the board
  // lays out, and the hunter held the tile it was stood on throughout.
  assertEqual(
    heard.steps,
    GAP_TILES,
    "the corridor steps between the forager and the Gloamfin when the pulse " +
      "was cast, which the fixture stamped and a held body cannot change",
  );

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
    // And the mid reading is a fact about the board rather than a tolerance:
    // the hunter is standing still, so the front has this much left to cover.
    assertGreaterThanOrEqual(
      heard.steps - SONAR_WAVE_SPEED * heard.mid.elapsed,
      MID_MARGIN_STEPS,
      "the corridor steps still between the front and the hunter at the mid " +
        "reading",
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
        `the front takes to cross the ${heard.steps} corridor steps between ` +
        "the two",
    );
  }
});
