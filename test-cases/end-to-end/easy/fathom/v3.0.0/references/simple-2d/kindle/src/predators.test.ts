import { describe, expect, it } from "vitest";
import {
  ALERT_TIME,
  CUES,
  DEN_RELEASE_GAP,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_SEARCH_DELAY,
  GRID_COLS,
  GRID_ROWS,
  LINGER_TIME,
  PREDATOR_SPEED,
  TICK_DT,
  type PredatorKind,
} from "./constants";
import { centerX, centerY } from "./grid";
import { loadLayout } from "./maze";
import { releaseInk } from "./ink";
import {
  addedPredator,
  createPredator,
  denPose,
  flareCharging,
  flareRadius,
  flaring,
  rosterForDepth,
  stepPredator,
  wanderSpeed,
  type PredatorWorld,
} from "./predators";
import { createDraws, type Draws } from "./rng";
import type {
  InkCloudState,
  MazeState,
  PredatorState,
  PulseState,
  Tile,
} from "./state";
import type { CueName } from "./constants";

function board(
  art: readonly string[],
  x: number,
  y: number,
  start?: Tile,
): MazeState {
  const grid = Array.from({ length: GRID_ROWS }, () =>
    "#".repeat(GRID_COLS).split(""),
  );
  art.forEach((line, i) => {
    line.split("").forEach((ch, j) => {
      grid[y + i][x + j] = ch;
    });
  });
  return loadLayout(
    grid.map((row) => row.join("")),
    start,
  );
}

function world(
  maze: MazeState,
  ftx: number,
  fty: number,
  brightness = 0,
  inkClouds: readonly InkCloudState[] = [],
): PredatorWorld {
  return {
    maze,
    fx: centerX(ftx),
    fy: centerY(fty),
    ftx,
    fty,
    brightness,
    inkClouds,
  };
}

function loose(kind: PredatorKind, tx: number, ty: number): PredatorState {
  return {
    ...createPredator(kind, tx, ty, 0),
    mode: "wander",
    released: true,
    speed: wanderSpeed(kind),
  };
}

interface Run {
  readonly predator: PredatorState;
  readonly pulses: PulseState[];
  readonly cues: CueName[];
  readonly modes: string[];
}

function run(
  predator: PredatorState,
  w: PredatorWorld,
  ticks: number,
  draws: Draws = createDraws(1),
  index = 0,
): Run {
  let current = predator;
  const pulses: PulseState[] = [];
  const cues: CueName[] = [];
  const modes: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const step = stepPredator(current, index, TICK_DT, w, draws);
    current = step.predator;
    pulses.push(...step.pulses);
    cues.push(...step.cues);
    modes.push(current.mode);
  }
  return { predator: current, pulses, cues, modes };
}

describe("the roster a depth holds", () => {
  it("holds one of each kind at depth one and caps at two of each", () => {
    expect(rosterForDepth(1)).toEqual(["lanternjaw", "gloamfin", "flarefish"]);
    expect(rosterForDepth(2)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
    ]);
    expect(rosterForDepth(3)).toEqual([
      "lanternjaw",
      "gloamfin",
      "flarefish",
      "gloamfin",
      "lanternjaw",
    ]);
    expect(rosterForDepth(4)).toHaveLength(6);
    expect(rosterForDepth(9)).toEqual(rosterForDepth(4));
    for (const kind of ["lanternjaw", "gloamfin", "flarefish"] as const) {
      expect(rosterForDepth(7).filter((k) => k === kind)).toHaveLength(2);
    }
  });
});

describe("the den and its release schedule", () => {
  const denBoard = (): MazeState => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[5] = "#".repeat(17) + "." + "#".repeat(GRID_COLS - 18);
    rows[6] = "#".repeat(17) + "g" + "#".repeat(GRID_COLS - 18);
    rows[7] = "#".repeat(16) + "ddd" + "#".repeat(GRID_COLS - 19);
    rows[4] = "#".repeat(17) + "." + "#".repeat(GRID_COLS - 18);
    return loadLayout(rows, { tx: 17, ty: 4 });
  };

  it("releases the first predator at once and the next a gap later", () => {
    const maze = denBoard();
    const w = world(maze, 1, 1);
    const first = run(createPredator("lanternjaw", 17, 7, 0), w, 1);
    expect(first.predator.released).toBe(true);

    const second = createPredator("gloamfin", 17, 7, 1);
    expect(second.releaseIn).toBe(DEN_RELEASE_GAP);
    const early = run(second, w, DEN_RELEASE_GAP * 120 - 2);
    expect(early.predator.released).toBe(false);
    expect(early.predator.mode).toBe("den");
    const late = run(early.predator, w, 4);
    expect(late.predator.released).toBe(true);
  });

  it("reports den until the predator is out of the chamber", () => {
    const maze = denBoard();
    const w = world(maze, 1, 1);
    const out = run(createPredator("lanternjaw", 17, 7, 0), w, 600);
    expect(out.predator.mode).toBe("wander");
    expect(out.modes[0]).toBe("den");
  });

  it("never releases a predator that carries no release time", () => {
    // A predator the debug surface added carries no release time, because the
    // staggered schedule runs on the roster a maze is laid out with. Held
    // unreleased, its slot never arrives.
    const maze = denBoard();
    const w = world(maze, 1, 1);
    const added = addedPredator("flarefish", 17, 7);
    expect(added.releaseIn).toBeNull();
    expect(added.mode).toBe("wander");
    expect(added.released).toBe(true);
    expect(added.mind).toBe(true);
    expect(added.travel).toBe(true);

    const waiting = denPose({ ...added, released: false });
    const after = run(waiting, w, 120 * 30);
    expect(after.predator.released).toBe(false);
    expect(after.predator.mode).toBe("den");
    expect(after.predator.x).toBe(centerX(17));
    expect(after.predator.y).toBe(centerY(7));
  });

  it("poses the den where the predator already stands, keeping its slot", () => {
    // `setPredatorState(index, "den")` moves the predator nowhere and leaves its
    // `released` flag as it stands, so a released predator posed into the
    // chamber swims out through the gate from there.
    const maze = denBoard();
    const w = world(maze, 1, 1);
    const loose = { ...createPredator("gloamfin", 17, 7, 0), released: true };
    const posed = denPose(loose);
    expect(posed.mode).toBe("den");
    expect(posed.released).toBe(true);
    expect(posed.x).toBe(centerX(17));
    expect(posed.y).toBe(centerY(7));
    expect(posed.fix).toBeNull();

    const out = run(posed, w, 600);
    expect(out.predator.mode).toBe("wander");
  });
});

describe("the Lanternjaw", () => {
  const hall = (): MazeState => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = "#" + ".".repeat(GRID_COLS - 2) + "#";
    return loadLayout(rows, { tx: 1, ty: 9 });
  };

  it("chases a forager in range, in line of sight and clear of ink", () => {
    const maze = hall();
    const seen = run(loose("lanternjaw", 4, 9), world(maze, 10, 9, 1), 1);
    expect(seen.predator.mode).toBe("chase");
    expect(seen.predator.fix).toEqual({ tx: 10, ty: 9 });
    expect(seen.predator.speed).toBe(PREDATOR_SPEED);
    // It fires no alert, ever.
    expect(seen.predator.alertIn).toBe(0);
  });

  it("does not chase a forager past its detection range", () => {
    const maze = hall();
    const unseen = run(loose("lanternjaw", 4, 9), world(maze, 20, 9, 0), 1);
    expect(unseen.predator.mode).toBe("wander");
    expect(unseen.predator.speed).toBe(DRIFTER_SPEED);
  });

  it("holds the last tile it sensed for LINGER_TIME, then wanders", () => {
    const maze = hall();
    const acquired = run(
      loose("lanternjaw", 4, 9),
      world(maze, 10, 9, 1),
      1,
    ).predator;
    const lost = world(maze, 30, 9, 0);
    const inside = run(acquired, lost, LINGER_TIME * 120 - 20);
    expect(inside.predator.mode).toBe("chase");
    const beyond = run(inside.predator, lost, 40);
    expect(beyond.predator.mode).toBe("wander");
    expect(beyond.predator.fix).toBeNull();
  });

  it("drops the fix at once when ink lies on the line, with no linger", () => {
    const maze = hall();
    const acquired = run(
      loose("lanternjaw", 4, 9),
      world(maze, 10, 9, 1),
      1,
    ).predator;
    const inked = world(maze, 10, 9, 1, [releaseInk(centerX(7), centerY(9))]);
    const after = run(acquired, inked, 1);
    expect(after.predator.mode).toBe("wander");
    expect(after.predator.fix).toBeNull();
  });
});

describe("the Gloamfin", () => {
  const hall = (): MazeState => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = "#" + ".".repeat(GRID_COLS - 2) + "#";
    return loadLayout(rows, { tx: 1, ty: 9 });
  };

  it("takes a fix by close hearing, through the dark, and fires the alert", () => {
    const maze = hall();
    const heard = run(loose("gloamfin", 5, 9), world(maze, 6, 9, 0), 1);
    expect(heard.predator.hearingLock).toBe(true);
    expect(heard.predator.mode).toBe("chase");
    expect(heard.predator.alertIn).toBe(ALERT_TIME);
    expect(GLOAMFIN_HEAR).toBe(64);
  });

  it("casts an ordinary violet ping on its own cadence", () => {
    const maze = hall();
    const out = run(
      loose("gloamfin", 5, 9),
      world(maze, 30, 9, 0),
      GLOAMFIN_PING_INTERVAL * 120 + 2,
    );
    expect(out.pulses).toHaveLength(1);
    expect(out.pulses[0].tint).toBe("violet");
    expect(out.pulses[0].source).toBe("gloamfin");
    expect(out.cues).toContain(CUES.predatorPing);
  });

  it("is silent for as long as it holds a close-range hearing lock", () => {
    const maze = hall();
    const out = run(
      loose("gloamfin", 5, 9),
      world(maze, 6, 9, 0),
      GLOAMFIN_PING_INTERVAL * 120 + 60,
    );
    expect(out.pulses).toHaveLength(0);
  });

  it("searches the tile a fix led it to, casts one orange ping, then gives up", () => {
    const maze = hall();
    const fixed: PredatorState = {
      ...loose("gloamfin", 5, 9),
      mode: "chase",
      fix: { tx: 5, ty: 9 },
      pingIn: 60,
    };
    const far = world(maze, 30, 9, 0);
    const started = run(fixed, far, 1);
    expect(started.predator.mode).toBe("search");
    expect(started.predator.speed).toBe(PREDATOR_SPEED);

    const casting = run(started.predator, far, GLOAMFIN_SEARCH_DELAY * 120 + 4);
    expect(casting.pulses).toHaveLength(1);
    expect(casting.pulses[0].tint).toBe("orange");

    const givenUp = run(casting.predator, far, GLOAMFIN_GIVEUP * 120);
    expect(givenUp.predator.mode).toBe("wander");
    expect(givenUp.predator.fix).toBeNull();
  });

  it("loses its edge on a corner and wins it back over the ramp", () => {
    // An L: along row 9 to column 8, then up column 8.
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = "#".repeat(4) + ".....";
    rows[9] = rows[9] + "#".repeat(GRID_COLS - rows[9].length);
    for (const ty of [5, 6, 7, 8]) {
      rows[ty] = "#".repeat(8) + "." + "#".repeat(GRID_COLS - 9);
    }
    const maze = loadLayout(rows, { tx: 4, ty: 9 });
    const chasing: PredatorState = {
      ...loose("gloamfin", 4, 9),
      mode: "chase",
      fix: { tx: 8, ty: 5 },
      heading: "right",
    };
    const w = world(maze, 8, 5, 0);
    let current = chasing;
    let floor = GLOAMFIN_CHASE_SPEED;
    const draws = createDraws(1);
    for (let i = 0; i < 200; i++) {
      current = stepPredator(current, 0, TICK_DT, w, draws).predator;
      floor = Math.min(floor, current.chaseSpeed);
    }
    expect(floor).toBe(GLOAMFIN_CORNER_SPEED);
    expect(current.chaseSpeed).toBeGreaterThan(GLOAMFIN_CORNER_SPEED);
    expect(current.chaseSpeed).toBeLessThanOrEqual(GLOAMFIN_CHASE_SPEED);
  });
});

describe("the Flarefish", () => {
  const room = (): MazeState => {
    const rows = Array.from({ length: GRID_ROWS }, () => "#".repeat(GRID_COLS));
    rows[9] = "#" + ".".repeat(GRID_COLS - 2) + "#";
    return loadLayout(rows, { tx: 1, ty: 9 });
  };

  // A sealed ring of corridor, so a wandering Flarefish keeps to one place and
  // its ordinary light-sense never reaches out of it.
  const ring = (): MazeState =>
    board(["....", ".##.", ".##.", "...."], 4, 8, { tx: 4, ty: 9 });

  it("charges, blooms, and puts the next flare a whole interval away", () => {
    const maze = ring();
    const w = world(maze, 25, 2);
    let current = loose("flarefish", 4, 9);
    const draws = createDraws(1);
    const cues: CueName[] = [];
    const chargeStarts: number[] = [];
    let wasCharging = false;
    let blooms = 0;
    let firstBloomAt = -1;
    for (let i = 0; i < 120 * 20; i++) {
      const step = stepPredator(current, 0, TICK_DT, w, draws);
      current = step.predator;
      cues.push(...step.cues);
      const charging = flareCharging(current);
      if (charging && !wasCharging) chargeStarts.push(i);
      wasCharging = charging;
      if (flaring(current)) {
        blooms++;
        if (firstBloomAt < 0) firstBloomAt = i;
      }
      if (step.bloom !== null)
        expect(step.bloom.radius).toBe(flareRadius(current));
    }
    expect(chargeStarts.length).toBeGreaterThanOrEqual(2);
    expect(chargeStarts[0] / 120).toBeCloseTo(FLARE_INTERVAL, 1);
    expect((firstBloomAt - chargeStarts[0]) / 120).toBeCloseTo(FLARE_CHARGE, 1);
    // Consecutive charge-ups begin a charge, a bloom and an interval apart.
    expect((chargeStarts[1] - chargeStarts[0]) / 120).toBeCloseTo(
      FLARE_CHARGE + FLARE_BLOOM + FLARE_INTERVAL,
      1,
    );
    expect(blooms / 120).toBeCloseTo(2 * FLARE_BLOOM, 1);
    expect(cues.filter((cue) => cue === CUES.flare)).toHaveLength(2);
  });

  it("locks on anything its bloom reaches and ends the bloom at once", () => {
    const maze = ring();
    // Well past the ordinary light range and behind rock, but inside the bloom,
    // which ignores rock entirely.
    const w = world(maze, 10, 9, 0);
    let current = loose("flarefish", 4, 9);
    const draws = createDraws(1);
    let locked: PredatorState | null = null;
    for (let i = 0; i < 120 * 10 && locked === null; i++) {
      current = stepPredator(current, 0, TICK_DT, w, draws).predator;
      if (current.mode === "chase") locked = current;
    }
    expect(locked).not.toBeNull();
    expect(locked?.alertIn).toBeGreaterThan(0);
    expect(locked?.fix).toEqual({ tx: 10, ty: 9 });
    expect(flaring(locked as PredatorState)).toBe(false);
    expect(flareRadius(locked as PredatorState)).toBe(0);
  });

  it("gives off no tell while it chases", () => {
    const maze = room();
    const chasing: PredatorState = {
      ...loose("flarefish", 4, 9),
      mode: "chase",
      fix: { tx: 6, ty: 9 },
      linger: LINGER_TIME,
      flareIn: 0,
    };
    const out = run(chasing, world(maze, 6, 9, 1), 120);
    expect(out.predator.flarePhase).toBeNull();
    expect(out.cues).toHaveLength(0);
  });
});
