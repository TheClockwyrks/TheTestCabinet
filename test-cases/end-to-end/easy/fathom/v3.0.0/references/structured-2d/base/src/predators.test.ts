import { describe, expect, it } from "vitest";

import {
  ALERT_TIME,
  DEFAULT_SEED,
  DRIFTER_SPEED,
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  GLOAMFIN_CHASE_SPEED,
  GLOAMFIN_CORNER_SPEED,
  GLOAMFIN_GIVEUP,
  GLOAMFIN_PING_INTERVAL,
  GLOAMFIN_RAMP_TIME,
  GLOAMFIN_SEARCH_DELAY,
  INK_LIFE,
  INK_RADIUS,
  LINGER_TIME,
  PREDATOR_SPEED,
  TICK_DT,
} from "./constants";
import type { PredatorKind } from "./constants";
import { Forager, Predator } from "./creatures";
import { anchor, stampLayout } from "./fixtures";
import type { Fixture } from "./fixtures";
import type { InkCloud } from "./ink";
import { Maze } from "./maze";
import { bodyCell, restAt } from "./movement";
import type { Trench } from "./predators";
import {
  acquireFix,
  decayPredatorTimers,
  lightDetectRange,
  updatePredator,
} from "./predators";
import { Rng } from "./rng";
import type { PulseTint } from "./sonar";

interface Scene extends Trench {
  readonly maze: Maze;
  readonly forager: Forager;
  readonly clouds: InkCloud[];
  readonly board: Fixture;
  readonly pings: PulseTint[];
  readonly alerts: Predator[];
  readonly blooms: Predator[];
}

/** A fixture with the forager and one predator posed on its named tiles. */
function scene(
  art: readonly string[],
  kind: PredatorKind,
): { scene: Scene; predator: Predator } {
  const board = stampLayout(art);
  const maze = new Maze(board.rows);
  const forager = new Forager();
  restAt(forager, anchor(board, "F"));
  const predator = new Predator(kind, 0);
  restAt(predator, anchor(board, "P"));
  // Loose in the corridors, which is where every scene below starts it.
  predator.state = "wander";
  predator.released = true;
  const clouds: InkCloud[] = [];
  const pings: PulseTint[] = [];
  const alerts: Predator[] = [];
  const blooms: Predator[] = [];
  return {
    predator,
    scene: {
      board,
      maze,
      forager,
      clouds,
      pings,
      alerts,
      blooms,
      rng: new Rng(DEFAULT_SEED),
      ping: (_source, tint) => {
        pings.push(tint);
      },
      acquired: (hunter) => {
        alerts.push(hunter);
      },
      bloomed: (hunter) => {
        blooms.push(hunter);
      },
    },
  };
}

function step(predator: Predator, trench: Scene, seconds: number): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let tick = 0; tick < ticks; tick++) {
    decayPredatorTimers(predator, TICK_DT);
    updatePredator(predator, TICK_DT, trench);
  }
}

/** Releases a cloud over the forager, which puts every sight line into ink. */
function inkOverForager(trench: Scene): void {
  trench.clouds.push({
    x: trench.forager.x,
    y: trench.forager.y,
    radius: INK_RADIUS,
    remaining: INK_LIFE,
  });
}

/**
 * Two corridors with a solid course of rock between them: five tiles apart, so
 * the forager is out of sight and beyond the ordinary light range, but well
 * inside a flare's bloom.
 */
const SEALED = [
  "P.........",
  "##########",
  "##########",
  "##########",
  "##########",
  "F.........",
];

/** The same standoff, with both boxed in so neither one drifts off it. */
const SEALED_PAIR = ["P", "#", "#", "#", "#", "F"];

describe("the light detection range", () => {
  it("grows with the forager's brightness", () => {
    expect(lightDetectRange(0)).toBe(128);
    expect(lightDetectRange(1)).toBe(320);
  });
});

describe("the Lanternjaw", () => {
  it("drifts at a bonus drifter's pace until it senses the forager", () => {
    const { scene: trench, predator } = scene(["P.....F"], "lanternjaw");
    step(predator, trench, 0.5);
    expect(predator.state).toBe("wander");
    expect(predator.speed).toBe(DRIFTER_SPEED);
  });

  it("hunts at the predator pace once its light sense holds", () => {
    const { scene: trench, predator } = scene(["P.....F"], "lanternjaw");
    trench.forager.shine(1);
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("chase");
    expect(predator.speed).toBe(PREDATOR_SPEED);
    expect(predator.fix).toEqual(bodyCell(trench.forager));
  });

  it("fires no detection alert", () => {
    const { scene: trench, predator } = scene(["P.....F"], "lanternjaw");
    trench.forager.shine(1);
    step(predator, trench, 0.2);
    expect(trench.alerts).toEqual([]);
    expect(predator.alert).toBe(0);
  });

  it("holds a lapsed fix for the linger, then wanders", () => {
    const { scene: trench, predator } = scene(SEALED, "lanternjaw");
    acquireFix(predator, trench, bodyCell(trench.forager));
    step(predator, trench, LINGER_TIME - 0.2);
    expect(predator.state).toBe("chase");
    step(predator, trench, 0.4);
    expect(predator.state).toBe("wander");
    expect(predator.fix).toBeNull();
  });

  it("drops a fix at once when ink blinds it", () => {
    const { scene: trench, predator } = scene(["P.....F"], "lanternjaw");
    trench.forager.shine(1);
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("chase");
    inkOverForager(trench);
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("wander");
    expect(predator.fix).toBeNull();
  });
});

describe("the Gloamfin", () => {
  it("casts a violet ping on its own cadence", () => {
    const { scene: trench, predator } = scene(["P#########F"], "gloamfin");
    step(predator, trench, GLOAMFIN_PING_INTERVAL - 0.1);
    expect(trench.pings).toEqual([]);
    step(predator, trench, 0.2);
    expect(trench.pings).toEqual(["violet"]);
    step(predator, trench, GLOAMFIN_PING_INTERVAL);
    expect(trench.pings).toEqual(["violet", "violet"]);
  });

  it("takes a fix by close hearing and fires the alert", () => {
    const { scene: trench, predator } = scene(["P.F"], "gloamfin");
    step(predator, trench, TICK_DT);
    expect(predator.hearingLock).toBe(true);
    expect(predator.state).toBe("chase");
    expect(trench.alerts).toEqual([predator]);
    expect(predator.alert).toBeGreaterThan(0);
    expect(predator.alert).toBeLessThanOrEqual(ALERT_TIME);
  });

  it("stays silent for as long as it holds a hearing lock", () => {
    const { scene: trench, predator } = scene(["P.F"], "gloamfin");
    step(predator, trench, GLOAMFIN_PING_INTERVAL * 3);
    expect(predator.hearingLock).toBe(true);
    expect(trench.pings).toEqual([]);
  });

  it("searches an empty fix, casts one orange ping, and gives up", () => {
    const { scene: trench, predator } = scene(["P#########F"], "gloamfin");
    acquireFix(predator, trench, bodyCell(predator));
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("search");
    expect(predator.speed).toBe(PREDATOR_SPEED);

    step(predator, trench, GLOAMFIN_SEARCH_DELAY - 0.1);
    expect(trench.pings).toEqual([]);
    step(predator, trench, 0.2);
    expect(trench.pings).toEqual(["orange"]);

    step(predator, trench, GLOAMFIN_GIVEUP - GLOAMFIN_SEARCH_DELAY - 0.3);
    expect(predator.state).toBe("search");
    step(predator, trench, 0.4);
    expect(predator.state).toBe("wander");
    expect(trench.pings).toEqual(["orange"]);
  });

  it("loses its edge on a corner", () => {
    const { scene: trench, predator } = scene(
      ["P....", "####.", "####F"],
      "gloamfin",
    );
    acquireFix(predator, trench, bodyCell(trench.forager));
    expect(predator.chaseSpeed).toBe(GLOAMFIN_CHASE_SPEED);
    let cornered = -1;
    for (let tick = 0; tick < 600 && cornered < 0; tick++) {
      updatePredator(predator, TICK_DT, trench);
      if (predator.heading === "down") cornered = predator.chaseSpeed;
    }
    expect(cornered).toBe(GLOAMFIN_CORNER_SPEED);
  });

  it("climbs back to its cap over the ramp", () => {
    const { scene: trench, predator } = scene(["P#########F"], "gloamfin");
    acquireFix(predator, trench, bodyCell(trench.forager));
    predator.chaseSpeed = GLOAMFIN_CORNER_SPEED;
    step(predator, trench, GLOAMFIN_RAMP_TIME / 2);
    expect(predator.chaseSpeed).toBeCloseTo(
      (GLOAMFIN_CORNER_SPEED + GLOAMFIN_CHASE_SPEED) / 2,
      3,
    );
    step(predator, trench, GLOAMFIN_RAMP_TIME);
    expect(predator.chaseSpeed).toBe(GLOAMFIN_CHASE_SPEED);
  });
});

describe("the Flarefish", () => {
  it("charges, blooms, and re-arms so charge-ups run on one cadence", () => {
    const { scene: trench, predator } = scene(["P#########F"], "flarefish");
    const charges: number[] = [];
    const bloomsOn: number[] = [];
    const bloomsOff: number[] = [];
    let charging = false;
    let burning = false;
    const ticks = Math.round(20 / TICK_DT);
    for (let tick = 0; tick < ticks; tick++) {
      decayPredatorTimers(predator, TICK_DT);
      updatePredator(predator, TICK_DT, trench);
      const at = (tick + 1) * TICK_DT;
      if (predator.flareCharging !== charging) {
        charging = predator.flareCharging;
        if (charging) charges.push(at);
      }
      if (predator.flaring !== burning) {
        burning = predator.flaring;
        (burning ? bloomsOn : bloomsOff).push(at);
        if (burning) expect(predator.flareRadius).toBe(FLARE_RADIUS);
      }
    }

    expect(charges.length).toBeGreaterThanOrEqual(2);
    expect(charges[0]).toBeCloseTo(FLARE_INTERVAL, 1);
    expect(bloomsOn[0] - charges[0]).toBeCloseTo(FLARE_CHARGE, 1);
    expect(bloomsOff[0] - bloomsOn[0]).toBeCloseTo(FLARE_BLOOM, 1);
    expect(charges[1] - charges[0]).toBeCloseTo(
      FLARE_CHARGE + FLARE_BLOOM + FLARE_INTERVAL,
      1,
    );
    expect(trench.blooms.length).toBe(bloomsOn.length);
    expect(predator.flareRadius).toBe(0);
  });

  it("holds one speed in every state", () => {
    const { scene: trench, predator } = scene(["P#########F"], "flarefish");
    step(predator, trench, 1);
    expect(predator.speed).toBe(PREDATOR_SPEED);
    acquireFix(predator, trench, bodyCell(trench.forager));
    step(predator, trench, TICK_DT);
    expect(predator.speed).toBe(PREDATOR_SPEED);
  });

  it("locks on through rock while its bloom burns", () => {
    const { scene: trench, predator } = scene(SEALED_PAIR, "flarefish");
    // Out of sight and beyond the ordinary light range, but inside the bloom.
    const gap = Math.hypot(
      predator.x - trench.forager.x,
      predator.y - trench.forager.y,
    );
    expect(gap).toBeGreaterThan(lightDetectRange(0));
    expect(gap).toBeLessThan(FLARE_RADIUS);

    step(predator, trench, FLARE_INTERVAL + FLARE_CHARGE + 0.1);
    expect(predator.state).toBe("chase");
    expect(trench.alerts).toEqual([predator]);
    // The bloom ends at once when it locks on.
    expect(predator.flaring).toBe(false);
    expect(predator.flareRadius).toBe(0);
  });

  it("takes a fix on a lit forager it drifts up on, without flaring", () => {
    // Four tiles apart down one open corridor: inside the ordinary range at
    // any brightness, and reached long before the first flare is due.
    const { scene: trench, predator } = scene(["P...F"], "flarefish");
    expect(FLARE_INTERVAL).toBeGreaterThan(1);

    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("chase");
    expect(trench.alerts).toEqual([predator]);
    // The sense owes nothing to the flare, so no tell was given away.
    expect(predator.flareCharging).toBe(false);
    expect(predator.flaring).toBe(false);
    expect(trench.blooms).toEqual([]);
    // While the sense holds, the fix is the forager's current tile.
    expect(predator.fix).toEqual(bodyCell(trench.forager));
  });

  it("drops a chase at once when ink blinds it, with no linger", () => {
    const { scene: trench, predator } = scene(["P...F"], "flarefish");
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("chase");

    inkOverForager(trench);
    step(predator, trench, TICK_DT);
    expect(predator.state).toBe("wander");
    expect(predator.fix).toBeNull();
    // Ink re-arms the flare in full, exactly as the linger running out does.
    expect(predator.flareTimer).toBeGreaterThan(FLARE_INTERVAL - 0.05);
  });

  it("re-arms a whole interval when it loses the forager", () => {
    const { scene: trench, predator } = scene(SEALED, "flarefish");
    acquireFix(predator, trench, bodyCell(trench.forager));
    step(predator, trench, LINGER_TIME + TICK_DT * 2);
    expect(predator.state).toBe("wander");
    expect(predator.flareTimer).toBeGreaterThan(FLARE_INTERVAL - 0.05);
  });
});

describe("the den and the schedule", () => {
  const DEN = [".....", "##g##", "#ddd#", "#####", "....F"];

  it("holds a predator that has not been released", () => {
    const board = stampLayout(DEN);
    const maze = new Maze(board.rows);
    const forager = new Forager();
    restAt(forager, anchor(board, "F"));
    const predator = new Predator("gloamfin", 0);
    const den = maze.denTiles[0];
    predator.returnToDen(den, false);
    const trench: Scene = {
      board,
      maze,
      forager,
      clouds: [],
      pings: [],
      alerts: [],
      blooms: [],
      rng: new Rng(DEFAULT_SEED),
      ping: () => undefined,
      acquired: () => undefined,
      bloomed: () => undefined,
    };
    step(predator, trench, 2);
    expect(predator.state).toBe("den");
    expect(bodyCell(predator)).toEqual(den);

    predator.released = true;
    step(predator, trench, 2);
    expect(predator.state).toBe("wander");
    expect(maze.isDen(bodyCell(predator).tx, bodyCell(predator).ty)).toBe(
      false,
    );
    expect(maze.isGate(bodyCell(predator).tx, bodyCell(predator).ty)).toBe(
      false,
    );
  });
});

describe("predators keep to the corridors", () => {
  it("rounds the rock between it and the tile it drives at", () => {
    const { scene: trench, predator } = scene(
      ["P....", "####.", "F...."],
      "lanternjaw",
    );
    acquireFix(predator, trench, bodyCell(trench.forager));
    for (let tick = 0; tick < 600; tick++) {
      updatePredator(predator, TICK_DT, trench);
      const here = bodyCell(predator);
      expect(trench.maze.isRock(here.tx, here.ty)).toBe(false);
    }
    expect(bodyCell(predator).ty).toBe(bodyCell(trench.forager).ty);
  });

  it("stays put on a tile with no open neighbor", () => {
    const { scene: trench, predator } = scene(["P#########F"], "lanternjaw");
    const start = bodyCell(predator);
    const x = predator.x;
    step(predator, trench, 3);
    expect(bodyCell(predator)).toEqual(start);
    expect(predator.x).toBe(x);
  });
});

describe("the windows a predator is drawn by", () => {
  it("run down whether or not its own mind is running", () => {
    const predator = new Predator("gloamfin", 0);
    predator.alert = ALERT_TIME;
    predator.mark = 1.5;
    decayPredatorTimers(predator, 0.25);
    expect(predator.alert).toBeCloseTo(ALERT_TIME - 0.25, 10);
    expect(predator.mark).toBeCloseTo(1.25, 10);
    decayPredatorTimers(predator, 10);
    expect(predator.alert).toBe(0);
    expect(predator.mark).toBe(0);
  });
});
