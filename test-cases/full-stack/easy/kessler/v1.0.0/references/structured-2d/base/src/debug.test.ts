// The debug surface of specs/instrumentation.md, driven exactly as a caller
// drives it: through `engine.debug` on a real engine, with `engine.advance`
// running the ticks between poses. Each pose is posed and read back, and the
// calls that fail loudly do — the domains an argument falls outside, and the
// fields the game has no state for. No operation declines quietly.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAUSE_ITEMS, RINGS, SCREENS, STAGE_W, TITLE_ITEMS } from "./constants";
import { ringSpeedForWave } from "./figures";
import { createHarness, type Harness } from "./harness";
import { pointAt, polarOf } from "./polar";

/** The four screens carrying no menu (`specs/screens.md`). */
const MENU_FREE = ["howto", "playing", "waveclear", "gameover"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("reset", () => {
  it("restores the boot state, both switches on", async () => {
    h.debug.setScreen("playing");
    h.debug.setScore(500);
    h.debug.setWaveAdvance(false);
    await h.step(1);
    h.debug.reset();
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.ticks).toBe(0);
    expect(snap.waveAdvance).toBe(true);
  });

  it("clears a posed pod outcome", () => {
    h.debug.setNextPod("multiball");
    h.debug.reset();
    expect(h.debug.snapshot().nextPod).toBeNull();
  });
});

describe("setNextPod and drawPod", () => {
  it("poses a kind, or none, that the snapshot reads back", () => {
    h.debug.setNextPod("shield");
    expect(h.debug.snapshot().nextPod).toBe("shield");
    h.debug.setNextPod("none");
    expect(h.debug.snapshot().nextPod).toBe("none");
  });

  it("rejects an unknown kind", () => {
    expect(() => h.debug.setNextPod("laser" as never)).toThrow(/unknown kind/);
    expect(() => h.debug.setNextPod(undefined as never)).toThrow(
      /unknown kind/,
    );
  });

  it("drawPod returns a kind or null and changes nothing", () => {
    h.debug.setScreen("playing");
    h.debug.setNextPod("narrow");
    const before = h.debug.snapshot();
    const seen = new Set<string | null>();
    for (let i = 0; i < 400; i += 1) seen.add(h.debug.drawPod());
    for (const outcome of seen) {
      expect([
        null,
        "widen",
        "multiball",
        "shield",
        "pierce",
        "narrow",
      ]).toContain(outcome);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(h.debug.snapshot()).toEqual(before);
  });
});

describe("setScreen", () => {
  it("rejects an unknown screen", () => {
    expect(() => h.debug.setScreen("menu" as never)).toThrow();
  });

  it("sets the screen and changes nothing else, silently", () => {
    h.debug.setScreen("paused");
    h.debug.setScore(900);
    h.debug.setMenuIndex(1);
    h.debug.setInterstitialTicks(77);
    h.debug.spawnBall(600, 500, 20, 0);
    const before = h.debug.snapshot();
    h.debug.setScreen("title");
    const after = h.debug.snapshot();
    expect(after.screen).toBe("title");
    expect({ ...after, screen: before.screen }).toEqual(before);
    expect(h.cues).toEqual([]);
  });

  it("reaches every screen directly", () => {
    for (const name of SCREENS) {
      h.debug.setScreen(name);
      expect(h.debug.snapshot().screen).toBe(name);
    }
  });

  it("runs the posed interstitial out into the next wave", async () => {
    h.debug.setScore(700);
    h.debug.setInterstitialTicks(180);
    h.debug.setScreen("waveclear");
    await h.step(179);
    expect(h.debug.snapshot().screen).toBe("waveclear");
    expect(h.debug.snapshot().interstitialTicks).toBe(1);
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.score).toBe(700);
  });
});

describe("the menu highlight and the interstitial timer", () => {
  it("setMenuIndex poses each entry of both menus, silently", () => {
    for (const screen of ["title", "paused"] as const) {
      h.debug.setScreen(screen);
      h.debug.setMenuIndex(1);
      expect(h.debug.snapshot().menu.index).toBe(1);
      h.debug.setMenuIndex(0);
      expect(h.debug.snapshot().menu.index).toBe(0);
    }
    expect(h.cues).toEqual([]);
  });

  it("setMenuIndex rejects an entry the menu does not carry", () => {
    h.debug.setScreen("title");
    expect(() => h.debug.setMenuIndex(TITLE_ITEMS.length)).toThrow();
  });

  it("setMenuIndex fails loudly on a screen with no menu", () => {
    for (const screen of MENU_FREE) {
      h.debug.setScreen(screen);
      const before = h.debug.snapshot();
      expect(() => h.debug.setMenuIndex(1)).toThrow();
      expect(h.debug.snapshot()).toEqual(before);
    }
  });

  it("setInterstitialTicks is read back and counts down on waveclear alone", async () => {
    h.debug.setInterstitialTicks(40);
    expect(h.debug.snapshot().interstitialTicks).toBe(40);
    h.debug.setScreen("paused");
    await h.step(5);
    expect(h.debug.snapshot().interstitialTicks).toBe(40);
    h.debug.setScreen("waveclear");
    await h.step(5);
    expect(h.debug.snapshot().interstitialTicks).toBe(35);
  });
});

describe("menuItemRect", () => {
  it("reports a distinct on-stage region for every entry of both menus", () => {
    for (const [screen, entries] of [
      ["title", TITLE_ITEMS],
      ["paused", PAUSE_ITEMS],
    ] as const) {
      h.debug.setScreen(screen);
      const regions = entries.map((_entry, index) =>
        h.debug.menuItemRect(index),
      );
      for (const region of regions) {
        expect(region).not.toBeNull();
        expect(region!.width).toBeGreaterThan(0);
        expect(region!.height).toBeGreaterThan(0);
        expect(region!.x).toBeGreaterThanOrEqual(0);
        expect(region!.y).toBeGreaterThanOrEqual(0);
        expect(region!.x + region!.width).toBeLessThanOrEqual(STAGE_W);
        expect(region!.y + region!.height).toBeLessThanOrEqual(STAGE_W);
      }
      expect(regions[0]!.y + regions[0]!.height).toBeLessThanOrEqual(
        regions[1]!.y,
      );
    }
  });

  it("answers null off a menu and past a menu's entries", () => {
    for (const screen of MENU_FREE) {
      h.debug.setScreen(screen);
      expect(h.debug.menuItemRect(0)).toBeNull();
    }
    h.debug.setScreen("title");
    expect(h.debug.menuItemRect(TITLE_ITEMS.length)).toBeNull();
    expect(h.debug.menuItemRect(-1)).toBeNull();
  });
});

describe("score, lives, wave", () => {
  it("poses score and lives, rejecting anything but whole numbers >= 0", () => {
    h.debug.setScore(12345);
    h.debug.setLives(7);
    expect(h.debug.snapshot().score).toBe(12345);
    expect(h.debug.snapshot().lives).toBe(7);
    expect(() => h.debug.setScore(-1)).toThrow();
    expect(() => h.debug.setScore(1.5)).toThrow();
    expect(() => h.debug.setLives(-2)).toThrow();
  });

  it("setWave puts the wave figures in force without touching the field", () => {
    h.debug.setScreen("playing");
    h.debug.setRingAngle(2, 77);
    h.debug.setWave(4);
    const snap = h.debug.snapshot();
    expect(snap.wave).toBe(4);
    expect(snap.rings[1].speedDegPerSec).toBe(ringSpeedForWave(RINGS[1], 4));
    expect(snap.rings[2].speedDegPerSec).toBe(ringSpeedForWave(RINGS[2], 4));
    // The rings keep their targets and their angles.
    expect(snap.rings[1].angleDeg).toBe(77);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
  });

  it("setWave overwrites a posed ring speed", () => {
    h.debug.setRingSpeed(1, 99);
    h.debug.setWave(2);
    expect(h.debug.snapshot().rings[0].speedDegPerSec).toBe(0);
  });

  it("setWave sets the ball speed a launch serves at", () => {
    h.debug.setScreen("playing");
    h.debug.parkBall();
    h.debug.setWave(9);
    h.debug.launchBall();
    const ball = h.debug.snapshot().balls[0];
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(480, 6);
  });

  it("rejects a wave under 1", () => {
    expect(() => h.debug.setWave(0)).toThrow();
  });
});

describe("the deflector and balls", () => {
  it("setPaddleAngle normalizes and carries the parked ball", () => {
    h.debug.setScreen("playing");
    h.debug.parkBall();
    h.debug.setPaddleAngle(-90);
    const snap = h.debug.snapshot();
    expect(snap.paddle.angleDeg).toBe(270);
    const at = pointAt(194, 270);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("launchBall acts as Space, and fails loudly with nothing parked", () => {
    h.debug.setScreen("playing");
    h.debug.parkBall();
    h.debug.launchBall();
    expect(h.debug.snapshot().balls[0].parked).toBe(false);
    expect(() => h.debug.launchBall()).toThrow();
    expect(h.debug.snapshot().balls).toHaveLength(1);
  });

  it("launchBall serves from whatever screen is up", () => {
    h.debug.setScreen("title");
    h.debug.parkBall();
    h.debug.launchBall();
    expect(h.debug.snapshot().screen).toBe("title");
    expect(h.debug.snapshot().balls[0].parked).toBe(false);
  });

  it("clearBalls empties the field without a life loss", async () => {
    h.debug.setScreen("playing");
    h.debug.parkBall();
    h.debug.clearBalls();
    expect(h.debug.snapshot().balls).toEqual([]);
    await h.step(1);
    expect(h.debug.snapshot().lives).toBe(3);
    expect(h.debug.snapshot().screen).toBe("playing");
  });

  it("spawnBall appends in spawn order and fails loudly at the cap", () => {
    h.debug.setScreen("playing");
    h.debug.parkBall();
    for (let i = 0; i < 5; i += 1) h.debug.spawnBall(600, 500, 10 * i, 0);
    const balls = h.debug.snapshot().balls;
    expect(balls).toHaveLength(6);
    expect(balls[1].vx).toBe(0);
    expect(balls[5].vx).toBe(40);
    expect(() => h.debug.spawnBall(600, 500, 0, 0)).toThrow();
    expect(h.debug.snapshot().balls).toHaveLength(6);
  });

  it("spawnBall marks the ball piercing exactly when pierce is in force", () => {
    h.debug.setScreen("playing");
    h.debug.clearBalls();
    h.debug.spawnBall(600, 500, 0, 0);
    expect(h.debug.snapshot().balls[0].piercing).toBe(false);
    h.debug.setEffectTicks("pierce", 10);
    h.debug.spawnBall(620, 500, 0, 0);
    expect(h.debug.snapshot().balls.map((b) => b.piercing)).toEqual([
      true,
      true,
    ]);
  });

  it("parkBall parks one ball, and a second fails loudly", () => {
    h.debug.setScreen("playing");
    h.debug.clearBalls();
    h.debug.parkBall();
    expect(() => h.debug.parkBall()).toThrow();
    const balls = h.debug.snapshot().balls;
    expect(balls).toHaveLength(1);
    expect(balls[0].parked).toBe(true);
    const at = polarOf(balls[0].x, balls[0].y);
    expect(at.r).toBeCloseTo(194, 9);
  });

  it("rejects non-finite ball figures", () => {
    expect(() => h.debug.spawnBall(Number.NaN, 500, 0, 0)).toThrow();
  });
});

describe("targets and rings", () => {
  it("clearTargets empties every ring with no clearing event", () => {
    h.debug.setScreen("playing");
    h.debug.clearTargets();
    const snap = h.debug.snapshot();
    expect(snap.rings.map((r) => r.targets.length)).toEqual([0, 0, 0]);
    expect(snap.screen).toBe("playing");
    expect(snap.score).toBe(0);
    expect(h.cues).toEqual([]);
  });

  it("spawnTarget places a target, replacing what the slot holds", () => {
    h.debug.clearTargets();
    h.debug.spawnTarget(2, 3, 5);
    expect(h.debug.snapshot().rings[1].targets).toEqual([{ slot: 3, hp: 5 }]);
  });

  it("validates ring, slot, and hp domains", () => {
    expect(() => h.debug.spawnTarget(0, 0, 1)).toThrow();
    expect(() => h.debug.spawnTarget(4, 0, 1)).toThrow();
    expect(() => h.debug.spawnTarget(1, 12, 1)).toThrow();
    expect(() => h.debug.spawnTarget(3, 20, 1)).toThrow();
    expect(() => h.debug.spawnTarget(1, 0, 0)).toThrow();
    expect(() => h.debug.setRingAngle(5, 0)).toThrow();
    expect(() => h.debug.setRingSpeed(0, 10)).toThrow();
  });

  it("setRingAngle normalizes and moves the targets with the ring", () => {
    h.debug.setRingAngle(1, 450);
    expect(h.debug.snapshot().rings[0].angleDeg).toBe(90);
  });

  it("setRingSpeed poses a speed that holds until setWave", () => {
    h.debug.setRingSpeed(1, -33);
    expect(h.debug.snapshot().rings[0].speedDegPerSec).toBe(-33);
  });
});

describe("pods, effects, and switches", () => {
  it("spawnPod adds a pod at the point's polar figures", () => {
    const at = pointAt(300, 45);
    h.debug.spawnPod("narrow", at.x, at.y);
    const pods = h.debug.snapshot().pods;
    expect(pods).toHaveLength(1);
    expect(pods[0].kind).toBe("narrow");
    expect(pods[0].x).toBeCloseTo(at.x, 9);
    expect(pods[0].y).toBeCloseTo(at.y, 9);
    h.debug.clearPods();
    expect(h.debug.snapshot().pods).toEqual([]);
  });

  it("rejects an unknown pod kind", () => {
    expect(() => h.debug.spawnPod("magnet" as never, 600, 500)).toThrow();
  });

  it("setEffectTicks puts a span effect in force with the mutual cancel", () => {
    h.debug.setEffectTicks("widen", 100);
    expect(h.debug.snapshot().effects.widenTicks).toBe(100);
    expect(h.debug.snapshot().paddle.spanDeg).toBe(72);
    h.debug.setEffectTicks("narrow", 50);
    const effects = h.debug.snapshot().effects;
    expect(effects.narrowTicks).toBe(50);
    expect(effects.widenTicks).toBe(0);
    expect(h.debug.snapshot().paddle.spanDeg).toBe(30);
    expect(h.debug.snapshot().score).toBe(0);
  });

  it("setEffectTicks 0 ends the effect and restores the baseline", () => {
    h.debug.setEffectTicks("narrow", 50);
    h.debug.setEffectTicks("narrow", 0);
    expect(h.debug.snapshot().paddle.spanDeg).toBe(48);
    h.debug.setEffectTicks("pierce", 10);
    h.debug.setEffectTicks("pierce", 0);
    expect(h.debug.snapshot().effects.pierceTicks).toBe(0);
  });

  it("pierce runs alongside a span effect", () => {
    h.debug.setEffectTicks("widen", 100);
    h.debug.setEffectTicks("pierce", 60);
    const effects = h.debug.snapshot().effects;
    expect(effects.widenTicks).toBe(100);
    expect(effects.pierceTicks).toBe(60);
  });

  it("validates the effect kind and tick count", () => {
    expect(() => h.debug.setEffectTicks("shield" as never, 1)).toThrow();
    expect(() => h.debug.setEffectTicks("widen", -1)).toThrow();
    expect(() => h.debug.setEffectTicks("widen", 1.5)).toThrow();
  });

  it("setShield raises and removes the shield without scoring", () => {
    h.debug.setShield(true);
    expect(h.debug.snapshot().effects.shieldActive).toBe(true);
    expect(h.debug.snapshot().score).toBe(0);
    h.debug.setShield(false);
    expect(h.debug.snapshot().effects.shieldActive).toBe(false);
    expect(() => h.debug.setShield(1 as never)).toThrow();
  });

  it("poses the two driver switches", () => {
    h.debug.setWaveAdvance(false);
    h.debug.setPodSpawn(false);
    expect(h.debug.snapshot().waveAdvance).toBe(false);
    expect(h.debug.snapshot().podSpawn).toBe(false);
    h.debug.setWaveAdvance(true);
    expect(h.debug.snapshot().waveAdvance).toBe(true);
    expect(() => h.debug.setPodSpawn("yes" as never)).toThrow();
  });
});

describe("reconcile", () => {
  it("re-derives a stored reading from a posed field", () => {
    h.debug.setScreen("playing");
    h.debug.clearBalls();
    h.debug.setEffectTicks("pierce", 10);
    h.debug.spawnBall(600, 500, 0, 0);
    h.debug.reconcile();
    expect(h.debug.snapshot().balls[0].piercing).toBe(true);
  });

  it("advances nothing", async () => {
    h.debug.setScreen("playing");
    h.debug.clearBalls();
    h.debug.spawnBall(600, 500, 120, -40);
    h.debug.setEffectTicks("widen", 30);
    h.debug.setInterstitialTicks(12);
    await h.step(1);

    const before = h.debug.snapshot();
    h.debug.reconcile();
    const once = h.debug.snapshot();
    h.debug.reconcile();
    const twice = h.debug.snapshot();

    expect(once).toEqual(before);
    expect(twice).toEqual(once);
    expect(once.ticks).toBe(before.ticks);
    expect(once.balls).toEqual(before.balls);
    expect(once.rings).toEqual(before.rings);
    expect(once.effects).toEqual(before.effects);
    expect(once.interstitialTicks).toBe(before.interstitialTicks);
  });

  it("is legal on every screen, and sounds nothing", () => {
    const from = h.cues.length;
    for (const screen of SCREENS) {
      h.debug.setScreen(screen);
      expect(() => h.debug.reconcile()).not.toThrow();
    }
    expect(h.cues.slice(from)).toEqual([]);
  });
});
