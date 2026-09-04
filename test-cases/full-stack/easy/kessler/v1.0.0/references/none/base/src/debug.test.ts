// The state operations of specs/instrumentation.md: each pose posed and read
// back, the domains that fail loudly, and the no-op cases the spec fixes.

import { describe, expect, it } from "vitest";
import {
  PAUSE_MENU,
  RINGS,
  SCREENS,
  STAGE_SIZE,
  TITLE_MENU,
  type Cue,
} from "./constants";
import { createStateOps } from "./debug";
import { Game } from "./game";
import { pointAt, polarOf } from "./polar";

/** The four screens carrying no menu (`specs/screens.md`). */
const MENU_FREE = ["howto", "playing", "waveclear", "gameover"] as const;

function makeOps() {
  const cues: Cue[] = [];
  const game = new Game({ cue: (cue) => cues.push(cue), particle: () => {} });
  return { game, ops: createStateOps(game), cues };
}

describe("reset", () => {
  it("restores the boot state, both switches on", () => {
    const { game, ops } = makeOps();
    ops.setScreen("playing");
    ops.setScore(500);
    ops.setWaveAdvance(false);
    game.tick();
    ops.reset();
    const snap = ops.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.ticks).toBe(0);
    expect(snap.waveAdvance).toBe(true);
  });

  it("rejects a malformed seed", () => {
    const { ops } = makeOps();
    expect(() => ops.reset(Number.NaN)).toThrow();
  });
});

describe("setScreen", () => {
  it("rejects an unknown screen", () => {
    const { ops } = makeOps();
    expect(() => ops.setScreen("menu" as never)).toThrow();
  });

  it("sets the screen and changes nothing else, silently", () => {
    const { ops, cues } = makeOps();
    ops.setScreen("paused");
    ops.setScore(900);
    ops.setMenuIndex(1);
    ops.setInterstitialTicks(77);
    ops.spawnBall(600, 500, 20, 0);
    const before = ops.snapshot();
    ops.setScreen("title");
    const after = ops.snapshot();
    expect(after.screen).toBe("title");
    expect({ ...after, screen: before.screen }).toEqual(before);
    expect(cues).toEqual([]);
  });

  it("reaches every screen directly", () => {
    const { ops } = makeOps();
    for (const name of SCREENS) {
      ops.setScreen(name);
      expect(ops.snapshot().screen).toBe(name);
    }
  });

  it("runs the posed interstitial out into the next wave", () => {
    const { game, ops } = makeOps();
    ops.setScore(700);
    ops.setInterstitialTicks(180);
    ops.setScreen("waveclear");
    for (let i = 0; i < 179; i += 1) game.tick();
    expect(ops.snapshot().screen).toBe("waveclear");
    expect(ops.snapshot().interstitialTicks).toBe(1);
    game.tick();
    const snap = ops.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.score).toBe(700);
  });
});

describe("the menu highlight and the interstitial timer", () => {
  it("setMenuIndex poses each entry of both menus, silently", () => {
    const { ops, cues } = makeOps();
    for (const screen of ["title", "paused"] as const) {
      ops.setScreen(screen);
      ops.setMenuIndex(1);
      expect(ops.snapshot().menu.index).toBe(1);
      ops.setMenuIndex(0);
      expect(ops.snapshot().menu.index).toBe(0);
    }
    expect(cues).toEqual([]);
  });

  it("setMenuIndex rejects an entry the menu does not carry", () => {
    const { ops } = makeOps();
    ops.setScreen("title");
    expect(() => ops.setMenuIndex(TITLE_MENU.length)).toThrow();
  });

  it("setMenuIndex changes nothing on a screen with no menu", () => {
    const { ops } = makeOps();
    for (const screen of MENU_FREE) {
      ops.setScreen(screen);
      const before = ops.snapshot();
      ops.setMenuIndex(1);
      expect(ops.snapshot()).toEqual(before);
    }
  });

  it("setInterstitialTicks is read back and counts down on waveclear alone", () => {
    const { game, ops } = makeOps();
    ops.setInterstitialTicks(40);
    expect(ops.snapshot().interstitialTicks).toBe(40);
    ops.setScreen("paused");
    for (let i = 0; i < 5; i += 1) game.tick();
    expect(ops.snapshot().interstitialTicks).toBe(40);
    ops.setScreen("waveclear");
    for (let i = 0; i < 5; i += 1) game.tick();
    expect(ops.snapshot().interstitialTicks).toBe(35);
  });
});

describe("menuItemRect", () => {
  it("reports a distinct on-stage region for every entry of both menus", () => {
    const { ops } = makeOps();
    for (const [screen, entries] of [
      ["title", TITLE_MENU],
      ["paused", PAUSE_MENU],
    ] as const) {
      ops.setScreen(screen);
      const regions = entries.map((_entry, index) => ops.menuItemRect(index));
      for (const region of regions) {
        expect(region).not.toBeNull();
        expect(region!.width).toBeGreaterThan(0);
        expect(region!.height).toBeGreaterThan(0);
        expect(region!.x).toBeGreaterThanOrEqual(0);
        expect(region!.y).toBeGreaterThanOrEqual(0);
        expect(region!.x + region!.width).toBeLessThanOrEqual(STAGE_SIZE);
        expect(region!.y + region!.height).toBeLessThanOrEqual(STAGE_SIZE);
      }
      expect(regions[0]!.y + regions[0]!.height).toBeLessThanOrEqual(
        regions[1]!.y,
      );
    }
  });

  it("answers null off a menu and past a menu's entries", () => {
    const { ops } = makeOps();
    for (const screen of MENU_FREE) {
      ops.setScreen(screen);
      expect(ops.menuItemRect(0)).toBeNull();
    }
    ops.setScreen("title");
    expect(ops.menuItemRect(TITLE_MENU.length)).toBeNull();
    expect(ops.menuItemRect(-1)).toBeNull();
  });
});

describe("score, lives, wave", () => {
  it("poses score and lives, rejecting anything but whole numbers >= 0", () => {
    const { ops } = makeOps();
    ops.setScore(12345);
    ops.setLives(7);
    expect(ops.snapshot().score).toBe(12345);
    expect(ops.snapshot().lives).toBe(7);
    expect(() => ops.setScore(-1)).toThrow();
    expect(() => ops.setScore(1.5)).toThrow();
    expect(() => ops.setLives(-2)).toThrow();
  });

  it("setWave puts the wave figures in force without touching the field", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.setRingAngle(2, 77);
    ops.setWave(4);
    const snap = ops.snapshot();
    expect(snap.wave).toBe(4);
    expect(snap.rings[1].speedDegPerSec).toBe(RINGS[1].speedForWave(4));
    expect(snap.rings[2].speedDegPerSec).toBe(RINGS[2].speedForWave(4));
    // The rings keep their targets and their angles.
    expect(snap.rings[1].angleDeg).toBe(77);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
  });

  it("setWave overwrites a posed ring speed", () => {
    const { ops } = makeOps();
    ops.setRingSpeed(1, 99);
    ops.setWave(2);
    expect(ops.snapshot().rings[0].speedDegPerSec).toBe(0);
  });

  it("setWave sets the ball speed a launch serves at", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.setWave(9);
    ops.launchBall();
    const ball = ops.snapshot().balls[0];
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(480, 6);
  });

  it("rejects a wave under 1", () => {
    const { ops } = makeOps();
    expect(() => ops.setWave(0)).toThrow();
  });
});

describe("the deflector and balls", () => {
  it("setPaddleAngle normalizes and carries the parked ball", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.setPaddleAngle(-90);
    const snap = ops.snapshot();
    expect(snap.paddle.angleDeg).toBe(270);
    const at = pointAt(194, 270);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("launchBall acts as Space and is a no-op without a parked ball", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.launchBall();
    expect(ops.snapshot().balls[0].parked).toBe(false);
    ops.launchBall();
    expect(ops.snapshot().balls).toHaveLength(1);
  });

  it("clearBalls empties the field without a life loss", () => {
    const { game, ops } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.clearBalls();
    expect(ops.snapshot().balls).toEqual([]);
    game.tick();
    expect(ops.snapshot().lives).toBe(3);
    expect(ops.snapshot().screen).toBe("playing");
  });

  it("spawnBall appends in spawn order and stops at the cap", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    for (let i = 0; i < 7; i += 1) ops.spawnBall(600, 500, 10 * i, 0);
    const balls = ops.snapshot().balls;
    expect(balls).toHaveLength(6);
    expect(balls[1].vx).toBe(0);
    expect(balls[5].vx).toBe(40);
  });

  it("spawnBall marks the ball piercing exactly when pierce is in force", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.clearBalls();
    ops.spawnBall(600, 500, 0, 0);
    expect(ops.snapshot().balls[0].piercing).toBe(false);
    ops.setEffectTicks("pierce", 10);
    ops.spawnBall(620, 500, 0, 0);
    expect(ops.snapshot().balls.map((b) => b.piercing)).toEqual([true, true]);
  });

  it("parkBall parks one ball, and only one", () => {
    const { ops } = makeOps();
    ops.setScreen("playing");
    ops.clearBalls();
    ops.parkBall();
    ops.parkBall();
    const balls = ops.snapshot().balls;
    expect(balls).toHaveLength(1);
    expect(balls[0].parked).toBe(true);
    const at = polarOf(balls[0].x, balls[0].y);
    expect(at.r).toBeCloseTo(194, 9);
  });

  it("rejects non-finite ball figures", () => {
    const { ops } = makeOps();
    expect(() => ops.spawnBall(Number.NaN, 500, 0, 0)).toThrow();
  });
});

describe("targets and rings", () => {
  it("clearTargets empties every ring with no clearing event", () => {
    const { ops, cues } = makeOps();
    ops.setScreen("playing");
    ops.clearTargets();
    const snap = ops.snapshot();
    expect(snap.rings.map((r) => r.targets.length)).toEqual([0, 0, 0]);
    expect(snap.screen).toBe("playing");
    expect(snap.score).toBe(0);
    expect(cues).toEqual([]);
  });

  it("spawnTarget places a target, replacing what the slot holds", () => {
    const { ops } = makeOps();
    ops.clearTargets();
    ops.spawnTarget(2, 3, 5);
    expect(ops.snapshot().rings[1].targets).toEqual([{ slot: 3, hp: 5 }]);
  });

  it("validates ring, slot, and hp domains", () => {
    const { ops } = makeOps();
    expect(() => ops.spawnTarget(0, 0, 1)).toThrow();
    expect(() => ops.spawnTarget(4, 0, 1)).toThrow();
    expect(() => ops.spawnTarget(1, 12, 1)).toThrow();
    expect(() => ops.spawnTarget(3, 20, 1)).toThrow();
    expect(() => ops.spawnTarget(1, 0, 0)).toThrow();
    expect(() => ops.setRingAngle(5, 0)).toThrow();
    expect(() => ops.setRingSpeed(0, 10)).toThrow();
  });

  it("setRingAngle normalizes and moves the targets with the ring", () => {
    const { ops } = makeOps();
    ops.setRingAngle(1, 450);
    expect(ops.snapshot().rings[0].angleDeg).toBe(90);
  });

  it("setRingSpeed poses a speed that holds until setWave", () => {
    const { ops } = makeOps();
    ops.setRingSpeed(1, -33);
    expect(ops.snapshot().rings[0].speedDegPerSec).toBe(-33);
  });
});

describe("pods, effects, and switches", () => {
  it("spawnPod adds a pod at the point's polar figures", () => {
    const { ops } = makeOps();
    const at = pointAt(300, 45);
    ops.spawnPod("narrow", at.x, at.y);
    const pods = ops.snapshot().pods;
    expect(pods).toHaveLength(1);
    expect(pods[0].kind).toBe("narrow");
    expect(pods[0].x).toBeCloseTo(at.x, 9);
    expect(pods[0].y).toBeCloseTo(at.y, 9);
    ops.clearPods();
    expect(ops.snapshot().pods).toEqual([]);
  });

  it("rejects an unknown pod kind", () => {
    const { ops } = makeOps();
    expect(() => ops.spawnPod("magnet" as never, 600, 500)).toThrow();
  });

  it("setEffectTicks puts a span effect in force with the mutual cancel", () => {
    const { ops } = makeOps();
    ops.setEffectTicks("widen", 100);
    expect(ops.snapshot().effects.widenTicks).toBe(100);
    expect(ops.snapshot().paddle.spanDeg).toBe(72);
    ops.setEffectTicks("narrow", 50);
    const effects = ops.snapshot().effects;
    expect(effects.narrowTicks).toBe(50);
    expect(effects.widenTicks).toBe(0);
    expect(ops.snapshot().paddle.spanDeg).toBe(30);
    expect(ops.snapshot().score).toBe(0);
  });

  it("setEffectTicks 0 ends the effect and restores the baseline", () => {
    const { ops } = makeOps();
    ops.setEffectTicks("narrow", 50);
    ops.setEffectTicks("narrow", 0);
    expect(ops.snapshot().paddle.spanDeg).toBe(48);
    ops.setEffectTicks("pierce", 10);
    ops.setEffectTicks("pierce", 0);
    expect(ops.snapshot().effects.pierceTicks).toBe(0);
  });

  it("pierce runs alongside a span effect", () => {
    const { ops } = makeOps();
    ops.setEffectTicks("widen", 100);
    ops.setEffectTicks("pierce", 60);
    const effects = ops.snapshot().effects;
    expect(effects.widenTicks).toBe(100);
    expect(effects.pierceTicks).toBe(60);
  });

  it("validates the effect kind and tick count", () => {
    const { ops } = makeOps();
    expect(() => ops.setEffectTicks("shield" as never, 1)).toThrow();
    expect(() => ops.setEffectTicks("widen", -1)).toThrow();
    expect(() => ops.setEffectTicks("widen", 1.5)).toThrow();
  });

  it("setShield raises and removes the shield without scoring", () => {
    const { ops } = makeOps();
    ops.setShield(true);
    expect(ops.snapshot().effects.shieldActive).toBe(true);
    expect(ops.snapshot().score).toBe(0);
    ops.setShield(false);
    expect(ops.snapshot().effects.shieldActive).toBe(false);
    expect(() => ops.setShield(1 as never)).toThrow();
  });

  it("poses the two driver switches", () => {
    const { ops } = makeOps();
    ops.setWaveAdvance(false);
    ops.setPodSpawn(false);
    expect(ops.snapshot().waveAdvance).toBe(false);
    expect(ops.snapshot().podSpawn).toBe(false);
    ops.setWaveAdvance(true);
    expect(ops.snapshot().waveAdvance).toBe(true);
    expect(() => ops.setPodSpawn("yes" as never)).toThrow();
  });
});
