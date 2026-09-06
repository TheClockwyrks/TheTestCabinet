// Wireworm — instrumentation/snapshot-shape: `snapshot()` reports the whole
// object specs/instrumentation.md documents, with every field at its documented
// type, read off a board that is actually carrying one of everything.
//
// specs/instrumentation.md fixes the shape exactly — "Every field an operation
// can set is present, so every operation is verifiable by setting a value and
// reading it back" — and the rest of this suite reads its verdicts out of that
// object. A field that is absent, or that answers with something of the wrong
// kind, therefore costs the point that asks for it somewhere else, under a
// heading about a mechanic. This point names it here instead.
//
// THE BOARD IS POSED SO NO ROSTER IS EMPTY. An empty array satisfies "is an
// array" while saying nothing about the entries the specification describes, so
// the board carries nodes at all four charges specs/nodes.md names, two worms,
// one foe of each of the three kinds specs/foes.md names, a bolt in flight, and
// a live discharge — and every per-entry field is read off a real entry.
//
// THE DISCHARGE IS THE ONE THAT HAS TO BE DRIVEN. `arcs` is "empty except during
// the `ARC_LIFE` (`0.32` s) window after a detonation" (specs/discharge.md), so
// the only way to read an arc is to detonate something: a bolt is placed under a
// critical node with a charged neighbour inside the chain's reach, and the
// snapshot is taken inside that window, with a second bolt placed after it so a
// bolt is in flight at the same instant.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the VALUES beyond the two that make
// the reading non-vacuous — that the arcs window opened at all, and that the
// posed rosters are the ones being reported. Which tiles the chain reached is
// `discharge/*`'s, what a charge means is `nodes/*`'s, and that each pose is
// read back is `instrumentation/poses-read-back`'s.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE, CHARGE_MAX, COLS, tileCX, tileCY } from "../constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  poseWorm,
  startPlaying,
  ticksFor,
  type Edge,
  type FoeKind,
  type Harness,
  type Phase,
  type Screen,
} from "../harness";
import { WIREWORM_DEBUG_VERSION } from "../surface";

/** The two edges the worm's entry can be posed to. */
const EDGES: readonly Edge[] = ["left", "right"];

/** The six screens and the three phases, as specs/instrumentation.md lists them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];
const PHASES: readonly Phase[] = ["banner", "active", "respawn"];

/** The three foe kinds, as specs/foes.md names them. */
const KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/** The row the four charge states are laid along, and the columns they sit on. */
const CHARGE_ROW = 5;
const CHARGE_COLS = [2, 4, 6, 8] as const;

/** Where the two worms stand, and how long each is. */
const WORM_ROW = 2;
const WORM_COLS = [12, 20] as const;
const WORM_LENGTH = 3;

/** The row the three foes stand on, and the column each stands in. */
const FOE_ROW = 14;
const FOE_COLS = [4, 10, 16] as const;

/**
 * The detonation: a critical node with one charged neighbour beside it, far from
 * everything else on the board.
 *
 * specs/discharge.md chains from a detonated node "to every `C >= 1` node within
 * Chebyshev radius `2`", so the neighbour is one tile away and guarantees the
 * discharge reports at least one conducted link. Eight tiles separate it from
 * the charge row and four rows from the foes, which is past that radius, so
 * nothing else on the board is touched by it.
 */
const FUSE_C = 30;
const FUSE_R = 10;
const NEIGHBOUR_C = 31;

/** The column the second bolt climbs, which holds nothing at all. */
const CLEAR_C = 36;

/** The row a posed bolt starts on: the floor, so it has the board to climb. */
const BOLT_R = 19;

/**
 * How long the fuse bolt is given to reach the critical node, in seconds.
 *
 * It has nine rows to climb, `288` logical units, and specs/cursor.md fixes
 * `BOLT_SPEED` at `900` units per second — `0.32` s. One second is three times
 * that, so a build whose bolt is slower than the figure still detonates here and
 * is graded on its speed by `cursor/bolt-speed` instead.
 */
const FUSE_ALLOWANCE = 1;

/** Every field of one snapshot entry is of the type the specification gives it. */
function assertTile(tile: unknown, what: string): void {
  const entry = tile as Record<string, unknown>;
  assertEqual(typeof entry.c, "number", `${what}.c`);
  assertEqual(typeof entry.r, "number", `${what}.r`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, from a board carrying one of everything", async () => {
  startPlaying(h);

  // Nodes at all four charges specs/nodes.md names.
  CHARGE_COLS.forEach((c, charge) => {
    h.debug.setNode(c, CHARGE_ROW, charge);
  });

  // Two worms, each held still: this point reads their fields, and a worm that
  // wandered into the fuse column would be reporting another point's mechanic.
  for (const c of WORM_COLS) {
    const id = poseWorm(h, c, WORM_ROW, WORM_LENGTH);
    h.debug.setWormStepping(id, false);
  }

  // One foe of each kind, held still and mindless for the same reason.
  KINDS.forEach((kind, index) => {
    const id = poseFoe(h, kind, FOE_COLS[index], FOE_ROW);
    h.debug.setFoeTravel(id, false);
    h.debug.setFoeMind(id, false);
  });

  // A posed draw of each kind, so no posed field reads null.
  h.debug.setNextFoeEntry("glitch", 0, 9);
  h.debug.setNextFoeEntry("dropper", 5, 0);
  h.debug.setNextFoeEntry("corruptor", COLS - 1, 2);
  h.debug.setNextWormEntry("left");

  // The fuse: a critical node with a charged neighbour, and a bolt under it.
  h.debug.setNode(FUSE_C, FUSE_R, CHARGE_MAX);
  h.debug.setNode(NEIGHBOUR_C, FUSE_R, 1);
  poseBolt(h, tileCX(FUSE_C), tileCY(BOLT_R));

  const fired = await h.until((s) => s.arcs.length > 0, {
    maxFrames: ticksFor(FUSE_ALLOWANCE),
  });
  assertTrue(
    fired.hit,
    `a discharge to be arcing within ${FUSE_ALLOWANCE} s of the bolt being ` +
      `placed under the critical node on tile (${FUSE_C}, ${FUSE_R}) — arcs ` +
      `is reported for ARC_LIFE (${ARC_LIFE} s) after a detonation ` +
      `(specs/discharge.md), and this point cannot read one that never fired`,
  );

  // A second bolt, placed inside that window so a bolt is in flight at the same
  // instant the arcs are. The fuse bolt resolved against the node it detonated.
  poseBolt(h, tileCX(CLEAR_C), tileCY(BOLT_R));

  await h.advance(1);
  // Before the assertions, so a failing check still leaves the picture of the
  // board every reported field was read from.
  captureStill(h, "posed");

  const s = h.snapshot();

  assertEqual(s.version, WIREWORM_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(PHASES, s.phase, "snapshot().phase");
  assertEqual(typeof s.phaseTimer, "number", "snapshot().phaseTimer");
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  assertEqual(typeof s.score, "number", "snapshot().score");
  assertEqual(typeof s.lives, "number", "snapshot().lives");
  assertEqual(typeof s.level, "number", "snapshot().level");
  assertEqual(typeof s.reachedLevel, "number", "snapshot().reachedLevel");
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  assertEqual(typeof s.foeSpawning, "boolean", "snapshot().foeSpawning");
  assertEqual(typeof s.wormEntry, "boolean", "snapshot().wormEntry");
  assertEqual(
    typeof s.glitchTimer,
    "number",
    "snapshot().glitchTimer, the level's glitch clock in seconds (specs/foes.md)",
  );
  assertEqual(
    typeof s.dropperTimer,
    "number",
    "snapshot().dropperTimer, the dropper's check clock in seconds",
  );
  assertEqual(
    typeof s.corruptorTimer,
    "number",
    "snapshot().corruptorTimer, the level's corruptor clock in seconds",
  );
  assertContains(
    EDGES,
    s.nextWormEntry,
    "snapshot().nextWormEntry, the posed edge",
  );
  assertTile(s.nextGlitchEntry, "snapshot().nextGlitchEntry, the posed tile");
  assertTile(s.nextDropperEntry, "snapshot().nextDropperEntry, the posed tile");
  assertTile(
    s.nextCorruptorEntry,
    "snapshot().nextCorruptorEntry, the posed tile",
  );
  assertEqual(
    typeof s.wormStepInterval,
    "number",
    "snapshot().wormStepInterval, derived from level (specs/worm.md)",
  );
  assertEqual(
    typeof s.wormLength,
    "number",
    "snapshot().wormLength, derived from level (specs/worm.md)",
  );
  assertEqual(typeof s.cursor.x, "number", "snapshot().cursor.x");
  assertEqual(typeof s.cursor.y, "number", "snapshot().cursor.y");
  assertEqual(
    typeof s.cursor.invulnerable,
    "number",
    "snapshot().cursor.invulnerable, which is SECONDS remaining",
  );
  assertEqual(typeof s.cursor.contact, "boolean", "snapshot().cursor.contact");
  assertEqual(typeof s.fireCooldown, "number", "snapshot().fireCooldown");
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");

  // The rosters, each read off a real entry rather than off an empty array.
  assertGreaterThan(
    s.nodes.length,
    0,
    "the nodes on the board, of which this scenario posed several",
  );
  for (const node of s.nodes) {
    assertTile(node, "snapshot().nodes[]");
    assertEqual(typeof node.charge, "number", "snapshot().nodes[].charge");
  }

  assertEqual(
    s.worms.length,
    WORM_COLS.length,
    "the worms on the board, of which this scenario posed two",
  );
  for (const worm of s.worms) {
    assertEqual(typeof worm.id, "number", "snapshot().worms[].id");
    assertGreaterThan(
      worm.segments.length,
      0,
      "snapshot().worms[].segments, of which segments[0] is the head",
    );
    for (const segment of worm.segments) {
      assertTile(segment, "snapshot().worms[].segments[]");
    }
    assertEqual(typeof worm.dh, "number", "snapshot().worms[].dh");
    assertEqual(typeof worm.dv, "number", "snapshot().worms[].dv");
    assertEqual(typeof worm.diving, "boolean", "snapshot().worms[].diving");
    assertEqual(typeof worm.stepping, "boolean", "snapshot().worms[].stepping");
    assertEqual(typeof worm.body, "boolean", "snapshot().worms[].body");
  }

  assertEqual(
    s.foes.length,
    KINDS.length,
    "the foes on the board, of which this scenario posed one of each kind",
  );
  for (const foe of s.foes) {
    assertEqual(typeof foe.id, "number", "snapshot().foes[].id");
    assertContains(KINDS, foe.kind, "snapshot().foes[].kind");
    assertEqual(typeof foe.x, "number", "snapshot().foes[].x");
    assertEqual(typeof foe.y, "number", "snapshot().foes[].y");
    assertEqual(typeof foe.vx, "number", "snapshot().foes[].vx");
    assertEqual(typeof foe.vy, "number", "snapshot().foes[].vy");
    assertEqual(typeof foe.hit, "boolean", "snapshot().foes[].hit");
    assertEqual(typeof foe.mind, "boolean", "snapshot().foes[].mind");
    assertEqual(typeof foe.travel, "boolean", "snapshot().foes[].travel");
  }

  assertGreaterThan(
    s.bolts.length,
    0,
    "the bolts in flight, of which this scenario placed one inside the arcs " +
      "window",
  );
  for (const bolt of s.bolts) {
    assertEqual(typeof bolt.id, "number", "snapshot().bolts[].id");
    assertEqual(typeof bolt.x, "number", "snapshot().bolts[].x");
    assertEqual(typeof bolt.y, "number", "snapshot().bolts[].y");
  }

  assertGreaterThan(
    s.arcs.length,
    0,
    `the links the live discharge is arcing along, still inside the ARC_LIFE ` +
      `(${ARC_LIFE} s) window one frame after it fired`,
  );
  for (const arc of s.arcs) {
    assertTile(arc.from, "snapshot().arcs[].from");
    assertTile(arc.to, "snapshot().arcs[].to");
  }
});
