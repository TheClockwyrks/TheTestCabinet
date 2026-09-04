import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  CUES,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  RESONANCE_MAX,
  SHIP_SPEED,
  START_LIVES,
  STAGE_INTRO_HOLD,
  TAGS,
  TITLE_ITEMS,
} from "./constants";
import { createHarness, startPosed, type Harness } from "./harness";

async function live(): Promise<Harness> {
  const h = await createHarness();
  startPosed(h.debug);
  return h;
}

describe("the engine the game runs inside", () => {
  it("opens the one level with its state and its player", async () => {
    const h = await createHarness();
    expect(h.engine.world.level).toBe("field");
    expect(h.engine.world.players()).toHaveLength(1);
    expect(h.engine.world.players()[0]?.pawn).toBeNull();
    expect(h.state.screen).toBe("title");
    h.dispose();
  });

  it("keeps the field's actors in step with the rosters", async () => {
    const h = await live();
    h.debug.addDrone("shard", 400, 200);
    h.debug.addPlayerBullet(400, 500, "cyan");
    h.debug.addEnemyBullet(500, 300, "magenta");
    await h.advance(1);
    expect(h.engine.world.byTag(TAGS.ship)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.drone)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.playerBullet)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.enemyBullet)).toHaveLength(1);
    const drone = h.engine.world.byTag(TAGS.drone)[0];
    // It rides the formation sway, so it is at its slot rather than exactly on it.
    expect(Math.abs(drone.transform.x - 400)).toBeLessThan(1);
    h.debug.clearDrones();
    await h.advance(2);
    expect(h.engine.world.byTag(TAGS.drone)).toHaveLength(0);
    h.dispose();
  });

  it("advances the game on the clock alone", async () => {
    const h = await live();
    h.debug.addDrone("shard", 400, 200);
    const id = h.debug.snapshot().drones[0].id;
    h.debug.setDronePhase(id, "diving");
    const before = h.debug.snapshot();
    await h.seconds(1);
    const after = h.debug.snapshot();
    expect(after.simTime).toBeGreaterThan(before.simTime);
    expect(after.drones[0].y).toBeGreaterThan(before.drones[0].y);
    h.dispose();
  });
});

describe("the keys each screen reads", () => {
  it("moves the ship on both of each direction's keys", async () => {
    for (const [code, sign] of [
      ["ArrowLeft", -1],
      ["KeyA", -1],
      ["ArrowRight", 1],
      ["KeyD", 1],
    ] as const) {
      const h = await live();
      const from = h.debug.snapshot().ship.x;
      h.down(code);
      await h.seconds(1);
      h.up(code);
      const moved = h.debug.snapshot().ship.x - from;
      expect(Math.sign(moved)).toBe(sign);
      expect(Math.abs(moved)).toBeGreaterThan(SHIP_SPEED * 0.9);
      h.dispose();
    }
  });

  it("fires on each of the fire keys, and repeats while one is held", async () => {
    for (const code of BINDINGS.a) {
      const h = await live();
      await h.tap(code);
      expect(
        h.debug.snapshot().bullets.filter((bullet) => bullet.friendly).length,
      ).toBeGreaterThan(0);
      h.dispose();
    }
    const held = await live();
    held.down("Space");
    await held.seconds(1);
    const seen = new Set(held.debug.snapshot().bullets.map((b) => b.id));
    await held.seconds(0.5);
    for (const bullet of held.debug.snapshot().bullets) seen.add(bullet.id);
    expect(seen.size).toBeGreaterThan(1);
    held.dispose();
  });

  it("flips on each of the flip keys, exactly once per press", async () => {
    for (const code of BINDINGS.b) {
      const h = await live();
      await h.tap(code);
      expect(h.debug.snapshot().ship.band).toBe("magenta");
      h.dispose();
    }
    const held = await live();
    held.down("KeyF");
    await held.seconds(1);
    expect(held.debug.snapshot().ship.band).toBe("magenta");
    held.dispose();
  });

  it("discharges on its own key, with a full meter", async () => {
    const h = await live();
    h.debug.setResonance(RESONANCE_MAX);
    await h.tap("KeyX");
    const snap = h.debug.snapshot();
    expect(snap.discharge.active).toBe(true);
    expect(snap.resonance).toBe(0);
    h.dispose();
  });

  it("pauses on either key and resumes from the paused screen", async () => {
    for (const code of ["Escape", "KeyP"]) {
      const h = await live();
      await h.tap(code);
      expect(h.debug.snapshot().screen).toBe("paused");
      await h.tap("KeyP");
      expect(h.debug.snapshot().screen).toBe("inWave");
      h.dispose();
    }
  });

  it("drives the title menu, and confirms on either key", async () => {
    for (const code of ["Enter", "Space"]) {
      const h = await createHarness();
      h.debug.reset();
      await h.tap("ArrowDown");
      expect(h.debug.snapshot().menuIndex).toBe(1);
      await h.tap("KeyW");
      expect(h.debug.snapshot().menuIndex).toBe(0);
      await h.tap("KeyS");
      expect(h.debug.snapshot().menuIndex).toBe(1);
      await h.tap("ArrowUp");
      expect(h.debug.snapshot().menuIndex).toBe(0);
      await h.tap(code);
      expect(h.debug.snapshot().screen).toBe("stageIntro");
      expect(h.debug.snapshot().stage).toBe(1);
      expect(h.debug.snapshot().lives).toBe(START_LIVES);
      h.dispose();
    }
  });

  it("wraps the highlight at both ends of a menu", async () => {
    const h = await createHarness();
    h.debug.reset();
    await h.tap("ArrowUp");
    expect(h.debug.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    await h.tap("ArrowDown");
    expect(h.debug.snapshot().menuIndex).toBe(0);
    h.dispose();
  });

  it("opens how to play and comes back on the back key", async () => {
    const h = await createHarness();
    h.debug.reset();
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(h.debug.snapshot().screen).toBe("howto");
    await h.tap("Escape");
    expect(h.debug.snapshot().screen).toBe("title");
    // specs/ui.md: an arrival back at the title highlights the entry that led
    // away from it, which for the how-to-play screen is `HOW TO PLAY`.
    expect(h.debug.snapshot().menuIndex).toBe(
      TITLE_ITEMS.indexOf("HOW TO PLAY"),
    );
    h.dispose();
  });

  it("restarts and quits from the pause menu", async () => {
    const h = await live();
    h.debug.setScore(400);
    await h.tap("KeyP");
    await h.tap("ArrowDown");
    await h.tap("Enter");
    expect(h.debug.snapshot()).toMatchObject({
      screen: "stageIntro",
      score: 0,
      stage: 1,
      lives: START_LIVES,
    });
    h.debug.setScreen("paused");
    h.debug.setMenuIndex(PAUSE_ITEMS.length - 1);
    await h.tap("Enter");
    expect(h.debug.snapshot().screen).toBe("title");
    h.dispose();
  });

  it("plays again and returns to the menu from game over", async () => {
    const h = await live();
    h.debug.setScreen("gameOver");
    h.debug.setMenuIndex(0);
    h.debug.setScore(900);
    await h.tap("Enter");
    expect(h.debug.snapshot()).toMatchObject({
      screen: "stageIntro",
      score: 0,
    });
    h.debug.setScreen("gameOver");
    h.debug.setMenuIndex(GAME_OVER_ITEMS.length - 1);
    await h.tap("Enter");
    expect(h.debug.snapshot().screen).toBe("title");
    h.dispose();
  });

  it("mutes on its own key, from any screen", async () => {
    const h = await live();
    await h.tap("KeyM");
    expect(h.debug.snapshot().muted).toBe(true);
    await h.tap("KeyM");
    expect(h.debug.snapshot().muted).toBe(false);
    h.dispose();
  });
});

describe("the cues", () => {
  it("plays one on each event, and none before the first key", async () => {
    const h = await createHarness();
    await h.seconds(2);
    expect(h.cues).toHaveLength(0);

    startPosed(h.debug);
    await h.tap("Space");
    expect(h.cues.some((cue) => cue.cue === CUES.fire)).toBe(true);

    h.cues.length = 0;
    await h.tap("KeyF");
    expect(h.cues.some((cue) => cue.cue === CUES.flip)).toBe(true);

    h.cues.length = 0;
    h.debug.addDrone("shard", 400, 200);
    h.debug.addPlayerBullet(400, 200, "cyan");
    await h.advance(1);
    expect(h.cues.some((cue) => cue.cue === CUES.kill)).toBe(true);
    expect(h.cues.some((cue) => cue.cue === CUES.stageClear)).toBe(true);

    h.cues.length = 0;
    startPosed(h.debug);
    h.debug.setResonance(RESONANCE_MAX);
    await h.tap("KeyX");
    expect(h.cues.some((cue) => cue.cue === CUES.discharge)).toBe(true);

    h.cues.length = 0;
    startPosed(h.debug);
    h.debug.setShipContact(true);
    h.debug.addEnemyBullet(h.debug.snapshot().ship.x, 600, "cyan");
    await h.advance(1);
    expect(h.cues.some((cue) => cue.cue === CUES.absorb)).toBe(true);

    h.cues.length = 0;
    startPosed(h.debug);
    h.debug.setShipContact(true);
    h.debug.addEnemyBullet(h.debug.snapshot().ship.x, 600, "magenta");
    await h.advance(1);
    expect(h.cues.some((cue) => cue.cue === CUES.hit)).toBe(true);

    h.cues.length = 0;
    startPosed(h.debug);
    h.debug.addDrone("prism", 640, 600);
    const prism = h.debug.snapshot().drones[0].id;
    h.debug.setDronePhase(prism, "diving");
    await h.seconds(1);
    expect(h.cues.some((cue) => cue.cue === CUES.inversion)).toBe(true);

    h.cues.length = 0;
    startPosed(h.debug);
    h.debug.addDrone("shard", 400, 200);
    const charged = h.debug.snapshot().drones[0].id;
    h.debug.setDroneCharge(charged, 2);
    h.debug.addPlayerBullet(400, 200, "magenta");
    await h.advance(1);
    expect(h.cues.some((cue) => cue.cue === CUES.overload)).toBe(true);

    h.cues.length = 0;
    h.debug.reset();
    await h.tap("ArrowDown");
    expect(h.cues.some((cue) => cue.cue === CUES.menu)).toBe(true);
    h.dispose();
  });

  it("starts no sound at all while muted", async () => {
    const h = await live();
    await h.tap("KeyM");
    h.cues.length = 0;
    await h.tap("Space");
    await h.tap("KeyF");
    h.debug.addDrone("shard", 400, 200);
    h.debug.addPlayerBullet(400, 200, "cyan");
    await h.advance(2);
    expect(h.cues).toHaveLength(0);
    h.dispose();
  });
});

describe("a whole stage", () => {
  it("flies its wave in, assembles it, and clears when the last drone dies", async () => {
    const h = await createHarness();
    h.debug.reset({ seed: 3 });
    await h.tap("Enter");
    await h.seconds(STAGE_INTRO_HOLD + 0.1);
    expect(h.debug.snapshot().screen).toBe("inWave");
    const wave = h.debug.snapshot().drones;
    expect(wave.length).toBeGreaterThan(10);
    expect(wave.every((drone) => drone.phase === "entering")).toBe(true);

    // Let the wave assemble, with nothing able to reach the ship.
    h.debug.setShipContact(false);
    h.debug.setDiveLaunching(false);
    const assembled = await h.until(
      () =>
        h.debug.snapshot().drones.every((drone) => drone.phase === "formation"),
      60 * 14,
    );
    expect(assembled).toBe(true);

    // Rake the wave down to its last drone, then shoot that one.
    const left = h.debug.snapshot().drones;
    for (const drone of left.slice(1)) h.debug.removeDrone(drone.id);
    const last = h.debug.snapshot().drones[0];
    h.debug.setDroneShell(last.id, false);
    h.debug.setDroneBand(last.id, last.kind === "prism" ? "magenta" : "cyan");
    h.debug.setDroneOscillation(last.id, false);
    h.debug.setDroneBandClock(last.id, 0);
    h.debug.addPlayerBullet(last.x, last.y, "cyan");
    await h.advance(2);
    expect(h.debug.snapshot().drones).toHaveLength(0);
    expect(h.debug.snapshot().screen).toBe("stageCleared");
    await h.seconds(3);
    expect(h.debug.snapshot()).toMatchObject({
      screen: "stageIntro",
      stage: 2,
    });
    h.dispose();
  }, 60000);
});
