import { describe, expect, it } from "vitest";
import {
  BASE_MAX_HP,
  CONTACT_COOLDOWN,
  DAWN_TICK,
  ENEMIES,
  MOVE_SPEED,
  TICK_DT,
  type Cue,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type WickState } from "../state";
import { NOTHING_HELD, type Held } from "./context";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";

function playing(): { state: WickState; rng: Rng; cues: Set<Cue> } {
  const state = initialState(1);
  state.run = freshRun();
  state.screen = "playing";
  // Taper would slash whatever stands at the lamplighter's feet.
  state.switches.weaponFire = false;
  const rng = new Rng(() => state);
  return { state, rng, cues: new Set() };
}

function run(
  world: ReturnType<typeof playing>,
  ticks: number,
  held: Partial<Held> = {},
): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, { ...NOTHING_HELD, ...held }, world.cues);
  }
}

describe("movement", () => {
  it("advances by moveSpeed × TICK_DT along each held direction", () => {
    const world = playing();
    run(world, 60, { right: 1 });
    expect(world.state.run.player.x).toBeCloseTo(MOVE_SPEED, 6);
    expect(world.state.run.player.y).toBe(0);
    run(world, 60, { down: 1 });
    expect(world.state.run.player.y).toBeCloseTo(MOVE_SPEED, 6);
    run(world, 60, { left: 1 });
    expect(world.state.run.player.x).toBeCloseTo(0, 6);
    run(world, 60, { up: 1 });
    expect(world.state.run.player.y).toBeCloseTo(0, 6);
  });

  it("moves diagonally exactly as fast as cardinally", () => {
    const world = playing();
    run(world, 60, { right: 1, down: 1 });
    const { x, y } = world.state.run.player;
    expect(Math.hypot(x, y)).toBeCloseTo(MOVE_SPEED, 6);
    expect(x).toBeCloseTo(y, 9);
  });

  it("cancels opposite actions", () => {
    const world = playing();
    run(world, 30, { left: 1, right: 1, up: 1 });
    expect(world.state.run.player.x).toBe(0);
    expect(world.state.run.player.y).toBeCloseTo(-MOVE_SPEED / 2, 6);
  });

  it("reads Bellows into the speed", () => {
    const world = playing();
    world.state.run.passives.push({ id: "bellows", level: 5 });
    run(world, 60, { right: 1 });
    expect(world.state.run.player.x).toBeCloseTo(MOVE_SPEED * 1.5, 6);
  });
});

describe("facing", () => {
  it("follows the horizontal component and holds otherwise", () => {
    const world = playing();
    expect(world.state.run.player.facing).toBe("right");
    run(world, 1, { left: 1 });
    expect(world.state.run.player.facing).toBe("left");
    run(world, 1, { up: 1 });
    expect(world.state.run.player.facing).toBe("left");
    run(world, 1);
    expect(world.state.run.player.facing).toBe("left");
    run(world, 1, { right: 1, down: 1 });
    expect(world.state.run.player.facing).toBe("right");
  });
});

describe("health", () => {
  it("recovers by Tinder per second and caps at maxHp", () => {
    const world = playing();
    world.state.run.passives.push({ id: "tinder", level: 2 });
    world.state.run.player.hp = 50;
    run(world, 60);
    expect(world.state.run.player.hp).toBeCloseTo(51, 6);
    world.state.run.player.hp = 99.99;
    run(world, 60);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP);
  });

  it("caps at the new maxHp once a passive is gone", () => {
    const world = playing();
    world.state.run.passives.push({ id: "tallow", level: 2 });
    world.state.run.player.hp = 130;
    world.state.run.passives.length = 0;
    run(world, 1);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP);
  });
});

describe("contact", () => {
  it("hits on the first overlapping tick and every CONTACT_COOLDOWN after", () => {
    const world = playing();
    world.state.switches.enemyMotion = false;
    spawnEnemy(world.state.run, "moth", 5, 0);
    const hits: number[] = [];
    for (let i = 1; i <= 90; i += 1) {
      const before = world.state.run.player.hp;
      run(world, 1);
      if (world.state.run.player.hp < before) hits.push(i);
    }
    expect(hits).toEqual([1, 31, 61]);
    expect(world.state.run.player.hp).toBe(
      BASE_MAX_HP - 3 * ENEMIES.moth.damage,
    );
    expect(world.state.run.enemies[0].contactCooldown).toBeCloseTo(
      CONTACT_COOLDOWN - 29 * TICK_DT,
      9,
    );
  });

  it("reduces by armor down to the floor", () => {
    const world = playing();
    world.state.switches.enemyMotion = false;
    world.state.run.passives.push({ id: "brass", level: 3 });
    spawnEnemy(world.state.run, "gnat", 0, 0);
    run(world, 1);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP - 1);
    spawnEnemy(world.state.run, "hound", 0, 0);
    run(world, 1);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP - 1 - 17);
  });

  it("plays hurt once per tick and lands nothing while enemyContact is off", () => {
    const world = playing();
    world.state.switches.enemyMotion = false;
    spawnEnemy(world.state.run, "moth", 0, 0);
    spawnEnemy(world.state.run, "bat", 0, 0);
    run(world, 1);
    expect([...world.cues].filter((cue) => cue === "hurt")).toHaveLength(1);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP - 10);
    world.state.switches.enemyContact = false;
    run(world, 60);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP - 10);
    expect(world.state.run.enemies[0].contactCooldown).toBe(0);
  });

  it("is not made by an enemy just out of reach", () => {
    const world = playing();
    world.state.switches.enemyMotion = false;
    spawnEnemy(world.state.run, "moth", ENEMIES.moth.radius + 12, 0);
    run(world, 5);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP);
  });
});

describe("the endings", () => {
  it("falls at the end of the tick hp reaches zero, sounding fallen", () => {
    const world = playing();
    world.state.run.player.hp = 0;
    run(world, 1);
    expect(world.state.screen).toBe("fallen");
    expect(world.state.run.tick).toBe(1);
    expect(world.cues.has("fallen")).toBe(true);
  });

  it("reaches dawn on tick DAWN_TICK, ahead of falling", () => {
    const world = playing();
    world.state.run.tick = DAWN_TICK - 1;
    world.state.run.player.hp = -5;
    run(world, 1);
    expect(world.state.screen).toBe("dawn");
    expect(world.cues.has("dawn")).toBe(true);
    expect(world.cues.has("fallen")).toBe(false);
  });

  it("opens no overlay on the ending tick and keeps what was queued", () => {
    const world = playing();
    world.state.run.pendingLevelUps = 1;
    world.state.run.player.hp = 0;
    run(world, 1);
    expect(world.state.screen).toBe("fallen");
    expect(world.state.run.pendingLevelUps).toBe(1);
  });
});
