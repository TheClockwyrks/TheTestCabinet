// Wireworm — instrumentation/snapshot-shape: `snapshot` reports every field the
// documented shape lists, with the documented type.
//
// specs/instrumentation.md "Snapshot shape" fixes the object `snapshot` returns
// exactly, and the reason it does is stated beside it: every field an operation
// can set is present, so every operation is verifiable by setting a value and
// reading it back. A field that is missing, or that reports a value of another
// type, takes the point the operation behind it would have decided with it.
//
// A SHAPE READ OFF A FULL BOARD, NOT AN EMPTY ONE. Four of the fields are
// rosters, and an empty roster says nothing about the shape of the entries it
// would hold, so the board this reads from carries a node at each of
// specs/nodes.md's four charges, two worms, one foe of each of specs/foes.md's
// three kinds, a bolt still in flight, and a live discharge — the one state in
// which `arcs` is non-empty, since specs/discharge.md reports an arc during the
// `ARC_LIFE` window after a detonation and at no other time.
//
// WHAT IT DOES NOT DECIDE. Only the presence and the type of each field. Whether
// a value is the RIGHT one is the point of whichever item owns the rule behind
// it, so nothing here asserts a charge, a heading, a velocity or a score. The two
// enumerations are held to their stated sets — `screen` and `phase` in
// specs/instrumentation.md, `kind` in specs/foes.md — because "a string" is not
// the documented type of either.
//
// EVERY ENTITY IS POSED QUIET. The two worms have their step gated off and the
// three foes have both faculties gated off, so nothing wanders into the
// discharge while the sweep runs and the board the reading comes off is the board
// that was posed.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseField,
  poseFoe,
  poseWorm,
  startPlaying,
  ticksFor,
  type FoeKind,
  type Harness,
} from "../harness";

/** The six screens and the three phases specs/instrumentation.md enumerates. */
const SCREENS = [
  "title",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
] as const;
const PHASES = ["banner", "active", "respawn"] as const;

/** The three foe kinds specs/foes.md names. */
const FOE_KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/**
 * The four charges of specs/nodes.md, laid along one row well clear of the
 * discharge below, so every one of them is standing when the reading is taken.
 */
const CHARGES_C = 2;
const CHARGES_R = 15;

/**
 * The discharge: two adjacent critical nodes, and a bolt two rows under the left
 * one with a clear row between. specs/discharge.md detonates the struck node and
 * arcs to every charged node within `DISCHARGE_RADIUS`, so this chain conducts
 * one link and reports one arc.
 */
const CRITICAL_C = 20;
const CRITICAL_R = 10;
const SHOT_R = 12;

/** The column the bolt that must still be in flight climbs: nothing stands in it. */
const FREE_BOLT_C = 35;
const FREE_BOLT_R = 19;

/**
 * How far the sweep to the detonation may run.
 *
 * specs/cursor.md flies a bolt at `BOLT_SPEED` (`900` units per second), so the
 * two tiles between the shot and the critical node take about `0.07` s. Half a
 * second is many times that and still inside the `ARC_LIFE` (`0.32` s) window
 * the arcs live for once they appear, because the sweep stops at the first
 * sample that carries one.
 */
const DETONATION_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, with its documented type", async () => {
  startPlaying(h);

  // A node at each of the four charges.
  poseField(h, ["0123"], CHARGES_C, CHARGES_R);

  // Two worms, held still so the board that is read is the board that was posed.
  for (const row of [3, 5]) {
    const id = poseWorm(h, 8, row, 3);
    h.debug.setWormStepping(id, false);
  }

  // One foe of each kind, with both faculties gated off so none of them travels,
  // eats, lays or slams while the sweep runs.
  FOE_KINDS.forEach((kind, index) => {
    const id = poseFoe(h, kind, 4 + index * 6, 7);
    h.debug.setFoeMind(id, false);
    h.debug.setFoeTravel(id, false);
  });

  // A bolt that is still climbing an empty column when the reading is taken, so
  // `bolts` is not the empty array.
  poseBolt(h, FREE_BOLT_C, FREE_BOLT_R);

  // And the discharge, whose arcs are the only way `arcs` is ever non-empty.
  h.debug.setNode(CRITICAL_C, CRITICAL_R, 3);
  h.debug.setNode(CRITICAL_C + 1, CRITICAL_R, 3);
  poseBolt(h, CRITICAL_C, SHOT_R);

  const swept = await h.until((s) => s.arcs.length > 0, {
    maxFrames: DETONATION_TICKS,
  });
  // The board every reported field was read from, at the instant it was read.
  captureStill(h, "posed");
  assertTrue(
    swept.hit,
    `a bolt into a critical node must detonate it and report the arcs the ` +
      `chain conducted along, which last ${String(ARC_LIFE)} s ` +
      "(specs/discharge.md)",
  );

  const snapshot = swept.snapshot;

  // ---- The scalars ------------------------------------------------------

  assertEqual(typeof snapshot.version, "number", "version");
  assertContains(SCREENS, snapshot.screen, "screen");
  assertContains(PHASES, snapshot.phase, "phase");
  assertEqual(typeof snapshot.phaseTimer, "number", "phaseTimer");
  assertEqual(typeof snapshot.menuIndex, "number", "menuIndex");
  assertEqual(typeof snapshot.score, "number", "score");
  assertEqual(typeof snapshot.lives, "number", "lives");
  assertEqual(typeof snapshot.level, "number", "level");
  assertEqual(typeof snapshot.reachedLevel, "number", "reachedLevel");
  assertEqual(typeof snapshot.muted, "boolean", "muted");
  assertEqual(typeof snapshot.foeSpawning, "boolean", "foeSpawning");
  assertEqual(typeof snapshot.wormEntry, "boolean", "wormEntry");
  assertEqual(typeof snapshot.wormStepInterval, "number", "wormStepInterval");
  assertEqual(typeof snapshot.wormLength, "number", "wormLength");
  assertEqual(typeof snapshot.fireCooldown, "number", "fireCooldown");
  assertEqual(typeof snapshot.simTime, "number", "simTime");

  // ---- The cursor -------------------------------------------------------

  assertHasProperty(snapshot, "cursor", "cursor");
  assertEqual(typeof snapshot.cursor.x, "number", "cursor.x");
  assertEqual(typeof snapshot.cursor.y, "number", "cursor.y");
  assertEqual(
    typeof snapshot.cursor.invulnerable,
    "number",
    "cursor.invulnerable",
  );
  assertEqual(typeof snapshot.cursor.contact, "boolean", "cursor.contact");

  // ---- The rosters ------------------------------------------------------

  assertGreaterThan(
    snapshot.nodes.length,
    0,
    "nodes, on a board carrying them",
  );
  for (const node of snapshot.nodes) {
    assertEqual(typeof node.c, "number", "a node's c");
    assertEqual(typeof node.r, "number", "a node's r");
    assertEqual(typeof node.charge, "number", "a node's charge");
  }

  assertGreaterThan(
    snapshot.worms.length,
    0,
    "worms, on a board carrying them",
  );
  for (const worm of snapshot.worms) {
    assertEqual(typeof worm.id, "number", "a worm's id");
    assertGreaterThan(worm.segments.length, 0, "a worm's segments");
    for (const tile of worm.segments) {
      assertEqual(typeof tile.c, "number", "a segment's c");
      assertEqual(typeof tile.r, "number", "a segment's r");
    }
    assertEqual(typeof worm.dh, "number", "a worm's dh");
    assertEqual(typeof worm.dv, "number", "a worm's dv");
    assertEqual(typeof worm.diving, "boolean", "a worm's diving");
    assertEqual(typeof worm.stepping, "boolean", "a worm's stepping");
    assertEqual(typeof worm.body, "boolean", "a worm's body");
  }

  assertGreaterThan(snapshot.foes.length, 0, "foes, on a board carrying them");
  for (const foe of snapshot.foes) {
    assertEqual(typeof foe.id, "number", "a foe's id");
    assertContains(FOE_KINDS, foe.kind, "a foe's kind");
    assertEqual(typeof foe.x, "number", "a foe's x");
    assertEqual(typeof foe.y, "number", "a foe's y");
    assertEqual(typeof foe.vx, "number", "a foe's vx");
    assertEqual(typeof foe.vy, "number", "a foe's vy");
    assertEqual(typeof foe.hit, "boolean", "a foe's hit");
    assertEqual(typeof foe.mind, "boolean", "a foe's mind");
    assertEqual(typeof foe.travel, "boolean", "a foe's travel");
  }

  assertGreaterThan(snapshot.bolts.length, 0, "bolts, with one in flight");
  for (const bolt of snapshot.bolts) {
    assertEqual(typeof bolt.id, "number", "a bolt's id");
    assertEqual(typeof bolt.x, "number", "a bolt's x");
    assertEqual(typeof bolt.y, "number", "a bolt's y");
  }

  assertGreaterThan(snapshot.arcs.length, 0, "arcs, during a live discharge");
  for (const arc of snapshot.arcs) {
    assertEqual(typeof arc.from.c, "number", "an arc's from.c");
    assertEqual(typeof arc.from.r, "number", "an arc's from.r");
    assertEqual(typeof arc.to.c, "number", "an arc's to.c");
    assertEqual(typeof arc.to.r, "number", "an arc's to.r");
  }

  // The four charges were still standing when the shape was read, so the node
  // entries above were read off a field carrying every state a node can be in.
  const charges = snapshot.nodes
    .filter((node) => node.r === CHARGES_R)
    .map((node) => node.charge)
    .sort();
  assertEqual(
    charges.join(","),
    "0,1,2,3",
    "the four charges specs/nodes.md names, all standing when the shape is read",
  );
});
