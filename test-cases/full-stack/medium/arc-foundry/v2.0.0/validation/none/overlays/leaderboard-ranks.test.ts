// overlays/leaderboard-ranks — the board ranks by damage dealt, and follows it.
//
// `specs/hud.md`: the damage leaderboard is "a read-only overlay ranking the
// player's firing structures by total damage dealt, updating live as a wave runs,
// and showing each structure's kills". `specs/components.md` keeps those two
// tallies on every firing structure, and `specs/instrumentation.md` reports them
// as `damageDealt` and `kills`.
//
// THE ARRANGEMENT. Three structures of three different types, far enough apart
// that no unit is ever in two of their ranges: a Capacitor at Scrap, a Discharge
// Rig at Charged, and an Emitter at Scrap. Each is given one unit inside its own
// range and no other, posed to exactly the health one of that structure's shots
// removes — so each structure kills once and its tally is its shot's damage
// exactly, with no question of what an overkill counts as. The Discharge Rig's
// `162` then leads the Capacitor's `6` and the Emitter's `2`.
//
// THE ORDER CHANGING LIVE. A second unit is then parked in the Emitter's range
// with the health its wave gives it, so nothing kills it and the Emitter's four
// and a half shots a second climb past the Capacitor's one kill. The board has to
// re-rank without anything else about the run changing.
//
// A row is found by the type it names, because a rank a player cannot attach to
// a structure ranks nothing. `specs/components.md` gives every type both a Type
// (`Discharge Rig`, as `../constants` spells it) and an Identifier (`discharge`),
// and `specs/hud.md` fixes the board's ranking, its live update and its kills
// without fixing a row's copy, so a row naming the type by either is read. The
// identifier is a bare word a caption might also carry, so it is only read off
// a line that carries a figure, as every row does; the three Type names are
// drawn nowhere else on the stage while the selection is clear.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertGreaterThan,
  assertNotEqual,
  fail,
} from "../assert";
import {
  captureReplay,
  createHarness,
  type DrawCall,
  figures,
  type Harness,
  openYard,
  parkUnit,
  reads,
  type Region,
  standComponent,
  structureById,
  textLines,
} from "../harness";
import {
  COMPONENT_NAMES,
  componentDamage,
  type ComponentType,
  STAGE_H,
  STAGE_W,
  structureCenter,
} from "../constants";

/** Deep enough that a unit only dies when its health is posed to one shot's worth. */
const WAVE = 30;
/** The overlay covers the stage, so the whole of it is read. */
const OVERLAY: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: STAGE_H };

interface Gun {
  type: ComponentType;
  tier: 1 | 3;
  col: number;
  row: number;
}

const GUNS: readonly Gun[] = [
  { type: "capacitor", tier: 1, col: 10, row: 10 },
  { type: "discharge", tier: 3, col: 40, row: 10 },
  { type: "emitter", tier: 1, col: 25, row: 25 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A point inside one gun's range and outside every other gun's. */
function inRangeOf(gun: Gun): { x: number; y: number } {
  const center = structureCenter(gun.col, gun.row);
  return { x: center.x + 50, y: center.y };
}

/**
 * Whether a line of the board names that type: by the Type `specs/components.md`
 * gives it, or, on a line carrying a figure, by its Identifier.
 */
function namesType(line: string, type: ComponentType): boolean {
  return (
    reads(line, COMPONENT_NAMES[type]) || (/\d/.test(line) && reads(line, type))
  );
}

/** The types the board named, in the order it drew them, top first. */
function ranked(calls: readonly DrawCall[]): ComponentType[] {
  const lines = textLines(calls, OVERLAY);
  const placed = GUNS.map((gun) => ({
    type: gun.type,
    at: lines.findIndex((line) => namesType(line, gun.type)),
  }));
  for (const one of placed) {
    if (one.at < 0) {
      fail(
        `the damage leaderboard to name the ${one.type} it is ranking`,
        lines,
      );
    }
  }
  return placed.sort((a, b) => a.at - b.at).map((one) => one.type);
}

it("ranks three structures by damage dealt, and re-ranks as they earn", async () => {
  await openYard(h, { wave: WAVE });
  const ids = new Map<ComponentType, number>();
  for (const gun of GUNS) {
    ids.set(
      gun.type,
      await standComponent(h, gun.type, gun.tier, gun.col, gun.row),
    );
  }
  await h.debug.clearSelection();
  await h.debug.setOverlay("damage", true);

  const seen = await captureReplay(h, "board", async () => {
    // One kill each, at exactly one shot's damage, so no tally is an overkill.
    for (const gun of GUNS) {
      await parkUnit(h, "mote", inRangeOf(gun), {
        hp: componentDamage(gun.type, gun.tier),
      });
    }
    await h.advanceSeconds(3);
    const early = await h.frameCalls();
    const earlyState = await h.snapshot();

    // A unit the Emitter cannot kill, so its cadence carries it past the Capacitor.
    await parkUnit(h, "mote", inRangeOf(GUNS[2]!));
    await h.advanceSeconds(3);
    const late = await h.frameCalls();
    const lateState = await h.snapshot();
    return { early, earlyState, late, lateState };
  });

  for (const [when, calls, state] of [
    ["after one kill each", seen.early, seen.earlyState],
    ["once the Emitter has earned", seen.late, seen.lateState],
  ] as const) {
    const tallies = GUNS.map((gun) => ({
      type: gun.type,
      structure: structureById(state, ids.get(gun.type)!),
    }));
    const sorted = [...tallies].sort(
      (a, b) => b.structure.damageDealt - a.structure.damageDealt,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      assertGreaterThan(
        sorted[i - 1]!.structure.damageDealt,
        sorted[i]!.structure.damageDealt,
        `the damage the ${sorted[i - 1]!.type} had dealt ${when}, against the ` +
          `${sorted[i]!.type}'s, which the ranking has to separate`,
      );
    }

    assertDeepEqual(
      ranked(calls),
      sorted.map((one) => one.type),
      `the order the damage leaderboard drew its rows in, ${when}`,
    );

    const drawn = figures(calls, OVERLAY);
    for (const one of tallies) {
      assertContains(
        drawn,
        one.structure.kills,
        `the leaderboard's figures ${when}, for the ${one.type}'s kills`,
      );
      const damage = one.structure.damageDealt;
      assertGreaterThan(
        drawn.filter((f) => Math.abs(f - damage) <= 1).length,
        0,
        `how many of the leaderboard's figures ${when} read as the ` +
          `${one.type}'s ${damage} damage dealt; it drew ${drawn.join(", ")}`,
      );
    }
  }

  assertNotEqual(
    ranked(seen.late).join(" > "),
    ranked(seen.early).join(" > "),
    "the order the leaderboard draws once the Emitter has out-earned the " +
      "Capacitor, against the order it drew before",
  );
});
