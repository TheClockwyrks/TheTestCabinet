// scoring/depth-scaling — depth adds hunters and shortens the pulse, and nothing else.
//
// specs/progression.md: "Deeper mazes hold more hunters. Depth `1` holds one
// predator of each kind, each depth beyond the first adds one more, and the roster
// caps at two of each kind, six predators in all, from depth `4` on", listed "in
// release order"; "`E = max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (d - 1))` tiles",
// which "is reported as `sonar.range`, and it is the range every pulse the forager
// emits carries, reported as that pulse's `range`"; and "Nothing else scales with
// depth. Every predator speed in specs/predators.md and the files under
// specs/predators/ holds at every depth".
//
// FIVE DEPTHS, BECAUSE THE CAP IS PART OF THE RULE. Depths `1` to `3` each add
// one, depth `4` adds the last, and depth `5` adds nothing — a build that keeps
// adding is only caught by asking a depth past the cap.
//
// THE ROSTER IS BUILT FROM THE TWO ORDERS THE SPECIFICATION NAMES rather than
// written out, so the expectation is the rule and not a transcription of the table
// in specs/predators.md. It agrees with that table depth for depth: `1` is one of
// each, `2` adds a Gloamfin, `3` a Lanternjaw, `4` a Flarefish, and `5` and deeper
// hold at that.
//
// THE PULSE IS FIRED WITH THE KEY, because nothing else can fire one: the
// debugging surface carries no operation that emits a pulse, and the claim is
// about a pulse the forager actually emits. A build whose sonar control is dead
// therefore fails here as well as at `sonar/*`, which is the price of the clause
// being about an emitted pulse rather than about a reported number.
//
// THE FRESHEST PULSE IS THE ONE READ. A pulse outlives the beat between two
// depths, so the list can hold the previous depth's front as well; the one whose
// front has travelled least is the one just fired.
//
// THE SPEED IS READ OFF A WANDERING GLOAMFIN, whose wander speed
// specs/predators/gloamfin.md fixes at `PREDATOR_SPEED` and states is "steady for
// as long as it wanders", in a sealed ring the forager cannot be sensed from. What
// the reading asks is only that the two depths agree; what the speed IS belongs to
// `gloamfin/wander-speed`.

import { afterEach, beforeEach } from "vitest";
import {
  DEN_ORDER,
  ROSTER_ADD_ORDER,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
} from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { poseApart } from "../fixtures";
import {
  captureReplay,
  createHarness,
  predator,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  check,
  denAll,
  failPrecondition,
  indexOfKind,
  quietBoard,
  requirePredatorMotion,
} from "../scene";
import type { FathomSnapshot, PulseSnapshot } from "../surface";

/** The depths read, which reach one past `ROSTER_CAP_DEPTH` so the cap is tested. */
const DEPTHS = [1, 2, 3, 4, 5] as const;

/**
 * How many predators of one kind the roster may hold.
 *
 * specs/predators.md: "the roster holds at `ROSTER_CAP`, two of each kind and six
 * predators in all". Stated here rather than imported because it is the per-kind
 * figure the sentence gives, and the roster below is built kind by kind.
 */
const PER_KIND_CAP = 2;

/** The key specs/movement.md binds the `a` action, which emits a sonar pulse, to. */
const SONAR_KEY = "Space";

/** How long a pulse may take to appear after the key, in ticks. */
const PULSE_BUDGET = ticksFor(0.5);

/** Ticks run after a pulse is read, so the clip shows its front sweeping out. */
const PULSE_TAIL = ticksFor(0.25);

/**
 * Ticks a posed wanderer runs before its speed is read.
 *
 * A quarter of a second: long enough that a build which eases a predator up to its
 * patrol speed has arrived, and short enough that the wanderer is still in the
 * ring it was posed in.
 */
const WANDER_TICKS = ticksFor(0.25);

/**
 * How far apart the two depths' wander speeds may read, in logical units per
 * second.
 *
 * One unit of the `116` specs/predators/gloamfin.md fixes: far below any scaling a
 * build could apply and far above the rounding of a speed read off two different
 * steps of a steady patrol.
 */
const SPEED_TOLERANCE = 1;

/** The ring the wanderer patrols, in tiles along its top edge. */
const RING = 4;

/** How far the wanderer's sealed ring stands from the forager's room, in tiles. */
const APART = 12;

/** The roster depth `d` holds, in release order, from the orders specs/predators.md names. */
function rosterAt(depth: number): string[] {
  const roster: string[] = [...DEN_ORDER];
  for (let extra = 1; extra < depth; extra += 1) {
    const kind = ROSTER_ADD_ORDER[(extra - 1) % ROSTER_ADD_ORDER.length];
    if (roster.filter((held) => held === kind).length >= PER_KIND_CAP) continue;
    roster.push(kind);
  }
  return roster;
}

/** `E` at depth `d`, the formula specs/progression.md states. */
function sonarRangeAt(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/** The forager's own wavefronts in flight. */
function foragerPulses(snapshot: FathomSnapshot): PulseSnapshot[] {
  return snapshot.pulses.filter((pulse) => pulse.source === "forager");
}

/** Emit a pulse through the sonar key and hand back the one just fired. */
async function emitPulse(h: Harness): Promise<PulseSnapshot | null> {
  const had = foragerPulses(h.snapshot()).length;
  h.debug.setSonarCooldown(0);
  await h.tap(SONAR_KEY);
  const fired = await h.until((s) => foragerPulses(s).length > had, {
    maxFrames: PULSE_BUDGET,
    poll: 1,
  });
  const inFlight = foragerPulses(fired.snapshot);
  const freshest = inFlight.reduce<PulseSnapshot | null>(
    (best, pulse) => (best === null || pulse.front < best.front ? pulse : best),
    null,
  );
  await h.advance(PULSE_TAIL);
  return fired.hit ? freshest : null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Depth adds hunters and shortens the pulse", async () => {
  startPlaying(h);
  // The forager's own room, and across solid rock a sealed ring for the wanderer,
  // so nothing the speed reading watches can reach the forager and drop out of its
  // patrol.
  const rooms = await poseApart(h, APART, { ring: RING });
  await quietBoard(h, rooms.near);

  const read = await captureReplay(h, "scale", async () => {
    const depths = [];
    for (const depth of DEPTHS) {
      h.debug.setDepth(depth);
      // The grown roster's newcomers are held in the sealed den with the rest, so
      // nothing is loose while the readings are taken.
      await denAll(h);
      const snapshot = h.snapshot();
      const pulse = await emitPulse(h);
      depths.push({
        depth,
        kinds: snapshot.predators.map((p) => p.kind),
        range: snapshot.sonar.range,
        pulse,
      });
    }

    const patrols = [];
    for (const depth of [DEPTHS[0], DEPTHS[DEPTHS.length - 1]]) {
      h.debug.setDepth(depth);
      await denAll(h);
      const index = indexOfKind(h.snapshot(), "gloamfin");
      if (index < 0) {
        failPrecondition(
          "the roster to carry a Gloamfin whose wander speed can be read at " +
            "two depths; specs/predators.md gives every depth at least one",
          "the roster half of this point, read above",
          `no gloamfin at depth ${depth}`,
        );
      }
      h.debug.setPredatorTile(index, rooms.far.tx, rooms.far.ty);
      h.debug.setPredatorState(index, "wander");
      const before = h.snapshot();
      await h.advance(WANDER_TICKS);
      const after = h.snapshot();
      patrols.push({ depth, index, before, after });
    }
    return { depths, patrols };
  });

  for (const at of read.depths) {
    assertDeepEqual(
      at.kinds,
      rosterAt(at.depth),
      `the roster at depth ${at.depth}, in release order`,
    );
    assertEqual(
      at.range,
      sonarRangeAt(at.depth),
      `sonar.range at depth ${at.depth}`,
    );
    assertNotNull(
      at.pulse,
      `a wavefront the forager emitted at depth ${at.depth}, fired with the ` +
        `${SONAR_KEY} key inside ${PULSE_BUDGET} ticks`,
    );
    assertEqual(
      at.pulse?.range,
      sonarRangeAt(at.depth),
      `the range the pulse fired at depth ${at.depth} carries`,
    );
  }

  // The wanderer has to have wandered for the speeds to mean anything; whether a
  // predator moves under its own power is the den and patrol points' verdict.
  for (const patrol of read.patrols) {
    requirePredatorMotion(
      patrol.before,
      patrol.after,
      patrol.index,
      `patrol its ring at depth ${patrol.depth}`,
    );
  }
  const [shallow, deep] = read.patrols;
  const shallowSpeed = predator(shallow.after, shallow.index).speed;
  const deepSpeed = predator(deep.after, deep.index).speed;
  assertLessThanOrEqual(
    Math.abs(deepSpeed - shallowSpeed),
    SPEED_TOLERANCE,
    `how far a wandering Gloamfin's speed at depth ${deep.depth} ` +
      `(${deepSpeed}) sits from its speed at depth ${shallow.depth} ` +
      `(${shallowSpeed})`,
  );
});
