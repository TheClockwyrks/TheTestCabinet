// Kessler under the engine, in process.
//
// Every check here drives a real engine through `src/harness.ts`: the frame
// loop, the fixed tick the game mode resolves inside it, the keyboard the
// player controller reads, the cue bus and the looping beds, the actors the
// reconciler keeps mirroring the state, and the pixels the pipeline's draw
// components produced. Nothing is reimplemented — what runs is the same
// `GameDefinition` `src/main.ts` binds to the engine in a browser.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BED_CUES } from "./audio";
import { STAGE_W, STAGE_H, TAGS, TITLE_ITEMS } from "./constants";
import { createHarness, FRAME_MS, type Harness } from "./harness";
import { pointAt } from "./polar";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Start a session from the title exactly as a player does. */
async function startSession(): Promise<void> {
  await h.step(1);
  h.tap("Space");
  await h.step(2);
}

describe("boot", () => {
  it("opens on the title over the boot layout, with the field populated", async () => {
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(0);
    expect(TITLE_ITEMS[snap.menu.index]).toBe("START");
    // One tagged actor per boot-layout target, the deflector pawn, no balls.
    expect(h.engine.world.byTag(TAGS.target)).toHaveLength(48);
    expect(h.engine.world.byTag(TAGS.paddle)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.ball)).toHaveLength(0);
    expect(h.engine.world.byTag(TAGS.pod)).toHaveLength(0);
  });

  it("draws a real picture, not a blank canvas", async () => {
    await h.step(1);
    const { data } = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H);
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0x05 || data[i + 1] !== 0x07 || data[i + 2] !== 0x0d) {
        painted += 1;
      }
    }
    // Rings, deflector, title chrome: far more than incidental noise.
    expect(painted).toBeGreaterThan(20000);
  });
});

describe("the keyboard path", () => {
  it("starts a fresh session on Space, ball parked, without also launching", async () => {
    await startSession();
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(h.cues).toContain("menu-select");
    // Space carries confirm and launch, and the two never answer on the
    // same screen: the ball the START press parked is still parked.
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
  });

  it("moves the title highlight with wrap-around on the arrow and letter keys", async () => {
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.debug.snapshot().menu.index).toBe(1);
    h.tap("KeyS");
    await h.step(1);
    expect(h.debug.snapshot().menu.index).toBe(0);
    h.tap("KeyW");
    await h.step(1);
    expect(h.debug.snapshot().menu.index).toBe(1);
    expect(h.cues.filter((cue) => cue === "menu-move")).toHaveLength(3);
  });

  it("opens the how-to from the menu and returns on Escape", async () => {
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("launches the parked ball on Space during play", async () => {
    await startSession();
    h.tap("Space");
    await h.step(1);
    const ball = h.debug.snapshot().balls[0];
    expect(ball.parked).toBe(false);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(240, 6);
  });

  it("turns the deflector at 270 degrees per second while a key is held", async () => {
    await startSession();
    h.press("ArrowRight");
    await h.step(30);
    h.release("ArrowRight");
    await h.step(1);
    // 30 held ticks at 4.5 degrees each; the release frame adds nothing.
    expect(h.debug.snapshot().paddle.angleDeg).toBeCloseTo(90 + 135, 6);
  });

  it("drives left from KeyA exactly as from ArrowLeft", async () => {
    await startSession();
    h.press("KeyA");
    await h.step(10);
    h.release("KeyA");
    const fromKeyA = h.debug.snapshot().paddle.angleDeg;
    h.debug.setPaddleAngle(90);
    await h.step(1);
    h.press("ArrowLeft");
    await h.step(10);
    h.release("ArrowLeft");
    expect(h.debug.snapshot().paddle.angleDeg).toBeCloseTo(fromKeyA, 9);
  });

  it("a repeat keydown arms no edge", async () => {
    await h.step(1);
    h.tap("ArrowDown", true);
    await h.step(1);
    expect(h.debug.snapshot().menu.index).toBe(0);
  });
});

describe("pausing", () => {
  it("freezes the simulation on Escape and resumes intact on KeyP", async () => {
    await startSession();
    h.tap("Space");
    await h.step(30);
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("paused");
    const frozen = h.debug.snapshot();
    await h.step(30);
    const later = h.debug.snapshot();
    expect(later.balls).toEqual(frozen.balls);
    expect(later.rings).toEqual(frozen.rings);
    h.tap("KeyP");
    await h.step(1);
    // The resume frame itself carries one tick, so play carries on from
    // exactly the frozen state: the ball keeps its velocity and has moved
    // one tick of it.
    const resumed = h.debug.snapshot();
    expect(resumed.screen).toBe("playing");
    expect(resumed.balls[0].vx).toBe(frozen.balls[0].vx);
    expect(resumed.balls[0].vy).toBe(frozen.balls[0].vy);
    expect(resumed.balls[0].x).toBeCloseTo(
      frozen.balls[0].x + frozen.balls[0].vx / 60,
      6,
    );
    expect(resumed.score).toBe(frozen.score);
  });

  it("discards the session on QUIT", async () => {
    await startSession();
    h.tap("Space");
    await h.step(30);
    h.tap("KeyP");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.balls).toEqual([]);
  });
});

describe("cues on the tick bus", () => {
  it("plays paddle-bounce on the deflector bounce", async () => {
    await startSession();
    h.debug.clearBalls();
    const at = pointAt(200, 90);
    h.debug.spawnBall(at.x, at.y, 0, -240);
    await h.step(3);
    expect(h.cues).toContain("paddle-bounce");
  });

  it("plays ball-lost and game-over on the last life, over silence", async () => {
    await startSession();
    h.debug.setLives(1);
    h.debug.clearBalls();
    const at = pointAt(90, 90);
    h.debug.spawnBall(at.x, at.y, 0, -240);
    await h.step(5);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("gameover");
    expect(h.cues).toContain("ball-lost");
    expect(h.cues).toContain("game-over");
    // The gameover screen plays no bed.
    expect(h.stops).toContain(BED_CUES.play);
  });

  it("clears the wave through the real event, cue and interstitial included", async () => {
    await startSession();
    h.debug.clearTargets();
    h.debug.spawnTarget(1, 0, 1);
    h.debug.clearBalls();
    const at = pointAt(332, 15);
    h.debug.spawnBall(
      at.x,
      at.y,
      -240 * Math.cos((15 * Math.PI) / 180),
      -240 * Math.sin((15 * Math.PI) / 180),
    );
    await h.step(5);
    expect(h.cues).toContain("target-break");
    expect(h.cues).toContain("wave-clear");
    expect(h.debug.snapshot().screen).toBe("waveclear");
    await h.step(180);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
  });
});

describe("the music beds", () => {
  it("loops the title bed on the title and swaps to the play bed in play", async () => {
    await h.step(1);
    expect(h.loops).toContain(BED_CUES.title);
    h.tap("Space");
    await h.step(2);
    expect(h.loops).toContain(BED_CUES.play);
    expect(h.stops).toContain(BED_CUES.title);
  });

  it("resumes the title bed when QUIT discards the session", async () => {
    await startSession();
    h.tap("KeyP");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.stops).toContain(BED_CUES.play);
    expect(h.loops.filter((bed) => bed === BED_CUES.title).length).toBe(2);
  });
});

describe("the actor population", () => {
  it("mirrors targets, balls, and pods after poses and play", async () => {
    await startSession();
    h.debug.clearTargets();
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.target)).toHaveLength(0);
    h.debug.spawnTarget(2, 3, 2);
    h.debug.spawnBall(600, 500, 0, 0);
    h.debug.spawnPod("shield", 600, 300);
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.target)).toHaveLength(1);
    // The parked ball and the spawned one.
    expect(h.engine.world.byTag(TAGS.ball)).toHaveLength(2);
    expect(h.engine.world.byTag(TAGS.pod)).toHaveLength(1);
    h.debug.clearPods();
    h.debug.clearBalls();
    await h.step(1);
    expect(h.engine.world.byTag(TAGS.ball)).toHaveLength(0);
    expect(h.engine.world.byTag(TAGS.pod)).toHaveLength(0);
  });
});

describe("the picture", () => {
  it("draws the deflector bright on its track during play", async () => {
    await startSession();
    // Sampled a little off the center notch, which is deliberately dark.
    const at = pointAt(178, h.debug.snapshot().paddle.angleDeg + 8);
    const [r, g, b] = h.pixel(at.x, at.y);
    // COLORS.paddle is near-white glass.
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(220);
  });

  it("draws every ball from the code fallback when no sprite decoded", async () => {
    await startSession();
    const parked = h.debug.snapshot().balls[0];
    const [r, g, b] = h.pixel(parked.x, parked.y);
    // The steel gradient stand-in reads clearly against the dark field.
    expect(r + g + b).toBeGreaterThan(240);
  });
});

describe("the fixed timestep", () => {
  it("resolves sixty ticks a second whatever the frame cadence", async () => {
    await startSession();
    const opening = h.debug.snapshot().ticks;
    h.engine.setClock(new ConstantClock(1000 / 30));
    await h.step(30);
    expect(h.debug.snapshot().ticks).toBe(opening + 60);
    h.engine.setClock(new ConstantClock(1000 / 120));
    await h.step(120);
    expect(h.debug.snapshot().ticks).toBe(opening + 120);
    h.engine.setClock(new ConstantClock(FRAME_MS));
  });
});

describe("determinism through the engine", () => {
  it("reproduces identical snapshots from the same seed and drive", async () => {
    const run = async (harness: Harness) => {
      harness.debug.reset(123);
      await harness.step(1);
      harness.tap("Space");
      await harness.step(2);
      harness.tap("Space");
      harness.press("ArrowRight");
      await harness.step(300);
      harness.release("ArrowRight");
      return harness.debug.snapshot();
    };
    const first = await run(h);
    const other = await createHarness();
    const second = await run(other);
    other.dispose();
    expect(second).toEqual(first);
  });
});
