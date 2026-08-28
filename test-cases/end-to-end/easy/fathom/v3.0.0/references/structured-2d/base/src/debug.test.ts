// Fathom — the debugging and automation surface, driven off the engine.
//
// Every operation is reached the one way a caller reaches it, as `engine.debug`,
// and every claim is read back through the surface's own `snapshot`. What each
// test asserts is the contract `specs/instrumentation.md` and `specs/state.md`
// fix, written out here rather than imported from the code under test.

import { describe, expect, it } from "vitest";
import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  DRIFTER_MAX,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  INK_COOLDOWN,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
  ROSTER_CAP,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  START_LIVES,
  TICK_HZ,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { createHarness, type Harness } from "./harness";
import { HALL, SPINE, at, pose } from "./scenarios";

function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

async function playing(): Promise<Harness> {
  const harness = await createHarness();
  harness.debug.startDive();
  harness.debug.beginPlay();
  harness.debug.setCreatureAI(false);
  return harness;
}

describe("the snapshot", () => {
  it("reports every field the state contract names", async () => {
    const harness = await playing();
    // Two tiles clear of the forager, so nothing eats it before it is read.
    harness.debug.spawnDrifter(19, 15);
    await harness.engine.advance(2);
    const snapshot = harness.debug.snapshot();

    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("playing");
    expect(typeof snapshot.depth).toBe("number");
    expect(typeof snapshot.score).toBe("number");
    expect(typeof snapshot.lives).toBe("number");
    expect(typeof snapshot.muted).toBe("boolean");
    expect(typeof snapshot.creatureAI).toBe("boolean");
    expect(typeof snapshot.planktonRemaining).toBe("number");
    expect(typeof snapshot.brightness).toBe("number");
    expect(typeof snapshot.visionRadius).toBe("number");
    expect(snapshot.sonar).toEqual({
      ready: expect.any(Boolean) as boolean,
      cooldown: expect.any(Number) as number,
      range: expect.any(Number) as number,
    });
    expect(snapshot.ink).toEqual({
      ready: expect.any(Boolean) as boolean,
      cooldown: expect.any(Number) as number,
    });
    expect(snapshot.grid).toEqual({
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    });
    expect(snapshot.tiles).toHaveLength(GRID_ROWS);
    expect(snapshot.tiles.every((row) => row.length === GRID_COLS)).toBe(true);
    expect(snapshot.tiles.join("")).toMatch(/^[#.gd]+$/);
    expect(snapshot.visibility).toHaveLength(GRID_ROWS);
    expect(snapshot.visibility.join("")).toMatch(/^[url]+$/);
    expect(snapshot.forager.dir).toMatch(/^(up|down|left|right)$/);
    expect(typeof snapshot.forager.moving).toBe("boolean");
    expect(snapshot.drifters).toHaveLength(1);
    expect(typeof snapshot.simTime).toBe("number");

    // A field a kind does not carry reports null rather than going missing.
    const [lanternjaw, gloamfin, flarefish] = snapshot.predators;
    expect(lanternjaw.kind).toBe("lanternjaw");
    expect(lanternjaw.hearingRange).toBeNull();
    expect(lanternjaw.hearingLock).toBeNull();
    expect(lanternjaw.flaring).toBeNull();
    expect(lanternjaw.detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * snapshot.brightness,
      6,
    );
    expect(gloamfin.detectRange).toBeNull();
    expect(gloamfin.hearingRange).toBe(GLOAMFIN_HEAR);
    expect(gloamfin.hearingLock).toBe(false);
    expect(flarefish.flareCharging).toBe(false);
    expect(flarefish.flaring).toBe(false);
    expect(flarefish.flareRadius).toBe(0);
    expect(flarefish.hearingRange).toBeNull();

    // It is JSON-serializable, and it is a pure read.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(harness.debug.snapshot()).toEqual(snapshot);
    harness.dispose();
  });

  it("lists the roster in release order, and grows it with the depth", async () => {
    const harness = await playing();
    expect(harness.debug.snapshot().predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
    ]);

    harness.debug.setDepth(2);
    expect(harness.debug.snapshot().predators.map((p) => p.kind)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
    ]);

    harness.debug.setDepth(9);
    const deep = harness.debug.snapshot();
    expect(deep.predators).toHaveLength(3 * ROSTER_CAP);
    expect(deep.sonar.range).toBe(SONAR_RANGE_MIN);
    harness.dispose();
  });

  it("derives the light radius and the detection ranges from the brightness", async () => {
    const harness = await playing();
    harness.debug.setBrightness(0);
    expect(harness.debug.snapshot().visionRadius).toBeCloseTo(VISION_MIN, 6);
    expect(harness.debug.snapshot().predators[0].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE,
      6,
    );

    harness.debug.setBrightness(1);
    const bright = harness.debug.snapshot();
    expect(bright.brightness).toBe(1);
    expect(bright.visionRadius).toBeCloseTo(VISION_MIN + VISION_GAIN, 6);
    expect(bright.predators[0].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN,
      6,
    );
    expect(bright.predators[2].detectRange).toBeCloseTo(
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN,
      6,
    );
    harness.dispose();
  });
});

describe("reset", () => {
  it("restores the title-screen values and reseeds the generator", async () => {
    const harness = await playing();
    harness.debug.setBrightness(1);
    harness.debug.setDepth(4);
    harness.debug.setSonarCooldown(1);
    harness.debug.spawnDrifter(17, 15);
    await harness.engine.advance(ticks(1));
    await harness.tap("KeyM");

    harness.debug.reset();
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.score).toBe(0);
    expect(snapshot.lives).toBe(START_LIVES);
    expect(snapshot.depth).toBe(1);
    expect(snapshot.brightness).toBe(0);
    expect(snapshot.drifters).toEqual([]);
    expect(snapshot.pulses).toEqual([]);
    expect(snapshot.inkClouds).toEqual([]);
    expect(snapshot.sonar.ready).toBe(true);
    expect(snapshot.ink.ready).toBe(true);
    expect(snapshot.creatureAI).toBe(true);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.visibility.join("")).not.toMatch(/[lr]/);
    expect(snapshot.predators.every((p) => p.state === "den")).toBe(true);
    expect(snapshot.predators.every((p) => !p.released)).toBe(true);
    // Muting is a player preference rather than a value a dive opens with.
    expect(snapshot.muted).toBe(true);
    harness.dispose();
  });

  it("replays the same result from the same seed and the same calls", async () => {
    const run = async (seed: number): Promise<number[]> => {
      const harness = await createHarness();
      harness.debug.reset({ seed });
      harness.debug.startDive();
      harness.debug.beginPlay();
      harness.pace(4);
      await harness.engine.advance(ticks(6) / 4);
      const drawn = harness.debug
        .snapshot()
        .predators.flatMap((p) => [p.x, p.y]);
      harness.dispose();
      return drawn;
    };

    expect(await run(DEFAULT_SEED)).toEqual(await run(DEFAULT_SEED));
    expect(await run(7)).not.toEqual(await run(DEFAULT_SEED));
  });
});

describe("the dive operations", () => {
  it("opens a dive and ends its countdown", async () => {
    const harness = await createHarness();
    harness.debug.setDepth(3);
    harness.debug.startDive();
    const opened = harness.debug.snapshot();
    expect(opened.screen).toBe("countdown");
    expect(opened.depth).toBe(1);
    expect(opened.score).toBe(0);
    expect(opened.lives).toBe(START_LIVES);
    expect(
      opened.predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
    expect(opened.sonar.range).toBe(SONAR_RANGE_BASE);

    harness.debug.beginPlay();
    expect(harness.debug.snapshot().screen).toBe("playing");
    // It applies on the countdown screen alone.
    harness.debug.beginPlay();
    expect(harness.debug.snapshot().screen).toBe("playing");
    harness.dispose();
  });

  it("scales the sonar range with the depth and leaves the maze alone", async () => {
    const harness = await playing();
    const before = harness.debug.snapshot();
    harness.debug.setDepth(3);
    const after = harness.debug.snapshot();
    expect(after.depth).toBe(3);
    expect(after.sonar.range).toBe(SONAR_RANGE_BASE - 2);
    expect(after.tiles).toEqual(before.tiles);
    expect(after.screen).toBe(before.screen);
    expect(() => harness.debug.setDepth(0)).toThrow();
    expect(() => harness.debug.setDepth(1.5)).toThrow();
    harness.dispose();
  });
});

describe("setMaze", () => {
  it("takes a fixture exactly as given, however far from a legal maze", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.tiles).toEqual(fixture.rows);
    // A hall with two dead ends, no den and no wrap tunnel keeps running.
    await harness.engine.advance(ticks(1));
    expect(harness.debug.snapshot().screen).toBe("playing");
    expect(harness.debug.snapshot().tiles).toEqual(fixture.rows);
    harness.dispose();
  });

  it("rests the forager on the first corridor tile in reading order", async () => {
    const harness = await playing();
    const rows = [
      "####################################",
      "####################################",
      "#####........#######################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
      "####################################",
    ];
    harness.debug.setMaze(rows);
    const forager = harness.debug.snapshot().forager;
    expect([forager.tx, forager.ty]).toEqual([5, 2]);
    expect(forager.moving).toBe(false);
    harness.dispose();
  });

  it("leaves the board as a fresh maze and holds every predator in the den", async () => {
    const harness = await playing();
    harness.debug.setBrightness(1);
    await harness.engine.advance(ticks(1));
    const before = harness.debug.snapshot();
    expect(before.visibility.join("")).toMatch(/[lr]/);

    pose(harness.debug, HALL);
    const posed = harness.debug.snapshot();
    expect(posed.planktonRemaining).toBe(
      posed.tiles
        .join("")
        .split("")
        .filter((tile) => tile === ".").length,
    );
    expect(posed.predators.every((p) => p.state === "den")).toBe(true);
    expect(posed.predators.every((p) => !p.released)).toBe(true);
    // What the game is doing is left as it stands.
    expect(posed.screen).toBe(before.screen);
    expect(posed.score).toBe(before.score);
    expect(posed.lives).toBe(before.lives);
    expect(posed.depth).toBe(before.depth);

    // The staggered release schedule is suspended while the fixture stands.
    await harness.engine.advance(ticks(12));
    const later = harness.debug.snapshot();
    expect(later.predators.every((p) => !p.released)).toBe(true);
    expect(later.predators.every((p) => p.state === "den")).toBe(true);
    harness.dispose();
  });

  it("refuses a layout that is not in the alphabet or not the right size", async () => {
    const harness = await playing();
    const good = harness.debug.snapshot().tiles;
    expect(() => harness.debug.setMaze(["#".repeat(GRID_COLS)])).toThrow();
    expect(() =>
      harness.debug.setMaze(new Array<string>(GRID_ROWS).fill("#")),
    ).toThrow();
    expect(() =>
      harness.debug.setMaze(
        new Array<string>(GRID_ROWS).fill("x".repeat(GRID_COLS)),
      ),
    ).toThrow();
    // Den tiles without exactly one gate are invalid.
    const twoGates = new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
    twoGates[8] = `##gg${"d".repeat(GRID_COLS - 6)}##`;
    expect(() => harness.debug.setMaze(twoGates)).toThrow();
    // A refused layout leaves the standing one exactly as it was.
    expect(harness.debug.snapshot().tiles).toEqual(good);
    harness.dispose();
  });

  it("refuses rows that are not an array of strings at all", async () => {
    const harness = await playing();
    const surface = harness.debug as unknown as {
      setMaze(rows: unknown): void;
    };
    expect(() => {
      surface.setMaze("#".repeat(GRID_COLS));
    }).toThrow();
    expect(() => {
      surface.setMaze(null);
    }).toThrow();
    harness.dispose();
  });
});

describe("an argument outside its stated domain", () => {
  it("fails loudly rather than guessing what was meant", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");

    // Off the grid, or not a whole tile at all.
    expect(() => {
      harness.debug.setForagerTile(-1, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setForagerTile(GRID_COLS, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, start.tx + 0.5, start.ty);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, start.tx, GRID_ROWS);
    }).toThrow();

    // On the grid, but rock: closed to the forager and to a predator alike.
    const tiles = harness.debug.snapshot().tiles;
    expect(tiles[0][0]).toBe("#");
    expect(() => {
      harness.debug.setForagerTile(0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.setPredatorTile(0, 0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.spawnDrifter(0, 0);
    }).toThrow();
    expect(() => {
      harness.debug.setPlankton(0, 0, true);
    }).toThrow();

    // No predator carries that index, and no such state, facing or depth.
    expect(() => {
      harness.debug.setPredatorDir(99, "up");
    }).toThrow();
    const surface = harness.debug as unknown as {
      setPredatorState(index: number, value: string): void;
      setForagerDir(dir: string): void;
    };
    expect(() => {
      surface.setPredatorState(0, "search");
    }).toThrow();
    expect(() => {
      surface.setForagerDir("sideways");
    }).toThrow();
    expect(() => {
      harness.debug.setDepth(0);
    }).toThrow();
    expect(() => {
      harness.debug.setBrightness(1.5);
    }).toThrow();
    expect(() => {
      harness.debug.setSonarCooldown(-1);
    }).toThrow();
    expect(() => {
      harness.debug.setInkCooldown(-1);
    }).toThrow();

    // Every refusal left the game exactly as it stood.
    const after = harness.debug.snapshot();
    expect(after.forager.tx).toBe(start.tx);
    expect(after.forager.ty).toBe(start.ty);
    expect(after.depth).toBe(1);
    expect(after.brightness).toBe(0);
    harness.dispose();
  });
});

describe("the forager poses", () => {
  it("moves the forager to a tile and leaves it at rest there", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.setForagerTile(start.tx + 3, start.ty);

    const forager = harness.debug.snapshot().forager;
    expect([forager.tx, forager.ty]).toEqual([start.tx + 3, start.ty]);
    expect(forager.x).toBeCloseTo(
      GRID_ORIGIN_X + (start.tx + 3) * TILE + TILE / 2,
      6,
    );
    expect(forager.moving).toBe(false);

    await harness.engine.advance(ticks(0.5));
    expect(harness.debug.snapshot().forager.tx).toBe(start.tx + 3);
    expect(() => harness.debug.setForagerTile(0, 0)).toThrow();
    harness.dispose();
  });

  it("sets the facing without moving the forager", async () => {
    const harness = await playing();
    const before = harness.debug.snapshot().forager;
    harness.debug.setForagerDir("left");
    const after = harness.debug.snapshot().forager;
    expect(after.dir).toBe("left");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.moving).toBe(false);
    expect(() =>
      (
        harness.debug as unknown as { setForagerDir(d: string): void }
      ).setForagerDir("sideways"),
    ).toThrow();
    harness.dispose();
  });

  it("arms the brightness hold in full, so the posed value is steady", async () => {
    const harness = await playing();
    pose(harness.debug, HALL);
    harness.debug.clearPlankton();
    harness.debug.setBrightness(0.5);

    await harness.engine.advance(ticks(BRIGHT_HOLD) - 4);
    expect(harness.debug.snapshot().brightness).toBeCloseTo(0.5, 6);

    await harness.engine.advance(ticks(0.5));
    expect(harness.debug.snapshot().brightness).toBeLessThan(0.5);
    expect(() => harness.debug.setBrightness(2)).toThrow();
    harness.dispose();
  });
});

describe("the predator poses", () => {
  it("selects a predator by its index into the roster", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");

    harness.debug.setPredatorTile(1, mark.tx, mark.ty);
    harness.debug.setPredatorDir(1, "left");
    const posed = harness.debug.snapshot().predators[1];
    expect(posed.kind).toBe("gloamfin");
    expect([posed.tx, posed.ty]).toEqual([mark.tx, mark.ty]);
    expect(posed.dir).toBe("left");
    // The other predators were not touched.
    expect(harness.debug.snapshot().predators[0].tx).not.toBe(mark.tx);

    expect(() => harness.debug.setPredatorTile(9, mark.tx, mark.ty)).toThrow();
    expect(() => harness.debug.setPredatorDir(-1, "up")).toThrow();
    harness.dispose();
  });

  it("poses each of the three states, and suspends a denned release", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const mark = at(fixture, "P");

    harness.debug.setPredatorTile(0, mark.tx, mark.ty);
    harness.debug.setPredatorState(0, "wander");
    let predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("wander");
    expect(predator.released).toBe(true);
    expect([predator.tx, predator.ty]).toEqual([mark.tx, mark.ty]);

    harness.debug.setPredatorState(0, "chase");
    predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("chase");
    expect(predator.released).toBe(true);
    // A pose is an arrangement rather than a detection, so it fires no alert.
    expect(predator.alert).toBe(false);

    harness.debug.setPredatorState(0, "den");
    predator = harness.debug.snapshot().predators[0];
    expect(predator.state).toBe("den");
    expect(predator.released).toBe(false);

    await harness.engine.advance(ticks(12));
    expect(harness.debug.snapshot().predators[0].released).toBe(false);
    expect(() =>
      (
        harness.debug as unknown as {
          setPredatorState(i: number, v: string): void;
        }
      ).setPredatorState(0, "search"),
    ).toThrow();
    harness.dispose();
  });

  it("lets a posed hunter run its own mind, rounding rock to reach its fix", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, SPINE);
    const mark = at(fixture, "P");
    harness.debug.setPredatorTile(0, mark.tx, mark.ty);
    harness.debug.setPredatorState(0, "chase");
    harness.debug.setCreatureAI(true);

    const rows = harness.debug.snapshot().tiles;
    let steppedOnRock = false;
    const reached = await harness.until(() => {
      const predator = harness.debug.snapshot().predators[0];
      if (rows[predator.ty][predator.tx] === "#") steppedOnRock = true;
      return predator.ty === at(fixture, "F").ty;
    }, ticks(10));

    expect(reached).toBe(true);
    expect(steppedOnRock).toBe(false);
    harness.dispose();
  });

  it("holds every creature exactly where it stands with the minds off", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    harness.debug.setPredatorTile(0, start.tx + 4, start.ty);
    harness.debug.setPredatorState(0, "wander");
    harness.debug.spawnDrifter(start.tx + 6, start.ty);
    harness.debug.setCreatureAI(false);
    harness.debug.setSonarCooldown(2);

    const before = harness.debug.snapshot();
    await harness.engine.advance(ticks(2));
    const after = harness.debug.snapshot();

    expect(after.predators[0].x).toBe(before.predators[0].x);
    expect(after.predators[0].state).toBe(before.predators[0].state);
    expect(after.drifters[0].x).toBe(before.drifters[0].x);
    // Everything else keeps running: the cooldowns still run down.
    expect(after.sonar.cooldown).toBeLessThan(before.sonar.cooldown);
    expect(after.creatureAI).toBe(false);
    harness.dispose();
  });
});

describe("the board poses", () => {
  it("adds a drifter beyond the ordinary ceiling", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    for (let extra = 0; extra <= DRIFTER_MAX; extra++) {
      harness.debug.spawnDrifter(start.tx + 2 + extra, start.ty);
    }
    expect(harness.debug.snapshot().drifters.length).toBe(DRIFTER_MAX + 1);
    expect(() => harness.debug.spawnDrifter(0, 0)).toThrow();
    harness.dispose();
  });

  it("puts a plankton on a tile and takes one off without eating it", async () => {
    const harness = await playing();
    const fixture = pose(harness.debug, HALL);
    const start = at(fixture, "F");
    const before = harness.debug.snapshot();

    harness.debug.setPlankton(start.tx + 2, start.ty, false);
    expect(harness.debug.snapshot().planktonRemaining).toBe(
      before.planktonRemaining - 1,
    );
    expect(harness.debug.snapshot().score).toBe(before.score);

    harness.debug.setPlankton(start.tx + 2, start.ty, true);
    expect(harness.debug.snapshot().planktonRemaining).toBe(
      before.planktonRemaining,
    );
    expect(() => harness.debug.setPlankton(0, 0, true)).toThrow();
    harness.dispose();
  });

  it("clears every plankton without clearing the maze", async () => {
    const harness = await playing();
    pose(harness.debug, HALL);
    harness.debug.clearPlankton();
    expect(harness.debug.snapshot().planktonRemaining).toBe(0);

    await harness.engine.advance(ticks(1));
    const after = harness.debug.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.depth).toBe(1);
    harness.dispose();
  });

  it("poses each cooldown, which then runs down on the ordinary curve", async () => {
    const harness = await playing();
    pose(harness.debug, HALL);
    harness.debug.setSonarCooldown(0);
    harness.debug.setInkCooldown(INK_COOLDOWN);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.sonar.ready).toBe(true);
    expect(snapshot.ink.ready).toBe(false);
    expect(snapshot.ink.cooldown).toBe(INK_COOLDOWN);

    await harness.engine.advance(ticks(1));
    snapshot = harness.debug.snapshot();
    expect(snapshot.ink.cooldown).toBeCloseTo(INK_COOLDOWN - 1, 3);

    expect(() => harness.debug.setSonarCooldown(-1)).toThrow();
    expect(() => harness.debug.setInkCooldown(Number.NaN)).toThrow();
    harness.dispose();
  });
});
