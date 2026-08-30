// press/build-phase-only-actions — a stamp, a keep, a downgrade and a dismantle
// all do nothing during a live wave.
//
// `specs/scrap-press.md` lists exactly those four as build-phase actions, and
// `specs/controls.md` draws each disabled in its slot while a wave runs. The rule
// underneath is `specs/pathing.md`'s: nothing available during a live wave
// changes a tile's state, so a wave walks the maze it started with. Every one of
// these four would change one — a stamp adds a wall, a dismantle removes one, and
// a harvest hardens whatever is left — under a Load already walking.
//
// FOUR ACTIONS, ONE READING. The yard is photographed before them and compared
// against itself afterwards: the same structures, each the same kind at the same
// type and tier, the same stamp allowance, and nothing on the cursor. Each is
// reached through the surface AND through the control a player would press, so a
// build that guards one path and not the other is caught on whichever it left
// open.

import { afterEach, beforeEach, it } from "vitest";

import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  pressAction,
  releaseUnit,
  standCandidate,
  standComponent,
  type FoundrySnapshot,
  type Harness,
} from "../harness";

/** Where the candidate and the component stand. */
const CANDIDATE_AT = { col: 20, row: 10 };
const COMPONENT_AT = { col: 24, row: 10 };

/** A clear anchor the refused stamp is aimed at. */
const STAMP_AT = { col: 28, row: 10 };

/** What a build-phase action must leave exactly as it found it. */
function yardOf(s: FoundrySnapshot): unknown {
  return {
    stampsLeft: s.stampsLeft,
    held: s.held.active,
    structures: s.structures.map((structure) => ({
      id: structure.id,
      kind: structure.kind,
      type: structure.type,
      quality: structure.quality,
      col: structure.col,
      row: structure.row,
    })),
  };
}

/**
 * Take an action the wave is entitled to refuse.
 *
 * `specs/instrumentation.md` leaves an operation two conformant answers when its
 * subject is not in the condition it states: refuse and do nothing, or fail
 * loudly. What this point decides is the yard either answer leaves behind, and a
 * pose that throws leaves the engine's state exactly as it was.
 */
function attempt(act: () => void): void {
  try {
    act();
  } catch {
    // The loud refusal, which is the other conformant answer.
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the yard untouched across all four during a wave", async () => {
  openYard(h, { wave: 1 });
  const candidate = standCandidate(
    h,
    "coil",
    3,
    CANDIDATE_AT.col,
    CANDIDATE_AT.row,
  );
  const component = standComponent(
    h,
    "capacitor",
    1,
    COMPONENT_AT.col,
    COMPONENT_AT.row,
  );

  // Into a live wave without committing the level's harvest, so the four actions
  // are refused for the phase rather than for want of anything to act on.
  releaseUnit(h, "mote", { frozen: true });
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.phase,
    "wave",
    "the phase the released unit put the run in",
  );

  const readings = await captureReplay(h, "refused", async () => {
    const taken: { action: string; yard: unknown }[] = [];
    const record = async (action: string): Promise<void> => {
      await h.advance(12);
      taken.push({ action, yard: yardOf(h.snapshot()) });
    };

    await pressAction(h, "stamp");
    attempt(() => h.debug.placeRock(STAMP_AT.col, STAMP_AT.row));
    await record("a stamp");

    attempt(() => h.debug.select(candidate));
    attempt(() => h.debug.keep(candidate));
    await record("a keep");

    attempt(() => h.debug.downgrade(candidate));
    await record("a downgrade");

    attempt(() => h.debug.select(component));
    attempt(() => h.debug.dismantle(component));
    await record("a dismantle");

    return taken;
  });

  const untouched = yardOf(before);
  for (const reading of readings) {
    assertDeepEqual(
      reading.yard,
      untouched,
      `the yard after ${reading.action} during a live wave, against the yard ` +
        `the wave started with`,
    );
  }
});
