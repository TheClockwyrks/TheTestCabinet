// nodes/respawn-keeps-field — the field stands through a lost life and the respawn.
//
// specs/nodes.md: "Losing a life does not reset it. Every node and its charge
// survive the respawn unchanged, while the worms and the foes do not."
// specs/progression.md states the same from the run's side, in what a contact with
// lives to spare does: "Every worm, every foe, and every bolt in flight is removed
// from the board. The node field stands exactly as it was."
//
// THE FIELD IS POSED WITH ALL FOUR CHARGES on twelve tiles, so a build that keeps
// the tiles and drops the charges, keeps the charges and drops some tiles, or lays
// a fresh scatter over the top of it — the scatter is `SCATTER_MIN_FRACTION` of
// `680` tiles, at least sixty-eight of them, all inert — all read back as
// something different from what was posed. The tiles are inside the scatter rows
// and nowhere near the player band, so nothing the contact itself does reaches
// them.
//
// THE CONTACT IS THE REAL ONE. specs/cursor.md: "A worm segment reaches the cursor
// when the segment's tile overlaps the cursor's box." So a one-segment worm is
// posed on the tile the band's centre stands on, its step faculty off — it is the
// thing that touches the cursor, not a thing that travels — and the cursor's
// contact gate, which `startPlaying` shuts, is opened for exactly this point,
// which is the one whose requirement the gate is. The cursor carries no
// invulnerability, and the run is posed with its full `START_LIVES`, so
// specs/progression.md takes the "with lives to spare" branch rather than ending
// the run.
//
// THE READING IS TAKEN AFTER THE RESPAWN COMPLETES, not at the contact, because
// the sentence under test covers the whole of it: the removal, the `RESPAWN_TIME`
// pause, and play resuming. Worm entry stays shut throughout, so the level's worm
// does not re-enter and the field is read against a board holding nothing else.
//
// WHAT THIS DOES NOT DECIDE. That the contact costs a life, empties the rosters,
// re-centres the cursor and grants invulnerability are
// `cursor.worm-contact-costs-life` and the four `progression.respawn-*` points'
// requirements. A build that loses no life holds a field that never changed, and
// is docked there rather than twice.

import { afterEach, beforeEach, it } from "vitest";
import { RESPAWN_TIME, START_LIVES } from "../../src/constants";
import { assertDeepEqual, assertLength } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  poseField,
  poseWorm,
  startPlaying,
  ticksFor,
  tileOf,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/**
 * The field posed, its top-left tile, and how many nodes it holds.
 *
 * Twelve tiles carrying all four charge states, laid inside the scatter rows and
 * far above the player band the contact happens in.
 */
const FIELD = ["0123", "3210", "1032"] as const;
const FIELD_C = 5;
const FIELD_R = 3;
const FIELD_NODES = 12;

/**
 * How long the contact is given to register, in frames.
 *
 * The segment is posed already overlapping the cursor's box, so specs/cursor.md
 * has a conforming build read the contact on the first update. A tenth of a second
 * is the bound, and it is hard: a build that never registers one is read where it
 * stands rather than running the suite out.
 */
const CONTACT_TICKS = ticksFor(0.1);

/**
 * How long the respawn is waited out, in frames.
 *
 * specs/progression.md puts the phase at `respawn` "with its timer at
 * `RESPAWN_TIME`" (`1.4` s), so a conforming build is back at `active` within it.
 * A quarter of a second of slack covers the frame the contact landed on.
 */
const RESPAWN_TICKS = ticksFor(RESPAWN_TIME + 0.25);

/**
 * The field as a sorted list of `"c,r=charge"`, which is what two readings are
 * compared as.
 *
 * Sorted, so the comparison is of the field itself and not of the order the
 * snapshot happened to report it in — the order is fixed by
 * specs/instrumentation.md and read by `instrumentation.snapshot-shape`, and this
 * point should not be a second reading of it.
 */
function field(snapshot: WirewormSnapshot): string[] {
  return snapshot.nodes
    .map((node) => `${node.c},${node.r}=${node.charge}`)
    .sort();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every node and its charge standing through a respawn", async () => {
  startPlaying(h);
  poseField(h, FIELD, FIELD_C, FIELD_R);
  // The pose has to have taken for the comparison to say anything: a surface that
  // could not lay the field fails the point it decides.
  const posed = field(h.snapshot());
  assertLength(posed, FIELD_NODES, "the nodes the pose laid");

  h.debug.setLives(START_LIVES);
  // The tile the band's centre stands on, so the segment's tile overlaps the
  // cursor's box where `startPlaying` parked it.
  const band = tileOf(BAND_CX, BAND_CY);
  const worm = poseWorm(h, band.c, band.r, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setCursorInvulnerable(0);
  h.debug.setCursorContact(true);

  await h.until((s) => s.phase === "respawn", { maxFrames: CONTACT_TICKS });
  await h.until((s) => s.phase === "active", { maxFrames: RESPAWN_TICKS });
  captureStill(h, "kept");

  assertDeepEqual(
    field(h.snapshot()),
    posed,
    "the field standing once play resumes after the respawn",
  );
});
