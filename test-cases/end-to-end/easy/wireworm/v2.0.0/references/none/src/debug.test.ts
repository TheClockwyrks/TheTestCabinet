// Wireworm — the debugging and automation surface (specs/instrumentation.md).
//
// Every operation is checked the way the specification says it is verifiable:
// set a value, read it back off `snapshot`. What each pose then LETS the game do
// is checked in the rules suites; what is checked here is that the surface is
// really wired to the running game, that a reset restores the title values, and
// that the gates gate one faculty each.

import { beforeAll, describe, expect, test } from "vitest";
import {
  ARC_LIFE,
  BONUS_LIFE_EVERY,
  CHARGE_MAX,
  DEFAULT_SEED,
  START_LIVES,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  tileCX,
  tileCY,
  wormLength,
  wormStepInterval,
} from "./constants";
import { WIREWORM_HANDLE, createDebugApi, installDebugApi } from "./debug";
import { createInitialState } from "./game";
import type { Sprites } from "./assets";
import {
  createRig,
  loadTestSprites,
  startPlaying,
  type Rig,
} from "./harness.test-support";

let sprites: Sprites;

beforeAll(async () => {
  sprites = await loadTestSprites();
});

/** A rig on a live, empty board with every world gate off. */
function posed(level = 1): Rig {
  const rig = createRig(sprites);
  startPlaying(rig, level);
  return rig;
}

describe("the surface", () => {
  test("it reports the version the specification fixes", () => {
    const rig = posed();
    expect(rig.debug.version).toBe(WIREWORM_DEBUG_VERSION);
    expect(rig.debug.snapshot().version).toBe(WIREWORM_DEBUG_VERSION);
    rig.dispose();
  });

  test("it carries every operation the specification names", () => {
    const rig = posed();
    const operations = [
      "setAutoStep",
      "advance",
      "reset",
      "snapshot",
      "setScreen",
      "setPhase",
      "setPhaseTimer",
      "setMenuIndex",
      "setScore",
      "setLives",
      "setLevel",
      "setReachedLevel",
      "setFoeSpawning",
      "setWormEntry",
      "setCursorContact",
      "setCursor",
      "setCursorInvulnerable",
      "setFireCooldown",
      "addBolt",
      "removeBolt",
      "clearBolts",
      "setNode",
      "clearNode",
      "clearNodes",
      "addWorm",
      "appendSegment",
      "setWormHeading",
      "setWormDescent",
      "setWormDiving",
      "setWormStepping",
      "setWormBody",
      "removeWorm",
      "clearWorms",
      "addFoe",
      "setFoeVelocity",
      "setFoeHit",
      "setFoeMind",
      "setFoeTravel",
      "removeFoe",
      "clearFoes",
    ] as const;
    for (const operation of operations) {
      expect(typeof rig.debug[operation]).toBe("function");
    }
    rig.dispose();
  });

  test("it is live: a posed node reads back and a posed worm steps", () => {
    const rig = posed();
    rig.debug.setNode(9, 9, 2);
    rig.debug.addWorm(4, 9);
    expect(rig.debug.snapshot().nodes).toEqual([{ c: 9, r: 9, charge: 2 }]);
    rig.runtime.advance(wormStepInterval(1), 1);
    expect(rig.debug.snapshot().worms[0].segments[0]).toEqual({ c: 5, r: 9 });
    rig.dispose();
  });

  test("it installs itself on the page under the handle the case declares", () => {
    const state = createInitialState();
    const globalTarget = globalThis as unknown as Record<string, unknown>;
    globalTarget.window = globalTarget;
    const remove = installDebugApi(state, {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    expect((globalTarget[WIREWORM_HANDLE] as { version: number }).version).toBe(
      WIREWORM_DEBUG_VERSION,
    );
    remove();
    expect(globalTarget[WIREWORM_HANDLE]).toBeUndefined();
    delete globalTarget.window;
  });
});

describe("every pose reads back", () => {
  test("the screen and the run", () => {
    const rig = posed();
    rig.debug.setScreen("howto");
    rig.debug.setPhase("respawn");
    rig.debug.setPhaseTimer(0.7);
    rig.debug.setMenuIndex(1);
    rig.debug.setScore(4321);
    rig.debug.setLives(5);
    rig.debug.setLevel(9);
    rig.debug.setReachedLevel(11);
    const shot = rig.debug.snapshot();
    expect(shot.screen).toBe("howto");
    expect(shot.phase).toBe("respawn");
    expect(shot.phaseTimer).toBeCloseTo(0.7, 10);
    expect(shot.menuIndex).toBe(1);
    expect(shot.score).toBe(4321);
    expect(shot.lives).toBe(5);
    expect(shot.level).toBe(9);
    expect(shot.reachedLevel).toBe(11);
    // Both derived figures follow the level.
    expect(shot.wormStepInterval).toBeCloseTo(wormStepInterval(9), 10);
    expect(shot.wormLength).toBe(wormLength(9));
    rig.dispose();
  });

  test("the level is held inside the run's own range", () => {
    const rig = posed();
    rig.debug.setLevel(0);
    expect(rig.debug.snapshot().level).toBe(1);
    rig.debug.setLevel(99);
    expect(rig.debug.snapshot().level).toBe(TOTAL_LEVELS);
    rig.dispose();
  });

  test("posing the score grants no bonus life", () => {
    const rig = posed();
    rig.debug.setLives(3);
    rig.debug.setScore(BONUS_LIFE_EVERY * 2 + 500);
    expect(rig.debug.snapshot().lives).toBe(3);
    rig.dispose();
  });

  test("the three world gates", () => {
    const rig = posed();
    for (const on of [true, false, true]) {
      rig.debug.setFoeSpawning(on);
      rig.debug.setWormEntry(on);
      rig.debug.setCursorContact(on);
      const shot = rig.debug.snapshot();
      expect(shot.foeSpawning).toBe(on);
      expect(shot.wormEntry).toBe(on);
      expect(shot.cursor.contact).toBe(on);
    }
    rig.dispose();
  });

  test("the cursor, its invulnerability, and the fire cooldown", () => {
    const rig = posed();
    rig.debug.setCursor(tileCX(30), 672);
    rig.debug.setCursorInvulnerable(1.25);
    rig.debug.setFireCooldown(0.09);
    const shot = rig.debug.snapshot();
    expect(shot.cursor.x).toBe(tileCX(30));
    expect(shot.cursor.y).toBe(672);
    expect(shot.cursor.invulnerable).toBeCloseTo(1.25, 10);
    expect(shot.fireCooldown).toBeCloseTo(0.09, 10);
    // The band's real clamp applies to a pose as it does to a played move.
    rig.debug.setCursor(-500, 0);
    expect(rig.debug.snapshot().cursor).toMatchObject({ x: 16, y: 672 });
    rig.dispose();
  });

  test("a node's charge, and the two ways a tile is emptied", () => {
    const rig = posed();
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      rig.debug.setNode(5, 5, charge);
      expect(rig.debug.snapshot().nodes[0].charge).toBe(charge);
    }
    rig.debug.setNode(6, 5, 1);
    rig.debug.clearNode(5, 5);
    expect(rig.debug.snapshot().nodes).toEqual([{ c: 6, r: 5, charge: 1 }]);
    rig.debug.clearNodes();
    expect(rig.debug.snapshot().nodes).toEqual([]);
    rig.dispose();
  });

  test("a worm's headings, its diving flag, and its two faculties", () => {
    const rig = posed();
    rig.debug.addWorm(5, 5);
    const id = rig.debug.snapshot().worms[0].id;
    rig.debug.appendSegment(id, 4, 5);
    rig.debug.setWormHeading(id, -1);
    rig.debug.setWormDescent(id, -1);
    rig.debug.setWormDiving(id, true);
    rig.debug.setWormStepping(id, false);
    rig.debug.setWormBody(id, false);
    expect(rig.debug.snapshot().worms[0]).toEqual({
      id,
      segments: [
        { c: 5, r: 5 },
        { c: 4, r: 5 },
      ],
      dh: -1,
      dv: -1,
      diving: true,
      stepping: false,
      body: false,
    });
    rig.dispose();
  });

  test("a foe's velocity, its hit flag, and its two faculties", () => {
    const rig = posed();
    rig.debug.addFoe("dropper", tileCX(9), tileCY(4));
    const id = rig.debug.snapshot().foes[0].id;
    rig.debug.setFoeVelocity(id, 111, 222);
    rig.debug.setFoeHit(id, true);
    rig.debug.setFoeMind(id, false);
    rig.debug.setFoeTravel(id, false);
    expect(rig.debug.snapshot().foes[0]).toEqual({
      id,
      kind: "dropper",
      x: tileCX(9),
      y: tileCY(4),
      vx: 111,
      vy: 222,
      hit: true,
      mind: false,
      travel: false,
    });
    rig.dispose();
  });

  test("a bolt's position", () => {
    const rig = posed();
    rig.debug.addBolt(300, 500);
    const bolt = rig.debug.snapshot().bolts[0];
    expect({ x: bolt.x, y: bolt.y }).toEqual({ x: 300, y: 500 });
    rig.dispose();
  });

  test("a pose of an entity that is not there changes nothing", () => {
    const rig = posed();
    rig.debug.appendSegment(999, 1, 1);
    rig.debug.setWormHeading(999, -1);
    rig.debug.setWormDescent(999, -1);
    rig.debug.setWormDiving(999, true);
    rig.debug.setWormStepping(999, false);
    rig.debug.setWormBody(999, false);
    rig.debug.removeWorm(999);
    rig.debug.setFoeVelocity(999, 1, 1);
    rig.debug.setFoeHit(999, true);
    rig.debug.setFoeMind(999, false);
    rig.debug.setFoeTravel(999, false);
    rig.debug.removeFoe(999);
    rig.debug.removeBolt(999);
    const shot = rig.debug.snapshot();
    expect(shot.worms).toEqual([]);
    expect(shot.foes).toEqual([]);
    expect(shot.bolts).toEqual([]);
    rig.dispose();
  });
});

describe("identity", () => {
  test("each entity takes a distinct id and appears last in its roster", () => {
    const rig = posed();
    const ids = new Set<number>();
    for (let i = 0; i < 3; i += 1) {
      rig.debug.addWorm(i, 5);
      const worms = rig.debug.snapshot().worms;
      expect(worms[worms.length - 1].segments[0]).toEqual({ c: i, r: 5 });
      ids.add(worms[worms.length - 1].id);

      rig.debug.addFoe("glitch", tileCX(i), tileCY(9));
      const foes = rig.debug.snapshot().foes;
      ids.add(foes[foes.length - 1].id);

      rig.debug.addBolt(tileCX(i), 700);
      const bolts = rig.debug.snapshot().bolts;
      ids.add(bolts[bolts.length - 1].id);
    }
    expect(ids.size).toBe(9);
    rig.dispose();
  });

  test("an id is kept across the steps the entity takes", () => {
    const rig = posed();
    rig.debug.addWorm(4, 9);
    const id = rig.debug.snapshot().worms[0].id;
    rig.runtime.advance(1, 60);
    expect(rig.debug.snapshot().worms[0].id).toBe(id);
    rig.dispose();
  });
});

describe("clearing one roster", () => {
  /** A board carrying one of everything. */
  function crowded(rig: Rig): void {
    rig.debug.setNode(5, 5, 2);
    rig.debug.addWorm(6, 6);
    rig.debug.addFoe("glitch", tileCX(7), tileCY(7));
    rig.debug.addBolt(tileCX(8), 700);
  }

  test("clearNodes empties the field alone", () => {
    const rig = posed();
    crowded(rig);
    rig.debug.clearNodes();
    const shot = rig.debug.snapshot();
    expect(shot.nodes).toEqual([]);
    expect(shot.worms).toHaveLength(1);
    expect(shot.foes).toHaveLength(1);
    expect(shot.bolts).toHaveLength(1);
    rig.dispose();
  });

  test("clearWorms empties the worms alone", () => {
    const rig = posed();
    crowded(rig);
    rig.debug.clearWorms();
    const shot = rig.debug.snapshot();
    expect(shot.worms).toEqual([]);
    expect(shot.nodes).toHaveLength(1);
    expect(shot.foes).toHaveLength(1);
    expect(shot.bolts).toHaveLength(1);
    rig.dispose();
  });

  test("clearFoes empties the foes alone", () => {
    const rig = posed();
    crowded(rig);
    rig.debug.clearFoes();
    const shot = rig.debug.snapshot();
    expect(shot.foes).toEqual([]);
    expect(shot.nodes).toHaveLength(1);
    expect(shot.worms).toHaveLength(1);
    expect(shot.bolts).toHaveLength(1);
    rig.dispose();
  });

  test("clearBolts removes the bolts in flight alone", () => {
    const rig = posed();
    crowded(rig);
    rig.debug.clearBolts();
    const shot = rig.debug.snapshot();
    expect(shot.bolts).toEqual([]);
    expect(shot.nodes).toHaveLength(1);
    expect(shot.worms).toHaveLength(1);
    expect(shot.foes).toHaveLength(1);
    rig.dispose();
  });

  test("one entity is removed by its id", () => {
    const rig = posed();
    rig.debug.addWorm(1, 1);
    rig.debug.addWorm(2, 2);
    rig.debug.addBolt(100, 700);
    rig.debug.addBolt(200, 700);
    rig.debug.addFoe("glitch", 300, 300);
    rig.debug.addFoe("glitch", 400, 300);
    const shot = rig.debug.snapshot();
    rig.debug.removeWorm(shot.worms[0].id);
    rig.debug.removeBolt(shot.bolts[0].id);
    rig.debug.removeFoe(shot.foes[0].id);
    const after = rig.debug.snapshot();
    expect(after.worms.map((worm) => worm.id)).toEqual([shot.worms[1].id]);
    expect(after.bolts.map((bolt) => bolt.id)).toEqual([shot.bolts[1].id]);
    expect(after.foes.map((foe) => foe.id)).toEqual([shot.foes[1].id]);
    rig.dispose();
  });
});

describe("reset", () => {
  test("it restores every declared field to its title value", () => {
    const rig = posed(6);
    rig.debug.setScore(5000);
    rig.debug.setLives(1);
    rig.debug.setReachedLevel(6);
    rig.debug.setNode(4, 4, 3);
    rig.debug.addWorm(5, 5);
    rig.debug.addFoe("glitch", 200, 200);
    rig.debug.addBolt(200, 700);
    rig.debug.setCursor(20, 704);
    rig.debug.setCursorInvulnerable(1);
    rig.debug.setFireCooldown(0.1);
    rig.debug.setPhaseTimer(0.5);
    rig.debug.setMenuIndex(1);

    rig.debug.reset();
    const shot = rig.debug.snapshot();
    expect(shot).toMatchObject({
      screen: "title",
      phase: "banner",
      phaseTimer: 0,
      menuIndex: 0,
      score: 0,
      lives: START_LIVES,
      level: 1,
      reachedLevel: 1,
      foeSpawning: true,
      wormEntry: true,
      fireCooldown: 0,
      simTime: 0,
      nodes: [],
      worms: [],
      foes: [],
      bolts: [],
      arcs: [],
    });
    expect(shot.cursor).toEqual({
      x: 640,
      y: 688,
      invulnerable: 0,
      contact: true,
    });
    rig.dispose();
  });

  test("it seeds the game's randomness", () => {
    const rig = posed();
    const scatter = (seed: number): string => {
      rig.debug.reset({ seed });
      rig.debug.setScreen("title");
      rig.debug.setMenuIndex(0);
      rig.press("Enter");
      rig.runtime.advance(0.02, 1);
      return JSON.stringify(rig.debug.snapshot().nodes);
    };
    const first = scatter(7);
    expect(scatter(7)).toBe(first);
    expect(scatter(8)).not.toBe(first);
    rig.dispose();
  });

  test("its default seed is the one the specification names", () => {
    const rig = posed();
    rig.debug.reset({ seed: DEFAULT_SEED });
    const state = rig.state.rngState;
    rig.debug.reset();
    expect(rig.state.rngState).toBe(state);
    rig.dispose();
  });

  test("it leaves the mute preference exactly as it stands", () => {
    const rig = posed();
    rig.press("KeyM");
    rig.runtime.advance(0.02, 1);
    expect(rig.debug.snapshot().muted).toBe(true);
    rig.debug.reset();
    rig.runtime.advance(0.02, 1);
    expect(rig.debug.snapshot().muted).toBe(true);
    rig.dispose();
  });

  test("it does not touch the clock", () => {
    const rig = posed();
    rig.runtime.setAutoStep(false);
    rig.debug.reset();
    expect(rig.runtime.autoStep()).toBe(false);
    rig.dispose();
  });
});

describe("the gates", () => {
  test("stepping off holds a worm still while another steps on", () => {
    const rig = posed();
    rig.debug.addWorm(4, 9);
    rig.debug.addWorm(4, 12);
    const [held, running] = rig.debug.snapshot().worms.map((worm) => worm.id);
    rig.debug.setWormStepping(held, false);
    rig.runtime.advance(wormStepInterval(1) * 10, 60);
    const worms = rig.debug.snapshot().worms;
    expect(worms[0].segments[0]).toEqual({ c: 4, r: 9 });
    expect(worms[1].segments[0]).toEqual({ c: 14, r: 12 });
    expect(worms[1].id).toBe(running);
    rig.dispose();
  });

  test("body off advances the head and holds the trailing segments", () => {
    const rig = posed();
    rig.debug.addWorm(4, 9);
    const id = rig.debug.snapshot().worms[0].id;
    rig.debug.appendSegment(id, 3, 9);
    rig.debug.appendSegment(id, 2, 9);
    rig.debug.setWormBody(id, false);
    rig.runtime.advance(wormStepInterval(1) * 3, 30);
    expect(rig.debug.snapshot().worms[0].segments).toEqual([
      { c: 7, r: 9 },
      { c: 3, r: 9 },
      { c: 2, r: 9 },
    ]);
    rig.dispose();
  });

  test("mind off leaves the field untouched while a foe travels", () => {
    const rig = posed();
    for (let c = 4; c < 20; c += 1) rig.debug.setNode(c, 9, 0);
    rig.debug.addFoe("glitch", tileCX(4), tileCY(9));
    rig.debug.setFoeMind(rig.debug.snapshot().foes[0].id, false);
    rig.runtime.advance(1, 60);
    expect(rig.debug.snapshot().nodes).toHaveLength(16);
    rig.dispose();
  });

  test("travel off holds a foe on the tile it was posed on", () => {
    const rig = posed();
    rig.debug.addFoe("glitch", tileCX(12), tileCY(9));
    rig.debug.setFoeTravel(rig.debug.snapshot().foes[0].id, false);
    rig.runtime.advance(1, 60);
    const foe = rig.debug.snapshot().foes[0];
    expect([foe.x, foe.y]).toEqual([tileCX(12), tileCY(9)]);
    rig.dispose();
  });

  test("foe spawning off keeps the level's foes away, and on brings one", () => {
    const rig = posed(5);
    rig.runtime.advance(60, 600);
    expect(rig.debug.snapshot().foes).toEqual([]);
    rig.debug.setFoeSpawning(true);
    rig.runtime.advance(60, 600);
    expect(rig.debug.snapshot().foes.length).toBeGreaterThan(0);
    rig.dispose();
  });

  test("worm entry off keeps the level's worm away, and on brings one", () => {
    const rig = posed();
    rig.debug.setPhase("banner");
    rig.debug.setPhaseTimer(0.2);
    rig.runtime.advance(10, 300);
    expect(rig.debug.snapshot().worms).toEqual([]);

    rig.debug.setWormEntry(true);
    rig.debug.setPhase("banner");
    rig.debug.setPhaseTimer(0.2);
    rig.runtime.advance(1, 30);
    expect(rig.debug.snapshot().worms).toHaveLength(1);
    rig.dispose();
  });

  test("contact off costs no life, and on costs one", () => {
    const rig = posed();
    rig.debug.setCursor(tileCX(20), 688);
    rig.debug.addWorm(20, 18);
    rig.debug.setWormStepping(rig.debug.snapshot().worms[0].id, false);
    rig.runtime.advance(0.5, 30);
    expect(rig.debug.snapshot().lives).toBe(START_LIVES);
    expect(rig.debug.snapshot().phase).toBe("active");

    rig.debug.setCursorContact(true);
    rig.runtime.advance(0.02, 1);
    expect(rig.debug.snapshot().lives).toBe(START_LIVES - 1);
    rig.dispose();
  });
});

describe("the snapshot", () => {
  test("it reports the whole documented shape", () => {
    const rig = posed(3);
    for (let charge = 0; charge <= CHARGE_MAX; charge += 1) {
      rig.debug.setNode(4 + charge, 6, charge);
    }
    rig.debug.addWorm(10, 10);
    rig.debug.addWorm(20, 10);
    rig.debug.addFoe("glitch", 200, 300);
    rig.debug.addFoe("dropper", 300, 300);
    rig.debug.addFoe("corruptor", 400, 200);
    rig.debug.addBolt(500, 700);
    // A live discharge, so `arcs` is not empty.
    rig.debug.setNode(30, 12, CHARGE_MAX);
    rig.debug.setNode(32, 12, 1);
    rig.debug.addBolt(tileCX(30), tileCY(19));
    rig.runtime.advance(0.3, 18);

    const shot = rig.debug.snapshot();
    expect(typeof shot.version).toBe("number");
    expect(typeof shot.screen).toBe("string");
    expect(typeof shot.phase).toBe("string");
    expect(typeof shot.phaseTimer).toBe("number");
    expect(typeof shot.menuIndex).toBe("number");
    expect(typeof shot.score).toBe("number");
    expect(typeof shot.lives).toBe("number");
    expect(typeof shot.level).toBe("number");
    expect(typeof shot.reachedLevel).toBe("number");
    expect(typeof shot.muted).toBe("boolean");
    expect(typeof shot.foeSpawning).toBe("boolean");
    expect(typeof shot.wormEntry).toBe("boolean");
    expect(typeof shot.wormStepInterval).toBe("number");
    expect(typeof shot.wormLength).toBe("number");
    expect(typeof shot.fireCooldown).toBe("number");
    expect(typeof shot.simTime).toBe("number");
    expect(Object.keys(shot.cursor).sort()).toEqual([
      "contact",
      "invulnerable",
      "x",
      "y",
    ]);
    expect(shot.nodes.length).toBeGreaterThan(0);
    for (const node of shot.nodes) {
      expect(Object.keys(node).sort()).toEqual(["c", "charge", "r"]);
    }
    for (const worm of shot.worms) {
      expect(Object.keys(worm).sort()).toEqual([
        "body",
        "dh",
        "diving",
        "dv",
        "id",
        "segments",
        "stepping",
      ]);
    }
    for (const foe of shot.foes) {
      expect(Object.keys(foe).sort()).toEqual([
        "hit",
        "id",
        "kind",
        "mind",
        "travel",
        "vx",
        "vy",
        "x",
        "y",
      ]);
    }
    for (const bolt of shot.bolts) {
      expect(Object.keys(bolt).sort()).toEqual(["id", "x", "y"]);
    }
    expect(shot.arcs.length).toBeGreaterThan(0);
    for (const arc of shot.arcs) {
      // The tiles the link joined, and nothing about how it is drawn.
      expect(Object.keys(arc).sort()).toEqual(["from", "to"]);
      expect(Object.keys(arc.from).sort()).toEqual(["c", "r"]);
    }
    rig.dispose();
  });

  test("nodes are reported ascending by row and then by column", () => {
    const rig = posed();
    rig.debug.setNode(9, 4, 1);
    rig.debug.setNode(2, 4, 2);
    rig.debug.setNode(5, 1, 3);
    expect(rig.debug.snapshot().nodes).toEqual([
      { c: 5, r: 1, charge: 3 },
      { c: 2, r: 4, charge: 2 },
      { c: 9, r: 4, charge: 1 },
    ]);
    rig.dispose();
  });

  test("arcs are reported for their life and gone afterwards", () => {
    const rig = posed();
    rig.debug.setNode(30, 12, CHARGE_MAX);
    rig.debug.setNode(32, 12, 1);
    rig.debug.addBolt(tileCX(30), tileCY(19));
    rig.runtime.advance(0.3, 18);
    expect(rig.debug.snapshot().arcs).toHaveLength(1);
    rig.runtime.advance(ARC_LIFE, 12);
    expect(rig.debug.snapshot().arcs).toEqual([]);
    rig.dispose();
  });

  test("a foe reports the velocity its position is changing by", () => {
    const rig = posed();
    rig.debug.addFoe("glitch", tileCX(20), tileCY(9));
    const id = rig.debug.snapshot().foes[0].id;
    const before = rig.debug.snapshot().foes[0];
    rig.runtime.advance(0.05, 3);
    const after = rig.debug.snapshot().foes[0];
    expect(Math.sign(after.x - before.x)).toBe(Math.sign(before.vx));
    rig.debug.setFoeVelocity(id, -200, 0);
    const posedFoe = rig.debug.snapshot().foes[0];
    rig.debug.setFoeMind(id, false);
    rig.runtime.advance(0.05, 3);
    expect(rig.debug.snapshot().foes[0].x).toBeLessThan(posedFoe.x);
    rig.dispose();
  });

  test("simulation time accumulates whatever the screen", () => {
    const rig = posed();
    rig.debug.setScreen("title");
    rig.runtime.advance(1, 60);
    expect(rig.debug.snapshot().simTime).toBeCloseTo(1, 6);
    rig.dispose();
  });
});

describe("the clock", () => {
  test("one second of game time is one second however it is divided", () => {
    const results = [1, 6, 60].map((frames) => {
      const rig = posed();
      rig.debug.addWorm(4, 9);
      rig.runtime.advance(1, frames);
      const shot = rig.debug.snapshot();
      rig.dispose();
      return {
        simTime: Number(shot.simTime.toFixed(6)),
        head: shot.worms[0].segments[0],
      };
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  test("advance refuses a count it cannot run", () => {
    const rig = posed();
    expect(() => rig.debug.advance(-1)).toThrow(RangeError);
    expect(() => rig.debug.advance(1, 0)).toThrow(RangeError);
    expect(() => rig.debug.advance(1, 1.5)).toThrow(RangeError);
    rig.dispose();
  });

  test("setAutoStep takes the game off the wall clock and gives it back", () => {
    const rig = posed();
    rig.debug.setAutoStep(true);
    expect(rig.runtime.autoStep()).toBe(true);
    rig.debug.setAutoStep(false);
    expect(rig.runtime.autoStep()).toBe(false);
    const before = rig.debug.snapshot();
    rig.debug.setAutoStep(false);
    expect(rig.debug.snapshot()).toEqual(before);
    rig.dispose();
  });

  test("the surface is inert until something calls it", () => {
    const rig = posed();
    const before = JSON.stringify(rig.debug.snapshot());
    const clock = createDebugApi(rig.state, {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    expect(JSON.stringify(clock.snapshot())).toBe(before);
    rig.dispose();
  });
});
