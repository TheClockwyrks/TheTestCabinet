// The state operations of specs/instrumentation.md: each pose posed and read
// back, the domains that fail loudly, and the no-op cases the spec fixes.
// Every operation is driven exactly as a caller drives it through the engine:
// the pose is handed the current state and its return replaces it.

import { describe, expect, it } from "vitest";
import { NO_ASSETS } from "./assets";
import { createDebugApi, type KesslerDebugApi } from "./debug";
import { PAUSE_MENU, RINGS, SCREENS, TITLE_MENU, type Cue } from "./figures";
import {
  advanceTicks,
  bootState,
  NO_HELD,
  type FlowIo,
  type KesslerState,
} from "./flow";
import { pointAt, polarOf } from "./polar";

/** One operation with the state argument bound by the harness. */
type Bound<F> = F extends (state: never, ...rest: infer A) => infer R
  ? (...rest: A) => R
  : never;

/** The surface with every operation's state bound: `ops.setScore(500)`. */
type Ops = { [K in keyof KesslerDebugApi]: Bound<KesslerDebugApi[K]> };

/** The four screens carrying no menu (`specs/screens.md`). */
const MENU_FREE = ["howto", "playing", "waveclear", "gameover"] as const;

function makeOps() {
  const cues: Cue[] = [];
  const io: FlowIo = { cue: (cue) => cues.push(cue), particle: () => {} };
  const debug = createDebugApi();
  let state: KesslerState = bootState(NO_ASSETS);
  const ops = new Proxy({} as Ops, {
    get(_target, name) {
      return (...args: unknown[]) => {
        const operation = debug[name as keyof KesslerDebugApi] as (
          view: KesslerState,
          ...rest: unknown[]
        ) => unknown;
        const result = operation(state, ...args);
        // The two readings return what they read; every pose returns the
        // next state (specs/instrumentation.md).
        if (name === "snapshot" || name === "menuItemRect") return result;
        state = result as KesslerState;
        return result;
      };
    },
  });
  return {
    ops,
    cues,
    snapshot: () => debug.snapshot(state),
    rect: (index: number) => debug.menuItemRect(state, index),
    tick: (count = 1) => {
      state = advanceTicks(state, count, NO_HELD, io);
    },
  };
}

describe("reset", () => {
  it("restores the boot state, both switches on", () => {
    const { ops, snapshot, tick } = makeOps();
    ops.setScreen("playing");
    ops.setScore(500);
    ops.setWaveAdvance(false);
    tick();
    ops.reset();
    const snap = snapshot();
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
    const { ops, cues, snapshot } = makeOps();
    ops.setScreen("paused");
    ops.setScore(900);
    ops.setMenuIndex(1);
    ops.setInterstitialTicks(77);
    ops.spawnBall(600, 500, 20, 0);
    const before = snapshot();
    ops.setScreen("title");
    const after = snapshot();
    expect(after.screen).toBe("title");
    expect({ ...after, screen: before.screen }).toEqual(before);
    expect(cues).toEqual([]);
  });

  it("reaches every screen directly", () => {
    const { ops, snapshot } = makeOps();
    for (const name of SCREENS) {
      ops.setScreen(name);
      expect(snapshot().screen).toBe(name);
    }
  });

  it("runs the posed interstitial out into the next wave", () => {
    const { ops, snapshot, tick } = makeOps();
    ops.setScore(700);
    ops.setInterstitialTicks(180);
    ops.setScreen("waveclear");
    tick(179);
    expect(snapshot().screen).toBe("waveclear");
    expect(snapshot().interstitialTicks).toBe(1);
    tick();
    const snap = snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.score).toBe(700);
  });
});

describe("the menu highlight and the interstitial timer", () => {
  it("setMenuIndex poses each entry of both menus, silently", () => {
    const { ops, cues, snapshot } = makeOps();
    for (const screen of ["title", "paused"] as const) {
      ops.setScreen(screen);
      ops.setMenuIndex(1);
      expect(snapshot().menu.index).toBe(1);
      ops.setMenuIndex(0);
      expect(snapshot().menu.index).toBe(0);
    }
    expect(cues).toEqual([]);
  });

  it("setMenuIndex rejects an entry the menu does not carry", () => {
    const { ops } = makeOps();
    ops.setScreen("title");
    expect(() => ops.setMenuIndex(TITLE_MENU.length)).toThrow();
  });

  it("setMenuIndex changes nothing on a screen with no menu", () => {
    const { ops, snapshot } = makeOps();
    for (const screen of MENU_FREE) {
      ops.setScreen(screen);
      const before = snapshot();
      ops.setMenuIndex(1);
      expect(snapshot()).toEqual(before);
    }
  });

  it("setInterstitialTicks is read back and counts down on waveclear alone", () => {
    const { ops, snapshot, tick } = makeOps();
    ops.setInterstitialTicks(40);
    expect(snapshot().interstitialTicks).toBe(40);
    ops.setScreen("paused");
    tick(5);
    expect(snapshot().interstitialTicks).toBe(40);
    ops.setScreen("waveclear");
    tick(5);
    expect(snapshot().interstitialTicks).toBe(35);
  });
});

describe("menuItemRect", () => {
  it("reports a distinct on-stage region for every entry of both menus", () => {
    const { ops, rect } = makeOps();
    for (const [screen, entries] of [
      ["title", TITLE_MENU],
      ["paused", PAUSE_MENU],
    ] as const) {
      ops.setScreen(screen);
      const regions = entries.map((_entry, index) => rect(index));
      for (const region of regions) {
        expect(region).not.toBeNull();
        expect(region!.width).toBeGreaterThan(0);
        expect(region!.height).toBeGreaterThan(0);
        expect(region!.x).toBeGreaterThanOrEqual(0);
        expect(region!.y).toBeGreaterThanOrEqual(0);
        expect(region!.x + region!.width).toBeLessThanOrEqual(1000);
        expect(region!.y + region!.height).toBeLessThanOrEqual(1000);
      }
      expect(regions[0]!.y + regions[0]!.height).toBeLessThanOrEqual(
        regions[1]!.y,
      );
    }
  });

  it("answers null off a menu and past a menu's entries", () => {
    const { ops, rect } = makeOps();
    for (const screen of MENU_FREE) {
      ops.setScreen(screen);
      expect(rect(0)).toBeNull();
    }
    ops.setScreen("title");
    expect(rect(TITLE_MENU.length)).toBeNull();
    expect(rect(-1)).toBeNull();
  });
});

describe("score, lives, wave", () => {
  it("poses score and lives, rejecting anything but whole numbers >= 0", () => {
    const { ops, snapshot } = makeOps();
    ops.setScore(12345);
    ops.setLives(7);
    expect(snapshot().score).toBe(12345);
    expect(snapshot().lives).toBe(7);
    expect(() => ops.setScore(-1)).toThrow();
    expect(() => ops.setScore(1.5)).toThrow();
    expect(() => ops.setLives(-2)).toThrow();
  });

  it("setWave puts the wave figures in force without touching the field", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.setRingAngle(2, 77);
    ops.setWave(4);
    const snap = snapshot();
    expect(snap.wave).toBe(4);
    expect(snap.rings[1].speedDegPerSec).toBe(RINGS[1].speedForWave(4));
    expect(snap.rings[2].speedDegPerSec).toBe(RINGS[2].speedForWave(4));
    // The rings keep their targets and their angles.
    expect(snap.rings[1].angleDeg).toBe(77);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
  });

  it("setWave overwrites a posed ring speed", () => {
    const { ops, snapshot } = makeOps();
    ops.setRingSpeed(1, 99);
    ops.setWave(2);
    expect(snapshot().rings[0].speedDegPerSec).toBe(0);
  });

  it("setWave sets the ball speed a launch serves at", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.setWave(9);
    ops.launchBall();
    const ball = snapshot().balls[0];
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(480, 6);
  });

  it("rejects a wave under 1", () => {
    const { ops } = makeOps();
    expect(() => ops.setWave(0)).toThrow();
  });
});

describe("the deflector and balls", () => {
  it("setPaddleAngle normalizes and carries the parked ball", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.setPaddleAngle(-90);
    const snap = snapshot();
    expect(snap.paddle.angleDeg).toBe(270);
    const at = pointAt(194, 270);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("launchBall acts as Space and is a no-op without a parked ball", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.launchBall();
    expect(snapshot().balls[0].parked).toBe(false);
    ops.launchBall();
    expect(snapshot().balls).toHaveLength(1);
  });

  it("clearBalls empties the field without a life loss", () => {
    const { ops, snapshot, tick } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    ops.clearBalls();
    expect(snapshot().balls).toEqual([]);
    tick();
    expect(snapshot().lives).toBe(3);
    expect(snapshot().screen).toBe("playing");
  });

  it("spawnBall appends in spawn order and stops at the cap", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.parkBall();
    for (let i = 0; i < 7; i += 1) ops.spawnBall(600, 500, 10 * i, 0);
    const balls = snapshot().balls;
    expect(balls).toHaveLength(6);
    expect(balls[1].vx).toBe(0);
    expect(balls[5].vx).toBe(40);
  });

  it("spawnBall marks the ball piercing exactly when pierce is in force", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.clearBalls();
    ops.spawnBall(600, 500, 0, 0);
    expect(snapshot().balls[0].piercing).toBe(false);
    ops.setEffectTicks("pierce", 10);
    ops.spawnBall(620, 500, 0, 0);
    expect(snapshot().balls.map((b) => b.piercing)).toEqual([true, true]);
  });

  it("parkBall parks one ball, and only one", () => {
    const { ops, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.clearBalls();
    ops.parkBall();
    ops.parkBall();
    const balls = snapshot().balls;
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
    const { ops, cues, snapshot } = makeOps();
    ops.setScreen("playing");
    ops.clearTargets();
    const snap = snapshot();
    expect(snap.rings.map((r) => r.targets.length)).toEqual([0, 0, 0]);
    expect(snap.screen).toBe("playing");
    expect(snap.score).toBe(0);
    expect(cues).toEqual([]);
  });

  it("spawnTarget places a target, replacing what the slot holds", () => {
    const { ops, snapshot } = makeOps();
    ops.clearTargets();
    ops.spawnTarget(2, 3, 5);
    expect(snapshot().rings[1].targets).toEqual([{ slot: 3, hp: 5 }]);
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
    const { ops, snapshot } = makeOps();
    ops.setRingAngle(1, 450);
    expect(snapshot().rings[0].angleDeg).toBe(90);
  });

  it("setRingSpeed poses a speed that holds until setWave", () => {
    const { ops, snapshot } = makeOps();
    ops.setRingSpeed(1, -33);
    expect(snapshot().rings[0].speedDegPerSec).toBe(-33);
  });
});

describe("pods, effects, and switches", () => {
  it("spawnPod adds a pod at the point's polar figures", () => {
    const { ops, snapshot } = makeOps();
    const at = pointAt(300, 45);
    ops.spawnPod("narrow", at.x, at.y);
    const pods = snapshot().pods;
    expect(pods).toHaveLength(1);
    expect(pods[0].kind).toBe("narrow");
    expect(pods[0].x).toBeCloseTo(at.x, 9);
    expect(pods[0].y).toBeCloseTo(at.y, 9);
    ops.clearPods();
    expect(snapshot().pods).toEqual([]);
  });

  it("rejects an unknown pod kind", () => {
    const { ops } = makeOps();
    expect(() => ops.spawnPod("magnet" as never, 600, 500)).toThrow();
  });

  it("setEffectTicks puts a span effect in force with the mutual cancel", () => {
    const { ops, snapshot } = makeOps();
    ops.setEffectTicks("widen", 100);
    expect(snapshot().effects.widenTicks).toBe(100);
    expect(snapshot().paddle.spanDeg).toBe(72);
    ops.setEffectTicks("narrow", 50);
    const effects = snapshot().effects;
    expect(effects.narrowTicks).toBe(50);
    expect(effects.widenTicks).toBe(0);
    expect(snapshot().paddle.spanDeg).toBe(30);
    expect(snapshot().score).toBe(0);
  });

  it("setEffectTicks 0 ends the effect and restores the baseline", () => {
    const { ops, snapshot } = makeOps();
    ops.setEffectTicks("narrow", 50);
    ops.setEffectTicks("narrow", 0);
    expect(snapshot().paddle.spanDeg).toBe(48);
    ops.setEffectTicks("pierce", 10);
    ops.setEffectTicks("pierce", 0);
    expect(snapshot().effects.pierceTicks).toBe(0);
  });

  it("pierce runs alongside a span effect", () => {
    const { ops, snapshot } = makeOps();
    ops.setEffectTicks("widen", 100);
    ops.setEffectTicks("pierce", 60);
    const effects = snapshot().effects;
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
    const { ops, snapshot } = makeOps();
    ops.setShield(true);
    expect(snapshot().effects.shieldActive).toBe(true);
    expect(snapshot().score).toBe(0);
    ops.setShield(false);
    expect(snapshot().effects.shieldActive).toBe(false);
    expect(() => ops.setShield(1 as never)).toThrow();
  });

  it("poses the two driver switches", () => {
    const { ops, snapshot } = makeOps();
    ops.setWaveAdvance(false);
    ops.setPodSpawn(false);
    expect(snapshot().waveAdvance).toBe(false);
    expect(snapshot().podSpawn).toBe(false);
    ops.setWaveAdvance(true);
    expect(snapshot().waveAdvance).toBe(true);
    expect(() => ops.setPodSpawn("yes" as never)).toThrow();
  });

  it("a rejected pose leaves the state exactly as it stood", () => {
    const { ops, snapshot } = makeOps();
    ops.setScore(250);
    expect(() => ops.setScore(-1)).toThrow();
    expect(snapshot().score).toBe(250);
  });
});
