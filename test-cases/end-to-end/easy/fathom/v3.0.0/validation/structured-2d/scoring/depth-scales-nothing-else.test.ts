// scoring/depth-scales-nothing-else — nothing but the roster and the pulse moves
// with depth.
//
// specs/progression.md: "Nothing else scales with depth. Every predator speed in
// `specs/predators.md` and the files under `specs/predators/` holds at every
// depth, and so do the light and vision figures, the sonar cooldown, the ink
// radius and life, the drifter cadence, and the scoring figures above."
//
// SO THE READING IS TWO DEPTHS COMPARED, and everything the sentence names is
// read at both. What a build most plausibly gets wrong here is a difficulty curve
// it invented — hunters that quicken, a cooldown that lengthens, a bonus that
// shrinks — and every one of those shows as a figure that differs between depth
// `1` and depth `5`.
//
// EACH FIGURE IS READ THE WAY IT IS OBSERVABLE. The two cooldowns are read as the
// seconds a spent ability puts on the clock, which is what `SONAR_COOLDOWN` and
// `INK_COOLDOWN` are; the cloud's radius and life are read off the cloud the ink
// key left standing; the hunters' speed and `detectRange` are read off one
// wandering hunter of each kind; and what a plankton and a drifter PAY is read as
// the score each actually adds.
//
// TWO OF THE FIGURES THAT SENTENCE NAMES ARE NOT READ HERE, and neither is left
// ungraded. `SCORE_CLEAR` is paid once a whole maze has been grazed, and
// `DRIFTER_INTERVAL` is two admissions fifty seconds apart; reading either twice
// over would put minutes of simulation inside one point for a figure
// `scoring.cleared-bonus` and `amber.drifter-cadence` already fix. What this
// point can say about them honestly is nothing, so it says nothing.
//
// WHAT IS ASSERTED IS THAT THE TWO DEPTHS AGREE, and never what the figure IS.
// Every one of these has a point of its own that fixes its value — `sonar.cooldown`
// at `sonar.cooldown`, the cloud at `ink.cloud`, the scoring at `scoring.plankton`
// and its neighbors, the speeds under each hunter's own directory. What this point
// adds is that depth leaves them alone.
//
// THE WORLD IS POSED DOWN TO ONE HUNTER AT A TIME, on a ring across solid rock
// from the forager, so a hunter that wandered into the light would change its own
// `detectRange` reading under the comparison rather than the depth doing it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  BINDINGS,
  INK_COOLDOWN,
  INK_LIFE,
  INK_RADIUS,
  SCORE_DRIFTER,
  SCORE_PLANKTON,
  SONAR_COOLDOWN,
} from "../constants";
import { poseApart, spawnDrifter, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requirePredatorMotion } from "../scene";
import { ticksFor } from "../harness";

/** The two depths compared: the first, and one past where the roster caps. */
const DEPTHS = [1, 5] as const;

/** The three hunters, each read at both depths. */
const KINDS = ["lanternjaw", "gloamfin", "flarefish"] as const;

/** The keys specs/movement.md binds the two abilities to. */
const SONAR_KEY = BINDINGS.a[0];
const INK_KEY = BINDINGS.b[0];

/** The ring each hunter patrols, in tiles along its top edge. */
const RING = 4;

/** How far that sealed ring stands from the forager's room, in tiles. */
const APART = 12;

/**
 * Ticks a posed wanderer runs before its speed is read.
 *
 * A quarter of a second: long enough that a build which eases a hunter up to its
 * patrol speed has arrived, and short enough that it is still on the ring.
 */
const WANDER_TICKS = ticksFor(0.25);

/** How much corridor the forager's own room holds, in tiles. */
const ROOM_TILES = 3;

/** Ticks allowed for a bite once the forager stands on what it is eating. */
const EAT_TICKS = ticksFor(0.25);

/**
 * How far two readings of one figure may differ and still agree.
 *
 * A thousandth. Every figure here is a constant the build states once, so two
 * depths reading it differently differ by a whole difficulty step rather than by
 * a rounding; this is slack for the binary representation of a float and nothing
 * more.
 */
const AGREEMENT = 1e-3;

/** Every figure this point reads at one depth. */
interface Figures {
  depth: number;
  sonarCooldown: number;
  inkCooldown: number;
  inkRadius: number;
  inkLife: number;
  speeds: number[];
  detectRanges: (number | null)[];
  planktonPay: number;
  drifterPay: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the same figures at depth 1 and at depth 5", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART, { ring: RING, near: ROOM_TILES });
  await parkForager(h, rooms.near);
  /** The tile inside the forager's own room a mouthful is laid on. */
  const graze = { tx: rooms.near.tx + 1, ty: rooms.near.ty };
  /**
   * A second mouthful, laid beyond the first and never eaten.
   *
   * Eating the plankton that leaves none behind CLEARS the maze
   * (specs/gameplay.md), which would descend and take the second depth's
   * readings on a board this check never posed. The spare is what keeps the
   * board from ever emptying.
   */
  const spare = { tx: rooms.near.tx + 2, ty: rooms.near.ty };

  const read = await captureReplay(h, "unchanged", async () => {
    const figures: Figures[] = [];
    for (const depth of DEPTHS) {
      h.debug.setDepth(depth);
      // The board this check poses draws no den chamber, so `setDepth`'s roster
      // is denned nowhere and holds still (specs/instrumentation.md); the
      // hunters read below are the ones this check spawns onto the ring.
      h.debug.clearPredators();
      // A brightness of zero at both depths, so the two light hunters' detection
      // ranges are compared at the same `G` rather than across whatever the
      // previous depth's grazing left behind (specs/sensing.md).
      h.debug.setBrightness(0);
      h.debug.setBrightHold(0);

      // The two abilities, each spent so the clock it starts can be read.
      h.debug.setSonarCooldown(0);
      h.debug.setInkCooldown(0);
      await h.tap(SONAR_KEY);
      const pulsed = h.snapshot();
      await h.tap(INK_KEY);
      const inked = h.snapshot();
      const cloud = inked.inkClouds[inked.inkClouds.length - 1];

      // One hunter of each kind in turn, on the ring, wandering.
      const speeds: number[] = [];
      const detectRanges: (number | null)[] = [];
      for (const kind of KINDS) {
        h.debug.clearPredators();
        const index = await spawnPredator(h, kind, rooms.far, {
          state: "wander",
        });
        const before = h.snapshot();
        await h.advance(WANDER_TICKS);
        const after = h.snapshot();
        requirePredatorMotion(
          before,
          after,
          index,
          `patrol its ring at depth ${String(depth)}`,
        );
        speeds.push(after.predators[index].speed);
        detectRanges.push(after.predators[index].detectRange);
      }
      h.debug.clearPredators();

      // What a mouthful pays, and what a drifter pays, each read as the score it
      // actually added. The plankton is eaten first because eating one raises
      // `G`, and the hunters above were read at the zero this depth opened on.
      h.debug.clearPlankton();
      h.debug.setScore(0);
      h.debug.setPlankton(graze.tx, graze.ty, true);
      h.debug.setPlankton(spare.tx, spare.ty, true);
      h.debug.setForagerTile(graze.tx, graze.ty);
      await h.advance(EAT_TICKS);
      const planktonPay = h.snapshot().score;

      h.debug.setScore(0);
      await spawnDrifter(h, rooms.near, { mind: false });
      h.debug.setForagerTile(rooms.near.tx, rooms.near.ty);
      await h.advance(EAT_TICKS);
      const grazed = h.snapshot();
      const drifterPay = grazed.score;
      h.debug.clearDrifters();
      assertEqual(
        grazed.screen,
        "playing",
        `the dive was still in live play after the grazing at depth ` +
          `${String(depth)}, which is what the next depth's readings are ` +
          "taken on",
      );

      figures.push({
        depth,
        sonarCooldown: pulsed.sonar.cooldown,
        inkCooldown: inked.ink.cooldown,
        inkRadius: cloud?.radius ?? Number.NaN,
        inkLife: cloud?.remaining ?? Number.NaN,
        speeds,
        detectRanges,
        planktonPay,
        drifterPay,
      });
    }
    return figures;
  });

  const [shallow, deep] = read;

  /** The two depths read one figure the same. */
  const agrees = (name: string, at: (one: Figures) => number): void => {
    assertLessThanOrEqual(
      Math.abs(at(deep) - at(shallow)),
      AGREEMENT,
      `how far ${name} at depth ${String(deep.depth)} (${String(at(deep))}) ` +
        `sits from the same reading at depth ${String(shallow.depth)} ` +
        `(${String(at(shallow))}) — nothing but the roster and the pulse's ` +
        "range scales with depth (specs/progression.md)",
    );
  };

  agrees(
    `SONAR_COOLDOWN (${String(SONAR_COOLDOWN)} s)`,
    (one) => one.sonarCooldown,
  );
  agrees(`INK_COOLDOWN (${String(INK_COOLDOWN)} s)`, (one) => one.inkCooldown);
  agrees(`INK_RADIUS (${String(INK_RADIUS)})`, (one) => one.inkRadius);
  agrees(`INK_LIFE (${String(INK_LIFE)} s)`, (one) => one.inkLife);

  for (const [at, kind] of KINDS.entries()) {
    agrees(`the ${kind}'s wander speed`, (one) => one.speeds[at]);
    agrees(`the ${kind}'s detectRange`, (one) => one.detectRanges[at] ?? 0);
    assertEqual(
      deep.detectRanges[at] === null,
      shallow.detectRanges[at] === null,
      `whether the ${kind} reports a detectRange at all, at depth ` +
        `${String(deep.depth)} against depth ${String(shallow.depth)}`,
    );
  }

  agrees(
    `what a plankton pays (SCORE_PLANKTON, ${String(SCORE_PLANKTON)})`,
    (one) => one.planktonPay,
  );
  agrees(
    `what a drifter pays (SCORE_DRIFTER, ${String(SCORE_DRIFTER)})`,
    (one) => one.drifterPay,
  );
});
