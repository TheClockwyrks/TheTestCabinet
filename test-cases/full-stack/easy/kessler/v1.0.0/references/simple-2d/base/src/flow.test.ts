// The screens, menus, tick accumulator, session lifecycle, and snapshot of
// specs/screens.md and specs/instrumentation.md, over the flow's pure
// transitions — the same drives the engine's `update` runs, minus the engine.

import { describe, expect, it } from "vitest";
import { NO_ASSETS } from "./assets";
import { createDebugApi } from "./debug";
import { RINGS, type Action, type Cue, type ParticleSystem } from "./figures";
import {
  advanceTicks,
  advanceTime,
  applyAction,
  bootState,
  cloneState,
  enterWaveclear,
  poseScreen,
  type FlowIo,
  type KesslerState,
  type View,
} from "./flow";
import { pointAt, radialAt } from "./polar";
import { arcCenterDeg } from "./rings";

const debug = createDebugApi();

/** The interstitial entered exactly as the clearing event enters it. */
function enterWaveclearFrom(view: View): KesslerState {
  const draft = cloneState(view);
  enterWaveclear(draft);
  return draft;
}

function makeGame() {
  const cues: Cue[] = [];
  const particles: { system: ParticleSystem; x: number; y: number }[] = [];
  const io: FlowIo = {
    cue: (cue) => cues.push(cue),
    particle: (system, x, y) => particles.push({ system, x, y }),
  };
  const held = { left: false, right: false };
  let state: KesslerState = bootState(NO_ASSETS);
  return {
    cues,
    particles,
    held,
    get state(): View {
      return state;
    },
    snapshot: () => debug.snapshot(state),
    act: (action: Action) => {
      state = applyAction(state, action, io);
    },
    tick: (count = 1) => {
      state = advanceTicks(state, count, held, io);
    },
    update: (dtSeconds: number) => {
      state = advanceTime(state, dtSeconds, held, io);
    },
    pose: (transition: (view: View) => KesslerState) => {
      state = transition(state);
    },
  };
}

describe("boot", () => {
  it("opens on the title with the boot layout", () => {
    const game = makeGame();
    const snap = game.snapshot();
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
    const game = makeGame();
    game.act("down");
    expect(game.snapshot().menu.index).toBe(1);
    game.act("down");
    expect(game.snapshot().menu.index).toBe(0);
    game.act("up");
    expect(game.snapshot().menu.index).toBe(1);
    expect(game.cues).toEqual(["menu-move", "menu-move", "menu-move"]);
  });

  it("starts a fresh session on START, with a ball parked", () => {
    const game = makeGame();
    game.act("confirm");
    const snap = game.snapshot();
    expect(game.cues).toEqual(["menu-select"]);
    expect(snap.screen).toBe("playing");
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
    const at = pointAt(194, 90);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("opens the how-to on HOW TO PLAY, and both exits return", () => {
    const game = makeGame();
    game.act("down");
    game.act("confirm");
    expect(game.snapshot().screen).toBe("howto");
    game.act("confirm");
    expect(game.snapshot().screen).toBe("title");
    game.act("confirm");
    game.act("back");
    expect(game.snapshot().screen).toBe("title");
  });

  it("returns from the how-to with HOW TO PLAY highlighted", () => {
    const game = makeGame();
    game.act("down");
    game.act("confirm");
    game.act("back");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(1);
  });

  it("returns from a discarded session with START highlighted", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("pause");
    game.act("down");
    game.act("confirm");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(0);
  });

  it("opens the pause menu on RESUME however far the highlight had moved", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("pause");
    game.act("down");
    expect(game.snapshot().menu.index).toBe(1);
    game.act("pause");
    game.act("pause");
    const snap = game.snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.menu.index).toBe(0);
  });
});

describe("playing", () => {
  it("launches the parked ball on the launch action", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("launch");
    const ball = game.snapshot().balls[0];
    expect(ball.parked).toBe(false);
    expect(ball.vy).toBeCloseTo(240, 6);
  });

  it("turns the deflector while a rotation action is held", () => {
    const game = makeGame();
    game.act("confirm");
    game.held.right = true;
    game.tick(2);
    expect(game.snapshot().paddle.angleDeg).toBeCloseTo(99, 9);
  });

  it("pauses on back and on pause", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("back");
    expect(game.snapshot().screen).toBe("paused");
    game.act("back");
    game.act("pause");
    expect(game.snapshot().screen).toBe("paused");
  });
});

describe("paused", () => {
  it("freezes the whole simulation and resumes intact", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("launch");
    game.tick(10);
    game.act("pause");
    const frozen = game.snapshot();
    game.tick(30);
    const later = game.snapshot();
    expect(later.balls).toEqual(frozen.balls);
    expect(later.rings).toEqual(frozen.rings);
    expect(later.effects).toEqual(frozen.effects);
    expect(later.score).toBe(frozen.score);
    // RESUME carries on from exactly there.
    game.act("confirm");
    expect(game.snapshot().screen).toBe("playing");
    expect(game.snapshot().balls).toEqual(frozen.balls);
  });

  it("discards the session on QUIT", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("launch");
    game.tick(10);
    game.act("pause");
    game.act("down");
    game.act("confirm");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.balls).toEqual([]);
    expect(snap.menu.index).toBe(0);
  });

  it("resumes on back and pause exactly as RESUME does", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("pause");
    game.act("pause");
    expect(game.snapshot().screen).toBe("playing");
    game.act("back");
    game.act("back");
    expect(game.snapshot().screen).toBe("playing");
  });
});

describe("the wave-clear interstitial", () => {
  it("runs 180 ticks and lays out the next wave", () => {
    const game = makeGame();
    game.act("confirm");
    game.pose((s) => enterWaveclearFrom(s));
    game.tick(179);
    expect(game.snapshot().screen).toBe("waveclear");
    game.tick();
    const snap = game.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.wave).toBe(2);
    expect(snap.rings.map((r) => r.targets.length)).toEqual([12, 16, 20]);
    expect(snap.rings.map((r) => r.angleDeg)).toEqual([0, 0, 0]);
    expect(snap.rings[1].speedDegPerSec).toBe(RINGS[1].speedForWave(2));
    expect(snap.rings[2].speedDegPerSec).toBe(RINGS[2].speedForWave(2));
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
  });

  it("clears balls, pods, effects, and the shield on entry", () => {
    const game = makeGame();
    game.act("confirm");
    game.pose((s) => debug.setEffectTicks(s, "pierce", 100));
    game.pose((s) => debug.setShield(s, true));
    game.pose((s) => debug.spawnPod(s, "widen", 800, 500));
    game.pose((s) => enterWaveclearFrom(s));
    const snap = game.snapshot();
    expect(snap.balls).toEqual([]);
    expect(snap.pods).toEqual([]);
    expect(snap.effects.pierceTicks).toBe(0);
    expect(snap.effects.shieldActive).toBe(false);
  });
});

describe("game over", () => {
  it("enters on the last life with the game-over cue, and confirm returns to title", () => {
    const game = makeGame();
    game.act("confirm");
    game.pose((s) => debug.setLives(s, 1));
    game.pose((s) => debug.clearBalls(s));
    const at = pointAt(90, 90);
    game.pose((s) => debug.spawnBall(s, at.x, at.y, 0, -240));
    game.pose((s) => debug.setScore(s, 1234));
    game.tick(5);
    const snap = game.snapshot();
    expect(snap.screen).toBe("gameover");
    expect(snap.lives).toBe(0);
    expect(snap.score).toBe(1234);
    expect(game.cues).toContain("game-over");
    game.act("confirm");
    expect(game.snapshot().screen).toBe("title");
  });

  it("plays no cue when posed by setScreen", () => {
    const game = makeGame();
    game.pose((s) => poseScreen(s, "gameover"));
    expect(game.snapshot().screen).toBe("gameover");
    expect(game.cues).toEqual([]);
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
    const game = makeGame();
    game.update(0.5 / 60);
    expect(game.snapshot().ticks).toBe(0);
    game.update(0.5 / 60);
    expect(game.snapshot().ticks).toBe(1);
  });
});

describe("reset", () => {
  it("restores the boot state and zero ticks", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("launch");
    game.pose((s) => debug.setWaveAdvance(s, false));
    game.pose((s) => debug.setPodSpawn(s, false));
    game.tick(30);
    game.pose((s) => debug.reset(s));
    const snap = game.snapshot();
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
    const game = makeGame();
    game.pose((s) => debug.setNextPod(s, "shield"));
    expect(game.snapshot().nextPod).toBe("shield");
    game.pose((s) => debug.reset(s));
    expect(game.snapshot().nextPod).toBeNull();
  });

  it("sheds a posed kind from the next destruction and clears the pose", () => {
    const game = makeGame();
    game.pose((s) => debug.setScreen(s, "playing"));
    game.pose((s) => debug.setWaveAdvance(s, false));
    game.pose((s) => debug.setNextPod(s, "pierce"));
    game.pose((s) => debug.setEffectTicks(s, "pierce", 100));
    game.pose((s) => debug.setRingAngle(s, 1, 0));
    // A piercing ball fired inward at ring 1's slot 0 destroys it.
    const theta = arcCenterDeg(RINGS[0], 0, 0);
    const at = pointAt(332, theta);
    const inward = radialAt(theta);
    game.pose((s) =>
      debug.spawnBall(s, at.x, at.y, -240 * inward.x, -240 * inward.y),
    );
    game.tick(6);
    const snap = game.snapshot();
    expect(snap.rings[0].targets.some((t) => t.slot === 0)).toBe(false);
    expect(snap.pods.map((pod) => pod.kind)).toEqual(["pierce"]);
    expect(snap.nextPod).toBeNull();
  });

  it("never writes into the state a transition was handed", () => {
    const game = makeGame();
    game.act("confirm");
    game.act("launch");
    const before = game.state;
    const frozen = JSON.stringify(debug.snapshot(before));
    advanceTicks(before, 120, { left: false, right: true });
    expect(JSON.stringify(debug.snapshot(before))).toBe(frozen);
  });
});
