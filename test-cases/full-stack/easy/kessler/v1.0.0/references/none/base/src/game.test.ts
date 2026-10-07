// The screens, menus, tick accumulator, session lifecycle, and snapshot of
// specs/screens.md and specs/instrumentation.md.

import { describe, expect, it } from "vitest";
import { RINGS, type Cue, type ParticleSystem } from "./constants";
import { Game } from "./game";
import { pointAt, radialAt } from "./polar";
import { arcCenterDeg } from "./rings";

function makeGame() {
  const cues: Cue[] = [];
  const particles: { system: ParticleSystem; x: number; y: number }[] = [];
  const game = new Game({
    cue: (cue) => cues.push(cue),
    particle: (system, x, y) => particles.push({ system, x, y }),
  });
  return { game, cues, particles };
}

describe("boot", () => {
  it("opens on the title with the boot layout", () => {
    const { game } = makeGame();
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
    expect(snap.autoStep).toBe(true);
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
    const { game, cues } = makeGame();
    game.handleAction("down");
    expect(game.snapshot().menu.index).toBe(1);
    game.handleAction("down");
    expect(game.snapshot().menu.index).toBe(0);
    game.handleAction("up");
    expect(game.snapshot().menu.index).toBe(1);
    expect(cues).toEqual(["menu-move", "menu-move", "menu-move"]);
  });

  it("starts a fresh session on START, with a ball parked", () => {
    const { game, cues } = makeGame();
    game.handleAction("confirm");
    const snap = game.snapshot();
    expect(cues).toEqual(["menu-select"]);
    expect(snap.screen).toBe("playing");
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0].parked).toBe(true);
    const at = pointAt(194, 90);
    expect(snap.balls[0].x).toBeCloseTo(at.x, 9);
    expect(snap.balls[0].y).toBeCloseTo(at.y, 9);
  });

  it("opens the how-to on HOW TO PLAY, and both exits return", () => {
    const { game } = makeGame();
    game.handleAction("down");
    game.handleAction("confirm");
    expect(game.snapshot().screen).toBe("howto");
    game.handleAction("confirm");
    expect(game.snapshot().screen).toBe("title");
    game.handleAction("confirm");
    game.handleAction("back");
    expect(game.snapshot().screen).toBe("title");
  });

  it("returns from the how-to with HOW TO PLAY highlighted", () => {
    const { game } = makeGame();
    game.handleAction("down");
    game.handleAction("confirm");
    game.handleAction("back");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(1);
  });

  it("returns from a discarded session with START highlighted", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("pause");
    game.handleAction("down");
    game.handleAction("confirm");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menu.index).toBe(0);
  });

  it("opens the pause menu on RESUME however far the highlight had moved", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("pause");
    game.handleAction("down");
    expect(game.snapshot().menu.index).toBe(1);
    game.handleAction("pause");
    game.handleAction("pause");
    const snap = game.snapshot();
    expect(snap.screen).toBe("paused");
    expect(snap.menu.index).toBe(0);
  });

  it("answers the pointer and the finger over an entry's region", () => {
    const { game, cues } = makeGame();
    const rect = game.menuItemRect(1);
    expect(rect).not.toBeNull();
    const at = {
      x: rect!.x + rect!.width / 2,
      y: rect!.y + rect!.height / 2,
    };

    game.handlePointer({ type: "move", x: at.x, y: at.y });
    expect(game.snapshot().menu.index).toBe(1);
    expect(game.snapshot().screen).toBe("title");
    expect(cues).toEqual(["menu-move"]);

    game.handlePointer({ type: "down", x: at.x, y: at.y });
    game.handlePointer({ type: "up", x: 8, y: 8 });
    expect(game.snapshot().screen).toBe("title");

    game.handlePointer({ type: "down", x: at.x, y: at.y });
    game.handlePointer({ type: "up", x: at.x, y: at.y });
    expect(game.snapshot().screen).toBe("howto");
  });
});

describe("playing", () => {
  it("launches the parked ball on the launch action", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("launch");
    const ball = game.snapshot().balls[0];
    expect(ball.parked).toBe(false);
    expect(ball.vy).toBeCloseTo(240, 6);
  });

  it("turns the deflector while a rotation action is held", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.held.right = true;
    game.tick();
    game.tick();
    expect(game.snapshot().paddle.angleDeg).toBeCloseTo(99, 9);
  });

  it("pauses on back and on pause", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("back");
    expect(game.snapshot().screen).toBe("paused");
    game.handleAction("back");
    game.handleAction("pause");
    expect(game.snapshot().screen).toBe("paused");
  });
});

describe("paused", () => {
  it("freezes the whole simulation and resumes intact", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("launch");
    for (let i = 0; i < 10; i += 1) game.tick();
    game.handleAction("pause");
    const frozen = game.snapshot();
    for (let i = 0; i < 30; i += 1) game.tick();
    const later = game.snapshot();
    expect(later.balls).toEqual(frozen.balls);
    expect(later.rings).toEqual(frozen.rings);
    expect(later.effects).toEqual(frozen.effects);
    expect(later.score).toBe(frozen.score);
    // RESUME carries on from exactly there.
    game.handleAction("confirm");
    expect(game.snapshot().screen).toBe("playing");
    expect(game.snapshot().balls).toEqual(frozen.balls);
  });

  it("discards the session on QUIT", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("launch");
    for (let i = 0; i < 10; i += 1) game.tick();
    game.handleAction("pause");
    game.handleAction("down");
    game.handleAction("confirm");
    const snap = game.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.score).toBe(0);
    expect(snap.balls).toEqual([]);
    expect(snap.menu.index).toBe(0);
  });

  it("resumes on back and pause exactly as RESUME does", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("pause");
    game.handleAction("pause");
    expect(game.snapshot().screen).toBe("playing");
    game.handleAction("back");
    game.handleAction("back");
    expect(game.snapshot().screen).toBe("playing");
  });
});

describe("the wave-clear interstitial", () => {
  it("runs 180 ticks and lays out the next wave", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.enterWaveclear();
    for (let i = 0; i < 179; i += 1) game.tick();
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

  it("reads no input", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.enterWaveclear();
    game.handleAction("confirm");
    game.handleAction("back");
    game.handleAction("launch");
    expect(game.snapshot().screen).toBe("waveclear");
    expect(game.snapshot().balls).toEqual([]);
  });

  it("clears balls, pods, effects, and the shield on entry", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.session.effects.pierceTicks = 100;
    game.session.effects.shieldActive = true;
    game.session.pods.push({
      kind: "widen",
      r: 300,
      angleDeg: 0,
      spawnTick: 0,
    });
    game.enterWaveclear();
    const snap = game.snapshot();
    expect(snap.balls).toEqual([]);
    expect(snap.pods).toEqual([]);
    expect(snap.effects.pierceTicks).toBe(0);
    expect(snap.effects.shieldActive).toBe(false);
  });
});

describe("game over", () => {
  it("enters on the last life with the game-over cue, and confirm returns to title", () => {
    const { game, cues } = makeGame();
    game.handleAction("confirm");
    game.session.lives = 1;
    game.session.balls = [];
    const at = pointAt(90, 90);
    game.session.balls.push({
      x: at.x,
      y: at.y,
      vx: 0,
      vy: -240,
      parked: false,
      spawnTick: 0,
    });
    game.session.score = 1234;
    for (let i = 0; i < 5; i += 1) game.tick();
    const snap = game.snapshot();
    expect(snap.screen).toBe("gameover");
    expect(snap.lives).toBe(0);
    expect(snap.score).toBe(1234);
    expect(cues).toContain("game-over");
    game.handleAction("confirm");
    expect(game.snapshot().screen).toBe("title");
  });

  it("plays no cue when posed by setScreen", () => {
    const { game, cues } = makeGame();
    game.poseScreen("gameover");
    expect(game.snapshot().screen).toBe("gameover");
    expect(cues).toEqual([]);
  });
});

describe("the accumulator", () => {
  it("resolves sixty ticks from one second however it is divided", () => {
    const whole = makeGame().game;
    whole.update(1);
    expect(whole.snapshot().ticks).toBe(60);

    const divided = makeGame().game;
    for (let i = 0; i < 60; i += 1) divided.update(1 / 60);
    expect(divided.snapshot().ticks).toBe(60);
  });

  it("carries the remainder into the next frame", () => {
    const { game } = makeGame();
    game.update(0.5 / 60);
    expect(game.snapshot().ticks).toBe(0);
    game.update(0.5 / 60);
    expect(game.snapshot().ticks).toBe(1);
  });
});

describe("reset", () => {
  it("restores the boot state and zero ticks", () => {
    const { game } = makeGame();
    game.handleAction("confirm");
    game.handleAction("launch");
    game.waveAdvance = false;
    game.podSpawn = false;
    for (let i = 0; i < 30; i += 1) game.tick();
    game.reset();
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
    const { game } = makeGame();
    game.nextPod = "shield";
    game.reset();
    expect(game.snapshot().nextPod).toBeNull();
  });
});

describe("the pod draw through the game", () => {
  it("reports the posed outcome until a destruction consumes it", () => {
    const { game } = makeGame();
    expect(game.snapshot().nextPod).toBeNull();
    game.nextPod = "pierce";
    expect(game.snapshot().nextPod).toBe("pierce");

    // A piercing ball fired at ring 1's slot 0 destroys it within the tick
    // budget; the destruction sheds the posed kind and clears the pose.
    game.poseScreen("playing");
    game.waveAdvance = false;
    game.session.effects.pierceTicks = 100;
    const theta = arcCenterDeg(RINGS[0], 0, 0);
    const at = pointAt(332, theta);
    const inward = radialAt(theta);
    game.session.balls.push({
      x: at.x,
      y: at.y,
      vx: -240 * inward.x,
      vy: -240 * inward.y,
      parked: false,
      spawnTick: 0,
    });
    for (let i = 0; i < 6; i += 1) game.tick();
    expect(game.session.rings[0].targets[0]).toBeNull();
    expect(game.snapshot().pods.map((pod) => pod.kind)).toEqual(["pierce"]);
    expect(game.snapshot().nextPod).toBeNull();
  });

  it("draws a pod alone, spawning nothing and keeping the pose", () => {
    const { game, cues } = makeGame();
    game.nextPod = "widen";
    const before = game.snapshot();
    const outcomes = new Set<string | null>();
    for (let i = 0; i < 400; i += 1) outcomes.add(game.drawPod());
    for (const outcome of outcomes) {
      expect([
        null,
        "widen",
        "multiball",
        "shield",
        "pierce",
        "narrow",
      ]).toContain(outcome);
    }
    expect(outcomes.size).toBeGreaterThan(1);
    expect(game.snapshot()).toEqual(before);
    expect(cues).toEqual([]);
  });
});
