// The screens, menus, tick accumulator, session lifecycle, and snapshot of
// specs/screens.md and specs/instrumentation.md. The game state is a live
// object, so every check here builds one, drives it through the same flow
// functions the controller and the game mode call, and reads it back through
// the snapshot the debug surface reports.

import { describe, expect, it } from "vitest";
import { RINGS, type ActionName, type CueName } from "./constants";
import { snapshotOf } from "./debug";
import { ringSpeedForWave } from "./figures";
import {
  enterWaveclear,
  handleAction,
  poseScreen,
  resetState,
  runOneTick,
  runTicks,
  type TickHooks,
} from "./flow";
import { KesslerState } from "./game";
import { pointAt, radialAt } from "./polar";
import { arcCenterDeg } from "./rings";
import type { ParticleSystemName } from "./sim";

function makeGame() {
  const cues: CueName[] = [];
  const particles: { system: ParticleSystemName; x: number; y: number }[] = [];
  const state = new KesslerState();
  const hooks: TickHooks = {
    cue: (cue) => cues.push(cue),
    particle: (system, x, y) => particles.push({ system, x, y }),
  };
  const act = (action: ActionName): void => {
    handleAction(state, action, state.screen, hooks);
  };
  const tick = (): void => runOneTick(state, hooks);
  const update = (dtSeconds: number): void => {
    state.accumulator += dtSeconds;
    runTicks(state, hooks);
  };
  const snapshot = () => snapshotOf(state);
  return { state, hooks, cues, particles, act, tick, update, snapshot };
}

function addBall(
  state: KesslerState,
  x: number,
  y: number,
  vx: number,
  vy: number,
): void {
  state.nextId += 1;
  state.balls.push({
    id: state.nextId,
    x,
    y,
    vx,
    vy,
    parked: false,
    spawnTick: 0,
  });
}

describe("boot", () => {
  it("opens on the title with the boot layout", () => {
    const { snapshot } = makeGame();
    const snap = snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(0);
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(3);
    expect(snap.wave).toBe(1);
    expect(snap.ticks).toBe(0);
    expect(snap.paddle).toEqual({ angleDeg: 90, spanDeg: 48 });
    expect(snap.balls).toEqual([]);
    expect(snap.pods).toEqual([]);
    expect(snap.waveAdvance).toBe(true);
    expect(snap.podSpawn).toBe(true);
    expect(snap.effects).toEqual({
      widenTicks: 0,
      narrowTicks: 0,
      pierceTicks: 0,
      shieldActive: false,
    });
    expect(snap.rings).toHaveLength(3);
    expect(snap.rings[0].angleDeg).toBe(0);
    expect(snap.rings[0].speedDegPerSec).toBe(0);
    expect(snap.rings[1].speedDegPerSec).toBe(12);
    expect(snap.rings[2].speedDegPerSec).toBe(-8);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
    expect(snap.rings[1].targets[0]).toEqual({ slot: 0, hp: 2 });
  });
});

describe("the title menu", () => {
  it("moves the highlight with wrap-around, playing menu-move", () => {
    const { act, cues, snapshot } = makeGame();
    act("down");
    expect(snapshot().menu.index).toBe(1);
    act("down");
    expect(snapshot().menu.index).toBe(0);
    act("up");
    expect(snapshot().menu.index).toBe(1);
    expect(cues).toEqual(["menu-move", "menu-move", "menu-move"]);
  });

  it("starts a fresh session on START, with a ball parked", () => {
    const { act, cues, snapshot } = makeGame();
    act("confirm");
    const snap = snapshot();
    expect(cues).toEqual(["menu-select"]);
    expect(snap.screen).toBe("playing");
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
    const at = pointAt(194, 90);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("opens the how-to on HOW TO PLAY, and both exits return", () => {
    const { act, snapshot } = makeGame();
    act("down");
    act("confirm");
    expect(snapshot().screen).toBe("howto");
    act("confirm");
    expect(snapshot().screen).toBe("title");
    act("confirm");
    act("back");
    expect(snapshot().screen).toBe("title");
  });

  it("returns from the how-to with HOW TO PLAY highlighted", () => {
    const { act, snapshot } = makeGame();
    act("down");
    act("confirm");
    act("back");
    const snap = snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(1);
  });

  it("returns from a discarded session with START highlighted", () => {
    const { act, snapshot } = makeGame();
    act("confirm");
    act("pause");
    act("down");
    act("confirm");
    const snap = snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(0);
  });

  it("opens the pause menu on RESUME however far the highlight had moved", () => {
    const { act, snapshot } = makeGame();
    act("confirm");
    act("pause");
    act("down");
    expect(snapshot().menu.index).toBe(1);
    act("pause");
    act("pause");
    const snap = snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.menu.index).toBe(0);
  });
});

describe("playing", () => {
  it("launches the parked ball on the launch action", () => {
    const { act, snapshot } = makeGame();
    act("confirm");
    act("launch");
    const ball = snapshot().balls[0];
    expect(ball.parked).toBe(false);
    expect(ball.vy).toBeCloseTo(240, 6);
  });

  it("turns the deflector while a rotation action is held", () => {
    const { act, state, tick, snapshot } = makeGame();
    act("confirm");
    state.held.right = true;
    tick();
    tick();
    expect(snapshot().paddle.angleDeg).toBeCloseTo(99, 9);
  });

  it("pauses on back and on pause", () => {
    const { act, snapshot } = makeGame();
    act("confirm");
    act("back");
    expect(snapshot().screen).toBe("paused");
    act("back");
    act("pause");
    expect(snapshot().screen).toBe("paused");
  });
});

describe("paused", () => {
  it("freezes the whole simulation and resumes intact", () => {
    const { act, tick, snapshot } = makeGame();
    act("confirm");
    act("launch");
    for (let i = 0; i < 10; i += 1) tick();
    act("pause");
    const frozen = snapshot();
    for (let i = 0; i < 30; i += 1) tick();
    const later = snapshot();
    expect(later.balls).toEqual(frozen.balls);
    expect(later.rings).toEqual(frozen.rings);
    expect(later.effects).toEqual(frozen.effects);
    expect(later.score).toBe(frozen.score);
    // RESUME carries on from exactly there.
    act("confirm");
    expect(snapshot().screen).toBe("playing");
    expect(snapshot().balls).toEqual(frozen.balls);
  });

  it("discards the session on QUIT", () => {
    const { act, tick, snapshot } = makeGame();
    act("confirm");
    act("launch");
    for (let i = 0; i < 10; i += 1) tick();
    act("pause");
    act("down");
    act("confirm");
    const snap = snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.balls).toEqual([]);
    expect(snap.menu.index).toBe(0);
  });

  it("resumes on back and pause exactly as RESUME does", () => {
    const { act, snapshot } = makeGame();
    act("confirm");
    act("pause");
    act("pause");
    expect(snapshot().screen).toBe("playing");
    act("back");
    act("back");
    expect(snapshot().screen).toBe("playing");
  });
});

describe("the wave-clear interstitial", () => {
  it("runs 180 ticks and lays out the next wave", () => {
    const { act, state, tick, snapshot } = makeGame();
    act("confirm");
    enterWaveclear(state);
    for (let i = 0; i < 179; i += 1) tick();
    expect(snapshot().screen).toBe("waveclear");
    tick();
    const snap = snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
    expect(snap.rings.map((r) => r.angleDeg)).toEqual([0, 0, 0]);
    expect(snap.rings[1].speedDegPerSec).toBe(ringSpeedForWave(RINGS[1], 2));
    expect(snap.rings[2].speedDegPerSec).toBe(ringSpeedForWave(RINGS[2], 2));
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
  });

  it("reads no input", () => {
    const { act, state, snapshot } = makeGame();
    act("confirm");
    enterWaveclear(state);
    act("confirm");
    act("back");
    act("launch");
    expect(snapshot().screen).toBe("waveclear");
    expect(snapshot().balls).toEqual([]);
  });

  it("clears balls, pods, effects, and the shield on entry", () => {
    const { act, state, snapshot } = makeGame();
    act("confirm");
    state.effects.pierceTicks = 100;
    state.effects.shieldActive = true;
    state.nextId += 1;
    state.pods.push({ id: state.nextId, kind: "widen", r: 300, angleDeg: 0 });
    enterWaveclear(state);
    const snap = snapshot();
    expect(snap.balls).toEqual([]);
    expect(snap.pods).toEqual([]);
    expect(snap.effects.pierceTicks).toBe(0);
    expect(snap.effects.shieldActive).toBe(false);
  });
});

describe("game over", () => {
  it("enters on the last life with the game-over cue, and confirm returns to title", () => {
    const { act, state, tick, cues, snapshot } = makeGame();
    act("confirm");
    state.lives = 1;
    state.balls = [];
    const at = pointAt(90, 90);
    addBall(state, at.x, at.y, 0, -240);
    state.score = 1234;
    for (let i = 0; i < 5; i += 1) tick();
    const snap = snapshot();
    expect(snap.screen).toBe("gameover");
    expect(snap.lives).toBe(0);
    expect(snap.score).toBe(1234);
    expect(cues).toContain("game-over");
    act("confirm");
    expect(snapshot().screen).toBe("title");
  });

  it("plays no cue when posed by setScreen", () => {
    const { state, cues, snapshot } = makeGame();
    poseScreen(state, "gameover");
    expect(snapshot().screen).toBe("gameover");
    expect(cues).toEqual([]);
  });
});

describe("the accumulator", () => {
  it("resolves sixty ticks from one second however it is divided", () => {
    const whole = makeGame();
    whole.update(1);
    expect(whole.snapshot().ticks).toBe(60);

    const divided = makeGame();
    for (let i = 0; i < 60; i += 1) divided.update(1 / 60);
    expect(divided.snapshot().ticks).toBe(60);
  });

  it("carries the remainder into the next frame", () => {
    const { update, snapshot } = makeGame();
    update(0.5 / 60);
    expect(snapshot().ticks).toBe(0);
    update(0.5 / 60);
    expect(snapshot().ticks).toBe(1);
  });
});

describe("reset", () => {
  it("restores the boot state and zero ticks", () => {
    const { act, state, tick, snapshot } = makeGame();
    act("confirm");
    act("launch");
    state.waveAdvance = false;
    state.podSpawn = false;
    for (let i = 0; i < 30; i += 1) tick();
    resetState(state);
    const snap = snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.ticks).toBe(0);
    expect(snap.score).toBe(0);
    expect(snap.lives).toBe(3);
    expect(snap.wave).toBe(1);
    expect(snap.balls).toEqual([]);
    expect(snap.waveAdvance).toBe(true);
    expect(snap.podSpawn).toBe(true);
    expect(snap.paddle.angleDeg).toBe(90);
  });

  it("clears a posed pod outcome", () => {
    const { state, snapshot } = makeGame();
    state.nextPod = "shield";
    resetState(state);
    expect(snapshot().nextPod).toBeNull();
  });
});

describe("the posed pod draw", () => {
  it("sheds the posed kind from the next destruction and clears the pose", () => {
    const { state, tick, snapshot } = makeGame();
    poseScreen(state, "playing");
    state.waveAdvance = false;
    state.nextPod = "pierce";
    state.effects.pierceTicks = 100;
    // A piercing ball fired inward at ring 1's slot 0 destroys it.
    const theta = arcCenterDeg(RINGS[0], 0, 0);
    const at = pointAt(332, theta);
    const inward = radialAt(theta);
    addBall(state, at.x, at.y, -240 * inward.x, -240 * inward.y);
    for (let i = 0; i < 6; i += 1) tick();
    const snap = snapshot();
    expect(snap.rings[0].targets.some((t) => t.slot === 0)).toBe(false);
    expect(snap.pods.map((pod) => pod.kind)).toEqual(["pierce"]);
    expect(snap.nextPod).toBeNull();
  });
});
