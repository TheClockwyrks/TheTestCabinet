// The clock half of `window.__kessler`: setAutoStep and step validate loudly
// and reach the runtime's clock; reset also clears what the runtime keeps.

import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { pointAt, scaledTo } from "./polar";
import { createApi, type SurfaceClock } from "./surface";

function recordingClock(): SurfaceClock & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setAutoStep(auto) {
      calls.push(`auto:${auto}`);
    },
    step(ticks) {
      calls.push(`step:${ticks}`);
    },
  };
}

describe("createApi", () => {
  it("routes setAutoStep and step to the clock", () => {
    const clock = recordingClock();
    const api = createApi(new Game(), clock);
    api.setAutoStep(false);
    api.step(5);
    api.step(); // defaults to 1
    expect(clock.calls).toEqual(["auto:false", "step:5", "step:1"]);
  });

  it("rejects a non-boolean autoStep and a bad tick count loudly", () => {
    const api = createApi(new Game(), recordingClock());
    expect(() => api.setAutoStep(1 as unknown as boolean)).toThrow(/boolean/);
    expect(() => api.step(0)).toThrow(/at least 1/);
    expect(() => api.step(2.5)).toThrow(/whole number/);
  });

  it("still exposes the state operations", () => {
    const game = new Game();
    const api = createApi(game, recordingClock());
    api.setScore(1200);
    expect(api.snapshot().score).toBe(1200);
  });

  it("runs onReset after a reset, so the runtime can clear its effects", () => {
    const game = new Game();
    let cleared = 0;
    const api = createApi(game, recordingClock(), () => {
      cleared += 1;
    });
    game.tick();
    api.reset();
    expect(cleared).toBe(1);
    expect(api.snapshot().ticks).toBe(0);
  });
});

/** A clock with Runtime's semantics, minus the canvas: step ticks the game. */
function tickingClock(game: Game): SurfaceClock {
  return {
    setAutoStep(auto) {
      game.autoStep = auto;
    },
    step(ticks) {
      for (let i = 0; i < ticks; i += 1) game.tick();
    },
  };
}

describe("determinism through the surface", () => {
  it("reproduces identical snapshots from the same seed and the same ops", () => {
    const run = (): unknown => {
      const game = new Game();
      const api = createApi(game, tickingClock(game));
      api.setAutoStep(false);
      api.reset(42);
      api.setScreen("playing");
      api.setPaddleAngle(15);
      api.parkBall();
      api.launchBall();
      api.setRingSpeed(3, -21.5);
      api.spawnBall(100, 500, 180, -120);
      api.spawnPod("widen", 300, 640);
      api.setEffectTicks("pierce", 90);
      api.reconcile();
      api.step(240);
      return api.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it("draws a different pod sequence from a different seed, same ops", () => {
    const run = (seed: number): unknown => {
      const game = new Game();
      const api = createApi(game, tickingClock(game));
      api.setAutoStep(false);
      api.reset(seed);
      api.setScreen("playing");
      // Rain hits until pod draws diverge: pierce destroys outright, and
      // wave advance held off keeps the session on `playing` throughout.
      api.setWaveAdvance(false);
      api.setEffectTicks("pierce", 100000);
      for (let i = 0; i < 12; i += 1) {
        api.setRingAngle(1, 0);
        api.spawnTarget(1, 0, 1);
        api.clearBalls();
        api.spawnBall(...outsideRingOne());
        api.step(30);
      }
      const snap = api.snapshot();
      return { pods: snap.pods.map((pod) => pod.kind), score: snap.score };
    };
    const a = run(1);
    const b = run(999);
    expect(run(1)).toEqual(a);
    expect(a).not.toEqual(b);
  });

  it("steps through the real tick path, so cues fire on stepped contacts", () => {
    const cues: string[] = [];
    const game = new Game({ cue: (cue) => cues.push(cue), particle: () => {} });
    const api = createApi(game, tickingClock(game));
    api.setAutoStep(false);
    api.setScreen("playing");
    api.setPodSpawn(false);
    api.clearBalls();
    api.setRingAngle(1, 0);
    api.spawnBall(...outsideRingOne());
    cues.length = 0;
    api.step(30);
    expect(cues).toContain("target-hit");
  });

  it("holds autoStep across reset, as the caller's rather than the session's", () => {
    const game = new Game();
    const api = createApi(game, tickingClock(game));
    api.setAutoStep(false);
    api.reset();
    expect(api.snapshot().autoStep).toBe(false);
    expect(api.snapshot().waveAdvance).toBe(true);
    expect(api.snapshot().podSpawn).toBe(true);
  });
});

/** A ball just outside ring 1's outer contact radius, falling straight in. */
function outsideRingOne(): [number, number, number, number] {
  // Angle 15 sits inside slot 0's target arc ([2, 28] at ring angle 0), and
  // radius 326 crosses the outer contact radius 322 with margin on the first
  // 4-unit tick (240 units per second inward).
  const at = pointAt(326, 15);
  const inward = scaledTo({ x: 500 - at.x, y: 500 - at.y }, 240);
  return [at.x, at.y, inward.x, inward.y];
}
