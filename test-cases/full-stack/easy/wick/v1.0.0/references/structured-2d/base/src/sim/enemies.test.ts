import { describe, expect, it } from "vitest";
import {
  CONTACT_COOLDOWN,
  ENEMIES,
  ENEMY_IDS,
  GEM_TIERS,
  HP_SCALE_PER_MINUTE,
  TICK_DT,
  TICK_HZ,
  WISP_AMPLITUDE,
  WISP_PERIOD,
  type CueName,
} from "../constants";
import { Rng } from "../rng";
import {
  NOTHING_HELD,
  freshRun,
  initialState,
  type Held,
  type WickState,
} from "../state";
import { hpMul, spawnEnemy, weaveOffset } from "./enemies";
import { tick } from "./tick";

/** A run with the director, the weapons, and the contact held still. */
function playing(): { state: WickState; rng: Rng; cues: Set<CueName> } {
  const state = initialState(1);
  state.run = freshRun();
  state.screen = "playing";
  state.spawning = false;
  state.events = false;
  state.despawning = false;
  state.weaponFire = false;
  state.enemyContact = false;
  return { state, rng: new Rng(() => state), cues: new Set() };
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

describe("the roster", () => {
  it("lists thirteen types: ten commons, two elites, and the Dark", () => {
    expect(ENEMY_IDS).toHaveLength(13);
    const ranks = ENEMY_IDS.map((id) => ENEMIES[id].rank);
    expect(ranks.filter((rank) => rank === "common")).toHaveLength(10);
    expect(ranks.filter((rank) => rank === "elite")).toEqual([
      "elite",
      "elite",
    ]);
    expect(ENEMIES.dark.rank).toBe("dark");
    for (const id of ENEMY_IDS) {
      const { rank, drop } = ENEMIES[id];
      if (rank === "common") expect(GEM_TIERS).toContain(drop);
      else expect(drop).toBe(rank === "elite" ? "chest" : null);
    }
    expect(ENEMIES.gnat.behavior).toBe("drift");
    expect(ENEMIES.wisp.behavior).toBe("weave");
    expect(
      ENEMY_IDS.filter((id) => ENEMIES[id].behavior === "chase"),
    ).toHaveLength(11);
  });
});

describe("spawning", () => {
  it("takes ascending ids, full health, age 0, and a heading toward the lamplighter", () => {
    const world = playing();
    const { run: state } = world.state;
    const first = spawnEnemy(state, "moth", 300, 400);
    const second = spawnEnemy(state, "hound", -100, 0);
    expect([first.id, second.id]).toEqual([0, 1]);
    expect(state.nextId).toBe(2);
    expect(first.heading.x).toBeCloseTo(-0.6, 12);
    expect(first.heading.y).toBeCloseTo(-0.8, 12);
    expect(second.heading).toEqual({ x: 1, y: 0 });
    expect(first).toMatchObject({
      hp: 5,
      maxHp: 5,
      age: 0,
      contactCooldown: 0,
    });
    expect(second).toMatchObject({ hp: 120, maxHp: 120 });
  });

  it("takes the facing direction when it spawns on the lamplighter", () => {
    const world = playing();
    const { run: state } = world.state;
    expect(spawnEnemy(state, "rat", 0, 0).heading).toEqual({ x: 1, y: 0 });
    state.player.facing = "left";
    expect(spawnEnemy(state, "rat", 0, 0).heading).toEqual({ x: -1, y: 0 });
  });

  it("scales a common's health by the minute of the clock, and never an elite's", () => {
    expect(hpMul(0)).toBe(1);
    expect(hpMul(59.99)).toBe(1);
    expect(hpMul(60)).toBe(1 + HP_SCALE_PER_MINUTE);
    expect(hpMul(599)).toBeCloseTo(1 + 9 * HP_SCALE_PER_MINUTE, 12);
    const world = playing();
    const { run: state } = world.state;
    state.tick = 60 * TICK_HZ - 1;
    expect(spawnEnemy(state, "moth", 500, 0).maxHp).toBe(5);
    state.tick = 3 * 60 * TICK_HZ;
    const moth = spawnEnemy(state, "moth", 500, 0);
    expect(moth.maxHp).toBeCloseTo(5 * 1.45, 12);
    expect(moth.hp).toBe(moth.maxHp);
    expect(spawnEnemy(state, "gnat", 500, 0).maxHp).toBeCloseTo(2 * 1.45, 12);
    expect(spawnEnemy(state, "mothwing", 500, 0).maxHp).toBe(600);
    expect(spawnEnemy(state, "owl", 500, 0).maxHp).toBe(2000);
    expect(spawnEnemy(state, "dark", 500, 0).maxHp).toBe(10000);
    state.tick = 9 * 60 * TICK_HZ;
    run(world, 1);
    expect(moth.maxHp).toBeCloseTo(5 * 1.45, 12);
  });

  it("sits at its spawn point for the tick it spawns on", () => {
    const world = playing();
    const { run: state } = world.state;
    const moth = spawnEnemy(state, "moth", 300, 0);
    run(world, 1);
    expect(moth.age).toBeCloseTo(TICK_DT, 12);
    expect(moth.x).toBeCloseTo(300 - ENEMIES.moth.speed * TICK_DT, 12);
  });
});

describe("chase", () => {
  it("recomputes its heading every tick and steps speed × TICK_DT along it", () => {
    const world = playing();
    const { run: state } = world.state;
    const bat = spawnEnemy(state, "bat", 300, 400);
    run(world, 1);
    const step = ENEMIES.bat.speed * TICK_DT;
    expect(bat.x).toBeCloseTo(300 - 0.6 * step, 12);
    expect(bat.y).toBeCloseTo(400 - 0.8 * step, 12);
    state.player.x = bat.x;
    state.player.y = 0;
    run(world, 1);
    expect(bat.heading.x).toBeCloseTo(0, 12);
    expect(bat.heading.y).toBeCloseTo(-1, 12);
    expect(bat.x).toBeCloseTo(300 - 0.6 * step, 12);
    expect(bat.y).toBeCloseTo(400 - 0.8 * step - step, 12);
  });

  it("turns with a moving lamplighter and holds where the centers coincide", () => {
    const world = playing();
    const { run: state } = world.state;
    const moth = spawnEnemy(state, "moth", 0, -600);
    run(world, 60, { right: 1 });
    expect(moth.heading.x).toBeGreaterThan(0);
    expect(moth.heading.y).toBeGreaterThan(0);
    const still = spawnEnemy(state, "shade", state.player.x, state.player.y);
    const heading = { ...still.heading };
    run(world, 5);
    expect([still.x, still.y]).toEqual([state.player.x, state.player.y]);
    expect(still.heading).toEqual(heading);
    expect(still.age).toBeCloseTo(5 * TICK_DT, 12);
  });
});

describe("drift", () => {
  it("keeps its spawn heading, crosses the lamplighter, and flies on", () => {
    const world = playing();
    const { run: state } = world.state;
    const gnat = spawnEnemy(state, "gnat", 400, 0);
    expect(gnat.heading).toEqual({ x: -1, y: 0 });
    run(world, 150);
    expect(gnat.x).toBeCloseTo(0, 9);
    state.player.y = 500;
    run(world, 60);
    expect(gnat.x).toBeCloseTo(-ENEMIES.gnat.speed, 9);
    expect(gnat.y).toBe(0);
    expect(gnat.heading).toEqual({ x: -1, y: 0 });
  });

  it("follows a posed heading", () => {
    const world = playing();
    const { run: state } = world.state;
    const gnat = spawnEnemy(state, "gnat", 0, 0, { x: 0, y: 1 });
    run(world, 30);
    expect(gnat.x).toBe(0);
    expect(gnat.y).toBeCloseTo(ENEMIES.gnat.speed * 0.5, 9);
  });
});

describe("weave", () => {
  it("swings WISP_AMPLITUDE beside an anchor that closes at its speed", () => {
    const world = playing();
    const { run: state } = world.state;
    const wisp = spawnEnemy(state, "wisp", 0, -500);
    expect(wisp.heading).toEqual({ x: 0, y: 1 });
    const quarter = Math.round((WISP_PERIOD / 4) * TICK_HZ);
    for (const ticks of [1, quarter, quarter, quarter, quarter]) {
      run(world, ticks);
      // The anchor stays on the axis, so the heading is (0, 1) and the
      // perpendicular (-1, 0): the swing shows on x alone.
      expect(wisp.x).toBeCloseTo(-weaveOffset(wisp.age), 9);
      expect(wisp.y).toBeCloseTo(-500 + ENEMIES.wisp.speed * wisp.age, 9);
    }
    expect(weaveOffset(WISP_PERIOD / 4)).toBeCloseTo(WISP_AMPLITUDE, 12);
    expect(weaveOffset(WISP_PERIOD / 2)).toBeCloseTo(0, 12);
    expect(weaveOffset((3 * WISP_PERIOD) / 4)).toBeCloseTo(-WISP_AMPLITUDE, 12);
  });

  it("recovers its anchor from the position and the age it holds", () => {
    const world = playing();
    const { run: state } = world.state;
    const wisp = spawnEnemy(state, "wisp", 0, -500);
    wisp.age = WISP_PERIOD / 4;
    wisp.x = -WISP_AMPLITUDE;
    run(world, 1);
    const expected = -weaveOffset(WISP_PERIOD / 4 + TICK_DT);
    expect(wisp.x).toBeCloseTo(expected, 9);
    expect(wisp.y).toBeCloseTo(-500 + ENEMIES.wisp.speed * TICK_DT, 9);
  });

  it("holds for the tick its anchor coincides with the lamplighter", () => {
    const world = playing();
    const { run: state } = world.state;
    const wisp = spawnEnemy(state, "wisp", 0, 0);
    run(world, 1);
    expect([wisp.x, wisp.y]).toEqual([0, 0]);
    expect(wisp.heading).toEqual({ x: 1, y: 0 });
    expect(wisp.age).toBeCloseTo(TICK_DT, 12);
    // The age counted, so the anchor recovered on the next tick stands
    // off the center by the offset it now carries, and the weaver moves.
    run(world, 1);
    expect(wisp.x).not.toBe(0);
  });
});

describe("with enemyMotion off", () => {
  it("holds every position and heading while age and the cooldown count", () => {
    const world = playing();
    world.state.enemyMotion = false;
    const { run: state } = world.state;
    const moth = spawnEnemy(state, "moth", 300, 0);
    const wisp = spawnEnemy(state, "wisp", 0, -300);
    const gnat = spawnEnemy(state, "gnat", -300, 0);
    moth.contactCooldown = CONTACT_COOLDOWN;
    run(world, 10, { right: 1 });
    expect([moth.x, moth.y, wisp.x, wisp.y, gnat.x, gnat.y]).toEqual([
      300, 0, 0, -300, -300, 0,
    ]);
    expect(moth.heading).toEqual({ x: -1, y: 0 });
    expect(moth.age).toBeCloseTo(10 * TICK_DT, 12);
    expect(moth.contactCooldown).toBeCloseTo(
      CONTACT_COOLDOWN - 10 * TICK_DT,
      12,
    );
    world.state.enemyMotion = true;
    run(world, 1);
    expect(moth.x).toBeLessThan(300);
  });
});
