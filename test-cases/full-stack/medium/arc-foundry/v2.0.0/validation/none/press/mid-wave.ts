// press — the live wave the four build-phase actions are refused in.
// CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// `specs/scrap-press.md` lists a stamp, a keep, a downgrade and a dismantle as
// build-phase actions, and `specs/controls.md` draws each disabled in its slot
// while a wave runs. The rule underneath is `specs/pathing.md`'s: nothing
// available during a live wave changes a tile's state, so a wave walks the maze it
// started with. Every one of the four would change one — a stamp adds a wall, a
// dismantle removes one, and a harvest hardens whatever is left — under a Load
// already walking.
//
// FOUR ACTIONS, FOUR POINTS. A build that refuses a mid-wave stamp and happily
// dismantles must not grade the same as one that refuses none of them, so each
// action is decided by name. What they share is this file: the yard, the reading
// taken off it, and the wave they are attempted in.

import { assertEqual } from "../assert";
import {
  holdWaveOpen,
  openYard,
  standCandidate,
  standComponent,
  type FoundrySnapshot,
  type Harness,
} from "../harness";

/** Where the candidate and the component stand. */
export const CANDIDATE_AT = { col: 20, row: 10 };
export const COMPONENT_AT = { col: 24, row: 10 };

/** A clear anchor a refused stamp is aimed at. */
export const STAMP_AT = { col: 28, row: 10 };

/** What a build-phase action must leave exactly as it found it. */
export function yardOf(s: FoundrySnapshot): unknown {
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

/** The two structures a refused action is aimed at. */
export interface MidWave {
  candidate: number;
  component: number;
  before: unknown;
}

/**
 * Stand one candidate and one component, then open a live wave over them.
 *
 * The wave is posed rather than released into, so the yard holds only the two
 * structures the four points act on: what is decided is the phase, and nothing
 * walking is needed to establish it. The wave's own clear-and-pay resolution is
 * held, so an empty schedule cannot end it mid-reading.
 */
export async function openMidWave(h: Harness): Promise<MidWave> {
  await openYard(h, { wave: 1 });
  const candidate = await standCandidate(
    h,
    "coil",
    3,
    CANDIDATE_AT.col,
    CANDIDATE_AT.row,
  );
  const component = await standComponent(
    h,
    "capacitor",
    1,
    COMPONENT_AT.col,
    COMPONENT_AT.row,
  );

  await holdWaveOpen(h);
  const before = await h.snapshot();
  assertEqual(before.phase, "wave", "the phase the run was posed into");
  return { candidate, component, before: yardOf(before) };
}

/**
 * Take an action the wave is entitled to refuse.
 *
 * `specs/instrumentation.md` leaves an operation two conformant answers when its
 * subject is not in the condition it states: refuse and do nothing, or fail
 * loudly. What each point decides is the yard either answer leaves behind, so the
 * yard is read back after the call and the reading is what decides.
 */
export async function attempt(act: () => Promise<void>): Promise<void> {
  try {
    await act();
  } catch {
    // The loud refusal, which is the other conformant answer.
  }
}
