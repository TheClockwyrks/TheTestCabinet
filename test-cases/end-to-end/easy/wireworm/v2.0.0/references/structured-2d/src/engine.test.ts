// Wireworm under the engine, in process.
//
// Every check here stands a real engine up over an `@napi-rs/canvas` canvas and
// a `SurfaceMetrics` of its own (`src/harness.ts`), so the game runs with no
// browser and no document behind it, and steps it with `engine.advance` against
// a `ConstantClock`, which makes a duration an exact number of frames. What is
// read back is the world's own state, the debug surface the instance returned,
// the engine's cue events, and the pixels the render produced.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BANNER_TIME,
  BAND_TOP_Y,
  BINDINGS,
  CURSOR_SPEED,
  CURSOR_X_MAX,
  CUES,
  FIRE_INTERVAL,
  MAX_BOLTS,
  RESPAWN_TIME,
  SCORE_HEAD,
  START_LIVES,
  STAGE_W,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  tileCX,
  tileCY,
  wormLength,
  wormStepInterval,
} from "./constants";
import { diagnosticSources } from "./diagnostics";
import { createHarness, poseWorm, startPlaying, type Harness } from "./harness";

const FRAME = 1 / 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the surface the engine hands back", () => {
  it("carries every operation the specification names, and its version", () => {
    const operations = [
      "reset",
      "snapshot",
      "setScreen",
      "setPhase",
      "setPhaseTimer",
      "setMenuIndex",
      "setScore",
      "setLives",
      "setLevel",
      "setReachedLevel",
      "setFoeSpawning",
      "setWormEntry",
      "setCursorContact",
      "setCursor",
      "setCursorInvulnerable",
      "setFireCooldown",
      "addBolt",
      "removeBolt",
      "clearBolts",
      "setNode",
      "clearNode",
      "clearNodes",
      "addWorm",
      "appendSegment",
      "setWormHeading",
      "setWormDescent",
      "setWormDiving",
      "setWormStepping",
      "setWormBody",
      "removeWorm",
      "clearWorms",
      "addFoe",
      "setFoeVelocity",
      "setFoeHit",
      "setFoeMind",
      "setFoeTravel",
      "removeFoe",
      "clearFoes",
    ] as const;
    const surface = h.debug as unknown as Record<string, unknown>;
    for (const name of operations) {
      expect(typeof surface[name], name).toBe("function");
    }
    expect(h.debug.version).toBe(WIREWORM_DEBUG_VERSION);
  });

  it("is live: a posed node reads back and a posed worm steps", async () => {
    startPlaying(h.debug);
    h.debug.setNode(6, 6, 2);
    poseWorm(h.debug, 4, 6, 2);
    expect(h.debug.snapshot().nodes).toEqual([{ c: 6, r: 6, charge: 2 }]);
    await h.seconds(wormStepInterval(1) + FRAME);
    expect(h.debug.snapshot().worms[0].segments[0]).toEqual({ c: 5, r: 6 });
  });

  it("reports every field a pose can set", async () => {
    startPlaying(h.debug);
    h.debug.setScreen("paused");
    h.debug.setPhase("respawn");
    h.debug.setPhaseTimer(0.75);
    h.debug.setMenuIndex(2);
    h.debug.setScore(1234);
    h.debug.setLives(5);
    h.debug.setLevel(9);
    h.debug.setReachedLevel(11);
    h.debug.setFoeSpawning(true);
    h.debug.setWormEntry(true);
    h.debug.setCursorContact(false);
    h.debug.setCursor(300, 676);
    h.debug.setCursorInvulnerable(1.5);
    h.debug.setFireCooldown(0.1);
    h.debug.setNode(3, 4, 3);
    const id = poseWorm(h.debug, 10, 10, 3);
    h.debug.setWormHeading(id, -1);
    h.debug.setWormDescent(id, -1);
    h.debug.setWormDiving(id, true);
    h.debug.setWormStepping(id, false);
    h.debug.setWormBody(id, false);
    h.debug.addFoe("dropper", 400, 300);
    const foeId = h.debug.snapshot().foes[0].id;
    h.debug.setFoeVelocity(foeId, 12, 34);
    h.debug.setFoeHit(foeId, true);
    h.debug.setFoeMind(foeId, false);
    h.debug.setFoeTravel(foeId, false);
    h.debug.addBolt(500, 400);

    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("paused");
    expect(shot.phase).toBe("respawn");
    expect(shot.phaseTimer).toBe(0.75);
    expect(shot.menuIndex).toBe(2);
    expect(shot.score).toBe(1234);
    expect(shot.lives).toBe(5);
    expect(shot.level).toBe(9);
    expect(shot.reachedLevel).toBe(11);
    expect(shot.foeSpawning).toBe(true);
    expect(shot.wormEntry).toBe(true);
    expect(shot.cursor).toEqual({
      x: 300,
      y: 676,
      invulnerable: 1.5,
      contact: false,
    });
    expect(shot.fireCooldown).toBe(0.1);
    expect(shot.nodes).toContainEqual({ c: 3, r: 4, charge: 3 });
    expect(shot.wormStepInterval).toBeCloseTo(wormStepInterval(9), 9);
    expect(shot.wormLength).toBe(wormLength(9));
    const worm = shot.worms.find((entry) => entry.id === id);
    expect(worm).toMatchObject({
      dh: -1,
      dv: -1,
      diving: true,
      stepping: false,
      body: false,
    });
    expect(worm?.segments).toHaveLength(3);
    expect(shot.foes[0]).toMatchObject({
      kind: "dropper",
      x: 400,
      y: 300,
      vx: 12,
      vy: 34,
      hit: true,
      mind: false,
      travel: false,
    });
    expect(shot.bolts[0]).toMatchObject({ x: 500, y: 400 });
    expect(typeof shot.simTime).toBe("number");
    expect(typeof shot.muted).toBe("boolean");
  });

  it("reports the links a live discharge is arcing along", async () => {
    startPlaying(h.debug);
    h.debug.setNode(8, 6, 3);
    h.debug.setNode(9, 6, 1);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    expect(h.debug.snapshot().arcs).toEqual([
      { from: { c: 8, r: 6 }, to: { c: 9, r: 6 } },
    ]);
  });

  it("restores the title values on reset and leaves mute alone", async () => {
    await h.tap(BINDINGS.mute[0]);
    startPlaying(h.debug);
    h.debug.setScore(700);
    h.debug.setLives(1);
    h.debug.setNode(4, 4, 3);
    h.debug.reset();
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.score).toBe(0);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.level).toBe(1);
    expect(shot.nodes).toHaveLength(0);
    expect(shot.foeSpawning).toBe(true);
    expect(shot.wormEntry).toBe(true);
    expect(shot.cursor.contact).toBe(true);
    expect(shot.muted).toBe(true);
  });

  it("seeds the run's randomness", async () => {
    const scatter = async (seed: number) => {
      h.debug.reset({ seed });
      // DESCEND, which is where the run's starting field is laid.
      await h.tap(BINDINGS.confirm[0]);
      return h.debug.snapshot().nodes;
    };
    const first = await scatter(7);
    const again = await scatter(7);
    const other = await scatter(8);
    expect(first.length).toBeGreaterThan(0);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });
});

describe("the keys the game answers to", () => {
  it("moves the title's highlight and takes the item under it", async () => {
    expect(h.debug.snapshot().screen).toBe("title");
    await h.tap(BINDINGS.down[0]);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(h.cues.map((cue) => cue.cue)).toContain(CUES.menu);
    // The highlight wraps at both ends.
    await h.tap(BINDINGS.down[0]);
    expect(h.debug.snapshot().menuIndex).toBe(0);
    await h.tap(BINDINGS.up[0]);
    expect(h.debug.snapshot().menuIndex).toBe(TITLE_ITEMS.length - 1);
    await h.tap(BINDINGS.confirm[0]);
    expect(h.debug.snapshot().screen).toBe("howto");
    await h.tap(BINDINGS.back[0]);
    expect(h.debug.snapshot().screen).toBe("title");
    // The return selects the entry it left from (specs/ui.md).
    expect(h.debug.snapshot().menuIndex).toBe(
      TITLE_ITEMS.indexOf("HOW TO PLAY"),
    );
  });

  it("opens a run from the title and runs it on the game's own clock", async () => {
    await h.tap(BINDINGS.confirm[0]);
    let shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.phase).toBe("banner");
    expect(shot.lives).toBe(START_LIVES);
    await h.seconds(BANNER_TIME + FRAME);
    shot = h.debug.snapshot();
    expect(shot.phase).toBe("active");
    expect(shot.worms).toHaveLength(1);
    expect(shot.worms[0].segments).toHaveLength(wormLength(1));
  });

  it("slides the cursor while a movement is held, and stops at the bound", async () => {
    startPlaying(h.debug);
    h.debug.setCursor(400, 688);
    h.down(BINDINGS.right[0]);
    await h.advance(30);
    h.up(BINDINGS.right[0]);
    expect(h.debug.snapshot().cursor.x).toBeCloseTo(
      400 + CURSOR_SPEED * 30 * FRAME,
      3,
    );

    h.debug.setCursor(CURSOR_X_MAX - 40, 688);
    h.down(BINDINGS.right[0]);
    await h.seconds(1);
    h.up(BINDINGS.right[0]);
    expect(h.debug.snapshot().cursor.x).toBe(CURSOR_X_MAX);
  });

  it("fires a bolt on the fire interval while the fire key is held", async () => {
    startPlaying(h.debug);
    h.down(BINDINGS.a[0]);
    await h.advance(1);
    expect(h.debug.snapshot().bolts).toHaveLength(1);
    expect(h.cues.map((cue) => cue.cue)).toContain(CUES.fire);
    await h.advance(2);
    expect(h.debug.snapshot().bolts).toHaveLength(1);
    await h.seconds(FIRE_INTERVAL);
    expect(h.debug.snapshot().bolts.length).toBeGreaterThan(1);
    h.up(BINDINGS.a[0]);
  });

  it("holds at three bolts in flight", async () => {
    startPlaying(h.debug);
    h.debug.setCursor(640, 704);
    h.down(BINDINGS.a[0]);
    await h.seconds(FIRE_INTERVAL * 3);
    h.up(BINDINGS.a[0]);
    expect(h.debug.snapshot().bolts.length).toBeLessThanOrEqual(MAX_BOLTS);
  });

  it("pauses live play and resumes it exactly where it was", async () => {
    startPlaying(h.debug);
    poseWorm(h.debug, 8, 6, 3);
    await h.tap(BINDINGS.pause[0]);
    expect(h.debug.snapshot().screen).toBe("paused");
    const frozen = h.debug.snapshot().worms[0].segments[0];
    await h.seconds(1);
    expect(h.debug.snapshot().worms[0].segments[0]).toEqual(frozen);
    await h.tap(BINDINGS.back[0]);
    expect(h.debug.snapshot().screen).toBe("playing");
    await h.seconds(wormStepInterval(1) + FRAME);
    expect(h.debug.snapshot().worms[0].segments[0]).not.toEqual(frozen);
  });

  it("toggles the runtime's mute bit from any screen", async () => {
    expect(h.debug.snapshot().muted).toBe(false);
    await h.tap(BINDINGS.mute[0]);
    expect(h.debug.snapshot().muted).toBe(true);
    startPlaying(h.debug);
    await h.tap(BINDINGS.mute[0]);
    expect(h.debug.snapshot().muted).toBe(false);
  });
});

describe("the run, played through the engine", () => {
  it("costs a life when a segment reaches the cursor, and respawns", async () => {
    startPlaying(h.debug);
    h.debug.setCursorContact(true);
    h.debug.setCursor(tileCX(9), 704);
    const id = poseWorm(h.debug, 9, 19, 1);
    h.debug.setWormStepping(id, false);
    await h.advance(1);
    const shot = h.debug.snapshot();
    expect(shot.lives).toBe(START_LIVES - 1);
    expect(shot.phase).toBe("respawn");
    expect(shot.worms).toHaveLength(0);
    expect(h.cues.map((cue) => cue.cue)).toContain(CUES.life);
    await h.seconds(RESPAWN_TIME + FRAME);
    expect(h.debug.snapshot().cursor.invulnerable).toBeGreaterThan(0);
  });

  it("clears the level when the last segment is cut, and pays for it", async () => {
    startPlaying(h.debug);
    poseWorm(h.debug, 8, 6, 1);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    const shot = h.debug.snapshot();
    expect(shot.score).toBe(SCORE_HEAD + 100);
    expect(shot.level).toBe(2);
    const played = h.cues.map((cue) => cue.cue);
    expect(played).toContain(CUES.cut);
    expect(played).toContain(CUES.levelClear);
  });

  it("wins the run on the last level", async () => {
    startPlaying(h.debug);
    h.debug.setLevel(TOTAL_LEVELS);
    poseWorm(h.debug, 8, 6, 1);
    h.debug.addBolt(tileCX(8), tileCY(6));
    await h.advance(1);
    expect(h.debug.snapshot().screen).toBe("victory");
    expect(h.cues.map((cue) => cue.cue)).toContain(CUES.victory);
  });

  it("ends the run at zero lives", async () => {
    startPlaying(h.debug);
    h.debug.setLives(1);
    h.debug.setReachedLevel(4);
    h.debug.setCursorContact(true);
    h.debug.setCursor(tileCX(9), 704);
    const id = poseWorm(h.debug, 9, 19, 1);
    h.debug.setWormStepping(id, false);
    await h.advance(1);
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("gameover");
    expect(shot.lives).toBe(0);
    expect(shot.reachedLevel).toBe(4);
    expect(h.cues.map((cue) => cue.cue)).toContain(CUES.gameOver);
  });

  it("ignores a contact while the spawn-in invulnerability runs", async () => {
    startPlaying(h.debug);
    h.debug.setCursorContact(true);
    h.debug.setCursorInvulnerable(2);
    h.debug.setCursor(tileCX(9), 704);
    const id = poseWorm(h.debug, 9, 19, 1);
    h.debug.setWormStepping(id, false);
    await h.advance(10);
    expect(h.debug.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the picture the frame drew", () => {
  it("draws the board, its band and its field apart from one another", async () => {
    startPlaying(h.debug);
    h.debug.setNode(4, 4, 3);
    await h.advance(1);
    const board = h.pixel(tileCX(20), tileCY(2));
    const band = h.pixel(tileCX(20), BAND_TOP_Y + 20);
    const node = h.pixel(tileCX(4), tileCY(4));
    expect(band).not.toEqual(board);
    expect(node).not.toEqual(board);
  });

  it("draws the title screen's text over the board", async () => {
    await h.advance(1);
    let lit = 0;
    for (let x = 200; x < STAGE_W - 200; x += 4) {
      const [r, g, b] = h.pixel(x, 210);
      if (r + g + b > 200) lit += 1;
    }
    expect(lit).toBeGreaterThan(10);
  });
});

describe("the overlay's sources", () => {
  it("reads the live game and reports one line each", () => {
    startPlaying(h.debug);
    h.debug.setNode(4, 4, 1);
    poseWorm(h.debug, 8, 8, 3);
    h.debug.addFoe("glitch", 300, 300);
    const state = h.state;
    const sources = diagnosticSources(() => state);
    const names = sources.map(([name]) => name);
    expect(names).toEqual([
      "screen",
      "score",
      "lives",
      "level",
      "nodes",
      "worms",
      "foes",
      "cursor",
      "bolts",
    ]);
    const values = Object.fromEntries(
      sources.map(([name, read]) => [name, read()]),
    );
    expect(values.screen).toBe("playing / active");
    expect(values.nodes).toBe(1);
    expect(String(values.worms)).toContain("@8,8");
    expect(String(values.foes)).toContain("glitch");
    expect(values.bolts).toBe(0);
  });
});
