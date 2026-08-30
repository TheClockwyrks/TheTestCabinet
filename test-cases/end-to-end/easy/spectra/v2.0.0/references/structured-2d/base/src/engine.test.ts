// The whole build, stood up over a real engine.
//
// Everything here goes through `src/harness.ts`: a real `Engine` over an
// `@napi-rs/canvas` canvas, stepped with `engine.advance` against a
// `ConstantClock`, driven by keyboard-shaped events at the surface's own event
// target. What is checked is the wiring the rule tests cannot see — the game
// definition, the level and its actors, the player controller, the cue bus, the
// debug surface the instance returned, and the picture the pipeline drew.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FLIP_LOCKOUT,
  HUD_BOTTOM_TOP,
  RESONANCE_MAX,
  SHIP_SPEED,
  SHIP_Y,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TAGS,
} from "./constants";
import {
  createHarness,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the engine the build stands up", () => {
  it("opens the one level the game registers, holding the game's state", () => {
    expect(h.engine.world.level).toBe("field");
    expect(h.state.screen).toBe("title");
    expect(h.state.lives).toBe(START_LIVES);
  });

  it("hands the debug surface back from engine.debug", () => {
    expect(h.debug.version).toBe(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("adds one player, possessing nothing", () => {
    const players = h.engine.world.players();
    expect(players).toHaveLength(1);
    expect(players[0]?.pawn).toBeNull();
  });

  it("places the stage and the ship, and tags the ship", () => {
    expect(h.engine.world.byTag(TAGS.ship)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.ship)[0]?.transform.y).toBe(SHIP_Y);
  });

  it("draws something on every frame it runs", async () => {
    await h.advance(2);
    // The field's own ground is darker than nothing and lighter than the void.
    const [r, g, b] = h.pixel(4, 400);
    expect(r + g + b).toBeGreaterThan(0);
  });
});

describe("the keys the build registers", () => {
  it("moves the ship while a direction is held, and stops on release", async () => {
    startPosed(h.debug);
    h.down("ArrowRight");
    await h.advance(30);
    const moved = h.debug.snapshot().ship.x;
    expect(moved).toBeCloseTo(640 + SHIP_SPEED * 0.5, 0);

    h.up("ArrowRight");
    await h.advance(30);
    expect(h.debug.snapshot().ship.x).toBeCloseTo(moved, 6);
  });

  it("flips the band once per press, and starts the lockout", async () => {
    startPosed(h.debug);
    await h.tap("KeyF");
    const after = h.debug.snapshot();
    expect(after.ship.band).toBe("magenta");
    expect(after.ship.lockout).toBeGreaterThan(0);
    expect(after.ship.lockout).toBeLessThanOrEqual(FLIP_LOCKOUT);
    expect(h.cues.map((cue) => cue.cue)).toContain("flip");
  });

  it("acts a held edge exactly once", async () => {
    startPosed(h.debug);
    h.down("KeyF");
    await h.advance(30);
    h.up("KeyF");
    expect(h.debug.snapshot().ship.band).toBe("magenta");
  });

  it("fires a shot that leaves the ship's nose", async () => {
    startPosed(h.debug);
    h.down("Space");
    await h.advance(1);
    h.up("Space");
    const bullets = h.debug.snapshot().bullets;
    expect(bullets).toHaveLength(1);
    expect(bullets[0]?.friendly).toBe(true);
    expect(bullets[0]?.y).toBeLessThan(SHIP_Y);
    expect(h.cues.map((cue) => cue.cue)).toContain("fire");
  });

  it("releases a discharge on its own key, at a full meter", async () => {
    startPosed(h.debug);
    h.debug.setResonance(RESONANCE_MAX);
    await h.tap("KeyX");
    expect(h.debug.snapshot().discharge.active).toBe(true);
    expect(h.debug.snapshot().resonance).toBe(0);
  });

  it("takes the title's first item to a new run", async () => {
    h.debug.reset();
    await h.tap("Enter");
    const after = h.debug.snapshot();
    expect(after.screen).toBe("stageIntro");
    expect(after.stage).toBe(1);
    expect(after.phaseTimer).toBeGreaterThan(0);
    expect(after.phaseTimer).toBeLessThanOrEqual(STAGE_INTRO_HOLD);
  });

  it("toggles the runtime's mute bit from any screen, and reports it", async () => {
    expect(h.engine.world.audio.muted()).toBe(false);
    await h.tap("KeyM");
    expect(h.engine.world.audio.muted()).toBe(true);
    expect(h.debug.snapshot().muted).toBe(true);

    await h.tap("KeyM");
    expect(h.debug.snapshot().muted).toBe(false);
  });

  it("starts no sound at all while muted", async () => {
    startPosed(h.debug);
    await h.tap("KeyM");
    h.cues.length = 0;
    await h.tap("KeyF");
    await h.tap("Space");
    expect(h.cues).toHaveLength(0);
  });

  it("plays no cue before the first key reaches it", async () => {
    await h.advance(30);
    expect(h.cues).toHaveLength(0);
  });
});

describe("the field's actors", () => {
  it("gives every drone, bullet and burst an actor under its own tag", async () => {
    startPosed(h.debug);
    h.debug.addDrone("shard", 400, 200);
    // Held still, so the actor's place is the place the pose put it rather than
    // the slot the sway carries it to.
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    h.debug.addPlayerBullet(600, 500, "cyan");
    h.debug.addEnemyBullet(700, 200, "magenta");
    await h.advance(1);

    const world = h.engine.world;
    expect(world.byTag(TAGS.drone)).toHaveLength(1);
    expect(world.byTag(TAGS.playerBullet)).toHaveLength(1);
    expect(world.byTag(TAGS.enemyBullet)).toHaveLength(1);
    expect(world.byTag(TAGS.drone)[0]?.transform.x).toBe(400);
  });

  it("carries each actor to its entity's centre", async () => {
    startPosed(h.debug);
    h.debug.addDrone("shard", 400, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneTravel(id, false);
    await h.advance(1);
    h.debug.setDronePosition(id, 900, 300);
    await h.advance(1);
    expect(h.engine.world.byTag(TAGS.drone)[0]?.transform.x).toBe(900);
    expect(h.engine.world.byTag(TAGS.drone)[0]?.transform.y).toBe(300);
  });

  it("destroys an actor whose entity has left its roster", async () => {
    startPosed(h.debug);
    h.debug.addDrone("shard", 400, 200);
    await h.advance(1);
    h.debug.clearDrones();
    await h.advance(1);
    expect(h.engine.world.byTag(TAGS.drone)).toHaveLength(0);
  });

  it("gives a destroyed drone a burst actor, and takes it away again", async () => {
    startPosed(h.debug);
    h.debug.addDrone("shard", 400, 200);
    h.debug.addDrone("shard", 900, 200);
    const id = lastDroneId(h.debug);
    h.debug.setDroneTravel(id, false);
    h.debug.addPlayerBullet(900, 205, "cyan");
    await h.advance(2);
    expect(h.engine.world.byTag(TAGS.burst)).toHaveLength(1);

    await h.seconds(1);
    expect(h.engine.world.byTag(TAGS.burst)).toHaveLength(0);
  });
});

describe("the frames the engine runs", () => {
  it("reaches the same state from the same seed and the same frames", async () => {
    const run = async (harness: Harness): Promise<string> => {
      harness.debug.reset({ seed: 4 });
      harness.debug.setScreen("stageIntro");
      harness.debug.setPhaseTimer(0.1);
      await harness.seconds(3);
      const snapshot = harness.debug.snapshot();
      return JSON.stringify({
        drones: snapshot.drones,
        bullets: snapshot.bullets,
        score: snapshot.score,
        stage: snapshot.stage,
      });
    };

    const first = await run(h);
    const other = await createHarness();
    try {
      expect(await run(other)).toBe(first);
    } finally {
      other.dispose();
    }
  });

  it("plays a whole wave without throwing", async () => {
    h.debug.reset();
    h.debug.setScreen("stageIntro");
    h.debug.setPhaseTimer(0.05);
    h.down("Space");
    await h.seconds(20);
    h.up("Space");
    const after = h.debug.snapshot();
    expect(after.simTime).toBeGreaterThan(19);
    expect(["inWave", "stageIntro", "stageCleared", "gameOver"]).toContain(
      after.screen,
    );
  });

  it("draws the HUD strip below the field on a live wave", async () => {
    startPosed(h.debug);
    await h.advance(2);
    const [r, g, b] = h.pixel(640, HUD_BOTTOM_TOP + 4);
    expect(r + g + b).toBeGreaterThan(0);
  });
});
