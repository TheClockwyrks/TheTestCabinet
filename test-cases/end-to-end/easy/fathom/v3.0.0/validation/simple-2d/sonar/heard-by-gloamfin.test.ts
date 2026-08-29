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
// THE OTHER TWO SENSES ARE SHUT OUT, not hoped away.
// specs/predators/gloamfin.md gives the Gloamfin three ways to be caught, and the
// other two would both produce a chase this scenario would read as the pulse's
// doing. CLOSE HEARING reaches `GLOAMFIN_HEAR` (`64`) units, so the sweep checks
// the gap between the two centres every tick and stands the check DOWN if a
// wandering Gloamfin ever closes inside it. ITS OWN PING would catch the forager
// `d / SONAR_WAVE_SPEED` seconds after it is cast, which on this board is the
// same arithmetic as the pulse being timed — so the sweep stands the check down
// if a Gloamfin ping is ever in flight, and confirms none is before the press.
// Both refusals defer rather than fail: how a Gloamfin hears is
// `gloamfin/*`'s.
//
// THE HUNTER IS LEFT WANDERING UNDER ITS OWN MIND, which is the only way the fix
// can be earned rather than posed, and it is posed FACING OUTWARD with four
// tiles of corridor ahead of it. That is deliberate. A wanderer travelling at
// `PREDATOR_SPEED` (`116`) covers a tile every quarter second while the front
// covers one every fourteenth, so a hunter swimming TOWARD the front can cross
// from one tile to the next in the gap between the front sweeping over each of
// them; one swimming away from it cannot, because the front is the faster of the
// two and closes. Facing it outward, with more corridor ahead than it can use
// inside the flight, is what makes the arrival a fact rather than a coin toss —
// and the arrival is then bounded by that closing rate rather than by the flight
// time of a stationary target.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  GLOAMFIN_HEAR,
  PREDATOR_SPEED,
  SONAR_WAVE_SPEED,
  TICK_HZ,
  TILE,
} from "../../src/constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  fromForager,
  parkForager,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { FathomSnapshot } from "../surface";
import { emitPulse, gloamfinPulses, sinceEmit } from "./pulse";

/**
 * How far down the corridor the Gloamfin is posed, in tiles.
 *
 * Six, which is `192` units — three times the `GLOAMFIN_HEAR` (`64`) close
 * hearing reaches — and well inside the `9` corridor steps a depth-1 pulse
 * carries. The hunter patrols in from there, and the pulse is cast when it is a
 * few steps out; posing it there instead would leave nothing to patrol.
 */
const GAP_TILES = 6;

/**
 * Corridor beyond the Gloamfin, in tiles.
 *
 * Four, which takes the run out to the ninth step and no further. A wanderer
 * covers `PREDATOR_SPEED / TILE` tiles a second, so four tiles is more than a
 * second of outward travel — twice the whole flight — and the hunter never
 * reaches the rock at the end and turns back into the front while it is being
 * timed.
 */
const TAIL_TILES = 4;

/** Ticks of wandering before the press, so the hunter is demonstrably under way. */
const SETTLE_TICKS = 15;

/**
 * How long the scenario waits for a tick to cast on, in ticks.
 *
 * Two seconds. A wanderer crosses a tile in `TILE / PREDATOR_SPEED` — a third of
 * a second — so this covers the whole of a patrol in from `GAP_TILES` and several
 * crossings besides. A HARD ceiling: a hunter that never comes within a pulse's
 * reach of the forager on the corridor this fixture posed has not patrolled it.
 */
const PHASE_TICKS = ticks(2);

/** How long the front takes to reach the tile the hunter is on, in seconds. */
function frontArrives(snap: FathomSnapshot, index: number): number {
  const steps = Math.abs(snap.predators[index].tx - snap.forager.tx);
  return steps / SONAR_WAVE_SPEED;
}

/**
 * How long the hunter has left on the tile it is on, in seconds.
 *
 * `specs/state.md` puts a body on "the tile whose bounds contain its center", so
 * the tile turns over when the center crosses the edge it is running at, and the
 * hunter's own reported speed says when. A hunter at rest holds its tile for as
 * long as the scenario needs, which is what `Infinity` reports.
 */
function leavesIn(snap: FathomSnapshot, index: number): number {
  const hunter = snap.predators[index];
  if (hunter.speed <= 0) return Number.POSITIVE_INFINITY;
  const left = snap.grid.originX + hunter.tx * TILE;
  const edge = hunter.dir === "left" ? left : left + TILE;
  return Math.abs(edge - hunter.x) / hunter.speed;
}

/**
 * Where inside the flight the "still wandering" reading is taken, as a fraction.
 *
 * Half way. A conforming front stands `GAP_TILES / 2` steps out there, and a
 * Gloamfin travelling at `PREDATOR_SPEED` for that long has closed at most
 * `PREDATOR_SPEED * t / TILE` — under a tile — so the front is genuinely several
 * steps short of it and "it has not been reached yet" is a fact about the board
 * rather than a tolerance.
 */
const MID_FRACTION = 0.5;

/**
 * The corridor steps that must still separate the front from the hunter at the
 * mid reading, even with the hunter swimming straight at the forager.
 *
 * One whole step. Below that the mid reading would be a tolerance rather than a
 * fact about the board, and the scenario should be widened rather than the
 * reading trusted.
 */
const MID_MARGIN_STEPS = 1;

/**
 * How fast the front closes on a hunter wandering away from it, in corridor
 * steps per second.
 *
 * The front's own `SONAR_WAVE_SPEED` less the `PREDATOR_SPEED / TILE` tiles a
 * second a wanderer covers: `10.375`. A hunter posed `d` steps out and swimming
 * away is therefore reached `d / CLOSING_SPEED` seconds after the press rather
 * than the `d / SONAR_WAVE_SPEED` a standing one would be.
 */
const CLOSING_SPEED = SONAR_WAVE_SPEED - PREDATOR_SPEED / TILE;

/**
 * How long past that closing time the fix may land, in seconds.
 *
 * Fifteen hundredths: a whole tile of the hunter's own travel, which is the
 * longest the front can be inside its tile before the tick that sweeps it, and a
 * beat. A HARD ceiling — a build that hands the fix over late, or not at all,
 * FAILS here rather than leaving the point undecided.
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
  await startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: 0,
    tail: TAIL_TILES,
  });
  await parkForager(h, line.forager);

  // Facing away down the corridor, so its patrol opens outward rather than
  // straight at the forager.
  const gloamfin = await spawnPredator(h, "gloamfin", line.pred, {
    dir: line.dir,
    state: "wander",
  });

  const watch = await sceneGuard(h);

  const heard = await captureReplay(h, "heard", async () => {
    const settled0 = h.snapshot();
    await h.advance(SETTLE_TICKS);
    const settled = h.snapshot();
    // The turn this point times is a turn OUT of a patrol, so the hunter has to
    // be patrolling when the pulse is cast and nothing else may have handed it
    // the same fix.
    requirePredatorMotion(
      settled0,
      settled,
      gloamfin,
      "patrol the corridor it was posed on",
    );
    assertEqual(
      settled.predators[gloamfin].state,
      "wander",
      "the Gloamfin's state before any pulse was cast, which is the patrol " +
        "the pulse then turns it out of",
    );
    assertLength(
      gloamfinPulses(settled),
      0,
      "Gloamfin pings in flight when the scenario was about to cast its " +
        "pulse — a ping that reaches the forager hands the same fix this " +
        "point is timing",
    );

    // THE MOMENT THE PULSE IS CAST IS CHOSEN, and this is the whole of what
    // choosing it does. The front sweeps whole corridor tiles, so "it reached
    // the hunter" means it crossed the tile the hunter was standing on — and a
    // hunter that steps off that tile on the very tick the front crosses it
    // was neither reached nor missed by anything this point could call a
    // verdict. Both figures come off the build's own snapshot: the front
    // covers a step in `1 / SONAR_WAVE_SPEED` seconds, and the hunter's
    // reported speed carries it over the tile edge it is running at in the
    // ground it has left to cover. The pulse waits for the first tick where
    // the front can cross the hunter's tile before the hunter can leave it.
    const ready = await h.until(
      (snap) => frontArrives(snap, gloamfin) < leavesIn(snap, gloamfin),
      { maxFrames: PHASE_TICKS, poll: 1 },
    );
    assertEqual(
      ready.hit,
      true,
      `the wandering Gloamfin held a tile long enough for the front to cross ` +
        `it, inside ${PHASE_TICKS} ticks — a hunter that crosses a tile ` +
        "faster than a pulse crosses the corridor to it cannot be reached by " +
        "one at all",
    );

    const cast = h.snapshot();
    const steps = Math.abs(cast.predators[gloamfin].tx - cast.forager.tx);
    const arrival = steps / SONAR_WAVE_SPEED;
    const closing = steps / CLOSING_SPEED;

    const emitted = await emitPulse(h);
    const sweepTicks = Math.ceil((closing + LATE_SLACK) * TICK_HZ);
    let opening: { elapsed: number; state: string } | null = null;
    let mid: { elapsed: number; state: string } | null = null;
    let chased: number | null = null;
    for (let tick = 1; tick <= sweepTicks; tick += 1) {
      if (tick > 1) await h.advance(1);
      const snapshot = h.snapshot();
      const elapsed = sinceEmit(emitted, snapshot);
      const hunter = snapshot.predators[gloamfin];
      const gap = fromForager(snapshot, hunter.x, hunter.y);
      assertGreaterThan(
        gap,
        GLOAMFIN_HEAR,
        `the logical units between the wandering Gloamfin and the forager ` +
          `while the pulse was in flight, against the GLOAMFIN_HEAR ` +
          `(${GLOAMFIN_HEAR}) its close hearing reaches — a fix taken from ` +
          "inside that reach need not be the pulse's",
      );
      assertLength(
        gloamfinPulses(snapshot),
        0,
        "Gloamfin pings in flight while this scenario's pulse was travelling " +
          "— a ping that reaches the forager hands the same fix this point " +
          "is timing",
      );
      if (opening === null) opening = { elapsed, state: hunter.state };
      if (mid === null && elapsed >= MID_FRACTION * arrival) {
        mid = { elapsed, state: hunter.state };
      }
      if (chased === null && hunter.state === "chase") chased = elapsed;
      if (chased !== null) break;
    }
    // The scene is read HERE, at the end of the measurement. What follows is
    // the clip's tail, over which a hunter that has just taken its fix is free
    // to close on the forager and catch it — which is the scenario doing
    // exactly what this point just watched it start to do.
    const ended = h.snapshot();
    // Held on past the turn, so the clip shows the hunter setting off rather
    // than stopping on the tick its state changed.
    await h.advance(60);
    return { steps, arrival, closing, opening, mid, chased, ended };
  });

  requireSceneHeld(heard.ended, watch);

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
    // even a Gloamfin that swam straight at the forager for the whole of it is
    // still further out than the front has reached, by this margin.
    assertGreaterThanOrEqual(
      heard.steps -
        (PREDATOR_SPEED * heard.mid.elapsed) / TILE -
        SONAR_WAVE_SPEED * heard.mid.elapsed,
      MID_MARGIN_STEPS,
      "the corridor steps still between the front and the nearest the hunter " +
        "could have wandered to, at the mid reading",
    );
  }

  // And by the time the front gets there, it is chasing.
  assertEqual(
    heard.chased !== null,
    true,
    `the Gloamfin turned to chase within ${LATE_SLACK} s of the front reaching ` +
      `it, ${heard.closing.toFixed(3)} s after the press`,
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
      heard.closing + LATE_SLACK,
      `when the Gloamfin turned to chase, of the ${heard.closing.toFixed(3)} s ` +
        "the front takes to close on a hunter wandering away from it down the " +
        `${heard.steps} corridor steps it was posed at`,
    );
  }
});
