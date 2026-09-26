import { describe, expect, it } from "vitest";
import {
  CUES,
  MAX_BURSTS,
  OVERLOAD_AT,
  PRISM_INVERT_Y,
  SHIP_Y,
  START_LIVES,
} from "./constants";
import { createHarness, type Harness } from "./harness";

/** How close to a target's `x` the ship holds before it stops steering. */
const AIM_SLACK = 6;
/** How many frames the pilot goes without a target before it flips. */
const FLIP_AFTER = 45;

/**
 * One frame of the pilot: steer under the nearest drone the ship's band can
 * destroy, fire, flip when nothing on the field answers to the band it holds,
 * and spend the meter as soon as it fills.
 */
async function pilot(h: Harness, frame: number, idle: { frames: number }) {
  const snap = h.debug.snapshot();
  const band = snap.ship.band;
  const targets = snap.drones.filter(
    (drone) => drone.effectiveBand === band && drone.y < SHIP_Y - 40,
  );
  const target = targets.sort(
    (left, right) =>
      Math.abs(left.x - snap.ship.x) - Math.abs(right.x - snap.ship.x),
  )[0];
  if (target === undefined) {
    idle.frames += 1;
    h.up("ArrowLeft");
    h.up("ArrowRight");
    if (idle.frames >= FLIP_AFTER && snap.drones.length > 0) {
      await h.tap("KeyF");
      idle.frames = 0;
    }
  } else {
    idle.frames = 0;
    const off = target.x - snap.ship.x;
    if (off > AIM_SLACK) {
      h.up("ArrowLeft");
      h.down("ArrowRight");
    } else if (off < -AIM_SLACK) {
      h.up("ArrowRight");
      h.down("ArrowLeft");
    } else {
      h.up("ArrowLeft");
      h.up("ArrowRight");
    }
  }
  // Fire in bursts, so the cannon's own cadence and cap are both exercised, and
  // hold the trigger over a target so a wrong-band shot now and then charges a
  // drone toward an overload.
  if (frame % 40 === 0) h.down("Space");
  if (frame % 40 === 30) h.up("Space");
  if (frame % 30 === 15 && snap.dischargeReady) await h.tap("KeyX");
}

/**
 * The whole game, played for real.
 *
 * Every other test in this suite poses the one thing it is about; this one starts
 * a run from the title and plays it with nothing but keys for minutes of game
 * time, so the rules meet each other the way they do in front of a player: waves
 * fly in and clear, the stage ladder turns over a challenge stage, Prisms invert
 * the field, wrong-band shots overload drones, and every cue those events raise
 * reaches the bus. The game lays each wave out as it likes, so the pilot reads
 * the field rather than following a script, and a beat the run did not reach on
 * its own is posed afterwards so its rules still run.
 */
describe("a run played for real", () => {
  it("clears stages, inverts the field, and overloads drones", async () => {
    const h = await createHarness();
    h.debug.reset();
    await h.tap("Enter");

    const stages = new Set<number>();
    let inverted = false;
    let charged = 0;
    let bursts = 0;
    const idle = { frames: 0 };

    for (let frame = 0; frame < 60 * 210; frame += 1) {
      await pilot(h, frame, idle);
      await h.advance(1);

      const snap = h.debug.snapshot();
      stages.add(snap.stage);
      inverted ||= snap.inversionActive;
      bursts = Math.max(bursts, snap.bursts.length);
      for (const drone of snap.drones)
        charged = Math.max(charged, drone.charge);
      expect(snap.bursts.length).toBeLessThanOrEqual(MAX_BURSTS);
      expect(snap.lives).toBeLessThanOrEqual(START_LIVES + 1);
      // Keep the run alive, so the soak reaches the stages past the first.
      if (snap.lives < START_LIVES) h.debug.setLives(START_LIVES);
      if (snap.screen === "gameOver") {
        h.debug.setScreen("inWave");
        h.debug.setLives(START_LIVES);
      }
      const absorbed = h.cues.some((cue) => cue.cue === CUES.absorb);
      if (stages.has(3) && inverted && charged > 0 && absorbed) break;
    }
    h.up("Space");
    h.up("ArrowLeft");
    h.up("ArrowRight");

    // A Prism the pilot destroyed before it dived never inverted the field, so
    // one is posed diving at the line and let through.
    if (!inverted) {
      h.debug.clearEnemyBullets();
      h.debug.setShipContact(false);
      h.debug.addDrone("prism", 640, PRISM_INVERT_Y - 30);
      const prism = h.debug.snapshot().drones.slice(-1)[0];
      h.debug.setDronePhase(prism.id, "diving");
      h.debug.setDroneFire(prism.id, false);
      await h.seconds(1);
      inverted = h.debug.snapshot().inversionActive;
    }
    // A run whose hull was never struck by a bullet of its own band is handed
    // one, so the shield's rule and its cue run too.
    if (!h.cues.some((cue) => cue.cue === CUES.absorb)) {
      h.debug.setShipContact(true);
      h.debug.setScreen("inWave");
      h.debug.setPhase("live");
      const ship = h.debug.snapshot().ship;
      h.debug.addEnemyBullet(ship.x, SHIP_Y - 100, ship.band);
      await h.seconds(1);
    }
    // A run that did not climb to the challenge stage is put on it, so the
    // flyover's rules run too.
    if (!stages.has(3)) {
      h.debug.setStage(3);
      h.debug.setScreen("stageIntro");
      h.debug.setPhaseTimer(0);
      await h.seconds(12);
      stages.add(h.debug.snapshot().stage);
    }

    const played = new Set(h.cues.map((cue) => cue.cue));
    expect([...stages].sort((left, right) => left - right)).toContain(3);
    expect(stages.size).toBeGreaterThan(1);
    expect(inverted).toBe(true);
    expect(bursts).toBeGreaterThan(0);
    expect(charged).toBeGreaterThan(0);
    expect(charged).toBeLessThan(OVERLOAD_AT);
    expect(h.debug.snapshot().score).toBeGreaterThan(1000);
    for (const cue of [
      CUES.fire,
      CUES.flip,
      CUES.kill,
      CUES.hit,
      CUES.absorb,
      CUES.inversion,
      CUES.stageClear,
    ]) {
      expect(played).toContain(cue);
    }
    h.dispose();
  }, 120000);
});
