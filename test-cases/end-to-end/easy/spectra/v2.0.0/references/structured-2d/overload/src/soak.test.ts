import { describe, expect, it } from "vitest";
import { CUES, MAX_BURSTS, OVERLOAD_AT, START_LIVES } from "./constants";
import { createHarness } from "./harness";

/**
 * The whole game, played for real.
 *
 * Every other test in this suite poses the one thing it is about; this one starts
 * a run from the title and plays it with nothing but keys for two minutes of game
 * time, so the rules meet each other the way they do in front of a player: waves
 * fly in and clear, the stage ladder turns over a challenge stage, Prisms invert
 * the field, wrong-band shots overload drones, and every cue those events raise
 * reaches the bus. It is driven by a scripted clock and a seeded run, so it is the
 * same two minutes every time.
 */
describe("a run played for real", () => {
  it("clears stages, inverts the field, and overloads drones", async () => {
    const h = await createHarness();
    h.debug.reset({ seed: 5 });
    await h.tap("Enter");

    const stages = new Set<number>();
    let inverted = false;
    let charged = 0;
    let bursts = 0;
    let firing = false;

    for (let frame = 0; frame < 60 * 210; frame += 1) {
      // Fire in bursts, sweep the lane, and flip often enough that shots of both
      // bands land — which is what makes wrong-band shots, and overloads, happen.
      if (frame % 30 === 0) {
        if (firing) h.up("Space");
        else h.down("Space");
        firing = !firing;
      }
      if (frame % 97 === 0) await h.tap("KeyF");
      if (frame % 53 === 0) {
        h.down(frame % 106 === 0 ? "ArrowLeft" : "ArrowRight");
      }
      if (frame % 53 === 26) {
        h.up("ArrowLeft");
        h.up("ArrowRight");
      }
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
    }

    const played = new Set(h.cues.map((cue) => cue.cue));
    expect([...stages].sort((left, right) => left - right)).toContain(3);
    expect(stages.size).toBeGreaterThan(2);
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
      CUES.overload,
      CUES.stageClear,
    ]) {
      expect(played).toContain(cue);
    }
    h.dispose();
  }, 120000);
});
