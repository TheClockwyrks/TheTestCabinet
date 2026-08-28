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
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNull,
} from "../assert";
import {
  GLOAMFIN_HEAR,
  PREDATOR_SPEED,
  SONAR_WAVE_SPEED,
  TICK_HZ,
  TILE,
} from "../../src/constants";
import { poseSightLine } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  clearUnderfoot,
  denAll,
  failPrecondition,
  parkForager,
  requireKind,
  requirePredatorMotion,
  sceneGuard,
  sceneHeld,
} from "../scene";
import { emitPulse, gloamfinPulses, sinceEmit } from "./pulse";

/**
 * How far down the corridor the Gloamfin is posed, in tiles.
 *
 * Five, which is `160` units — well over twice the `GLOAMFIN_HEAR` (`64`) close
 * hearing reaches — and which leaves the whole of the flight inside the `9`
 * corridor steps a depth-1 pulse carries even after the hunter has wandered
 * outward for it.
 */
const GAP_TILES = 5;

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
  startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: 0,
    tail: TAIL_TILES,
  });
  await parkForager(h, line.forager);
  await clearUnderfoot(h);

  const posed = h.snapshot();
  const gloamfin = requireKind(posed, "gloamfin");
  const quiet = await denAll(h, [gloamfin]);
  h.debug.setPredatorTile(gloamfin, line.pred.tx, line.pred.ty);
  // Facing away down the corridor, so its patrol opens outward rather than
  // straight at the forager.
  h.debug.setPredatorDir(gloamfin, line.dir);
  h.debug.setPredatorState(gloamfin, "wander");

  const watch = await sceneGuard(h, quiet);

  const heard = await captureReplay(h, "heard", async () => {
    const settled0 = h.snapshot();
    await h.advance(SETTLE_TICKS);
    const settled = h.snapshot();
    // A hunter that never travels has not been shown wandering, and whether a
    // released predator patrols under its own power is the den and patrol
    // points' verdict.
    requirePredatorMotion(
      settled0,
      settled,
      gloamfin,
      "patrol the corridor it was posed on",
    );
    if (settled.predators[gloamfin].state !== "wander") {
      failPrecondition(
        "the Gloamfin to be wandering when the pulse is cast, so that the turn " +
          "this point times is the pulse's doing; specs/predators/gloamfin.md " +
          "gives it three ways to take a fix and the other two are shut out here",
        "the gloamfin points",
        settled.predators[gloamfin].state,
      );
    }
    if (gloamfinPulses(settled).length > 0) {
      failPrecondition(
        "no Gloamfin ping in flight when this scenario casts its pulse; " +
          "specs/predators/gloamfin.md has a ping that reaches the forager hand " +
          "the Gloamfin the same fix this point is timing",
        "the gloamfin ping points",
        gloamfinPulses(settled).length,
      );
    }

    const steps = Math.abs(settled.predators[gloamfin].tx - settled.forager.tx);
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
      const gap = Math.hypot(
        hunter.x - snapshot.forager.x,
        hunter.y - snapshot.forager.y,
      );
      if (gap <= GLOAMFIN_HEAR) {
        failPrecondition(
          "the wandering Gloamfin to stay outside the GLOAMFIN_HEAR " +
            `(${GLOAMFIN_HEAR}) units specs/predators/gloamfin.md gives its ` +
            "close hearing, so that a fix taken here can only be the pulse's",
          "the gloamfin close-hearing points",
          `${gap.toFixed(0)} units apart`,
        );
      }
      if (gloamfinPulses(snapshot).length > 0) {
        failPrecondition(
          "no Gloamfin ping in flight while this scenario's pulse travels; " +
            "specs/predators/gloamfin.md has a ping that reaches the forager " +
            "hand the Gloamfin the same fix this point is timing",
          "the gloamfin ping points",
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
    return { steps, arrival, closing, opening, mid, chased };
  });

  assertNull(sceneHeld(h.snapshot(), watch), "the scenario held to the end");

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
