// runs/completion-check-is-last-at-the-boundary — the completion test reads a
// finished boundary, not a half-finished one.
//
// THE RULE. "Boundary. Motes are at rest on hex centers again. The boundary
// sequence runs: the sigil phase, then sets, then rises, then the area bank, then
// the completion check" (`specs/simulation.md`, One cycle runs in this order).
// The area bank's own paragraph repeats the last two: "After every boundary, the
// settle included, it takes the hex of every mote and of every gripper, BEFORE
// THAT BOUNDARY'S COMPLETION CHECK READS IT" (Completion and metrics). So at the
// boundary that completes a run, everything upstream has already happened: the
// sigils have acted, the sets have consumed, the rises have spawned, and the bank
// holds what those left behind.
//
// THE CONFIGURATION puts one observable consequence on each of the four steps,
// and nothing else on the field:
//
//   * the SIGIL PHASE — a `wane` at `(0, -3)` with a `comet` resting on its seat,
//     which "becomes `dust`" (`specs/sigils.md`);
//   * the SETS — a `set` at `(3, 0)` with a lone `sol` on its footprint and the
//     tally posed at `CONSTELLATION_TARGET - 1`, so consuming it is what completes
//     the run;
//   * the RISES — a `rise` at `(-3, 0)` whose footprint is emptied beforehand, so
//     it spawns a fresh `sol` at this very boundary;
//   * the AREA BANK — a loose `sol` on the bare hex `(0, 3)`, which belongs to no
//     part and was spawned after the settle, so this boundary is the first that
//     can bank it.
//
// The four are far enough apart that no motion, no sigil and no set reaches
// across, and nothing on the field moves at all.
//
// THE VERDICT is that at the completing boundary all four have happened: the
// `comet` is `dust`, the set's footprint is bare and its tally is the target, a
// fresh `sol` rests on the rise's footprint, and the banked `area` has grown by
// exactly ONE over what the run had banked before the boundary — the bare hex
// `(0, 3)`, which only this boundary's bank could have added. The reading is a
// difference rather than an absolute count, so what it decides is that the bank
// ran BEFORE the completion check rather than what the bank is seeded with, which
// is another point's business. A build whose completion test fired before the
// bank reports the same area it opened with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { at } from "../field";
import { risePart, setPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openRun,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** The rise's anchor, and so its one footprint hex. */
const RISE_AT = at(-3, 0);

/** The set's anchor, and so its one footprint hex. */
const SET_AT = at(3, 0);

/** The `wane` sigil's seat. */
const SEAT = at(0, -3);

/** A bare hex, on no part, where the witness mote rests. */
const BARE_HEX = at(0, 3);

/**
 * Three parts, three hexes: the bank takes exactly `RISE_AT`, `SET_AT` and
 * `SEAT` at the start of the run, and nothing has a gripper or a fixture.
 */
const MACHINE = solution([
  risePart(0, RISE_AT.q, RISE_AT.r),
  setPart(0, SET_AT.q, SET_AT.r),
  sigilPart("wane", SEAT.q, SEAT.r, 0),
]);

/** What this boundary's bank adds: the one bare hex the witness rests on. */
const BANKED_AT_THE_BOUNDARY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes on a boundary whose sigils, sets, rises and bank have all already run", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });

  // The settle already spawned the rise's reagent; take it off so this boundary's
  // rise is the one the check reads.
  const settled = await h.snapshot();
  const spawned = moteAt(settled, RISE_AT);
  assertNotNull(
    spawned,
    "the settle's rise spawned the reagent on the rise's footprint",
  );
  await h.debug.removeMote(spawned?.id ?? -1);

  await spawnMote(h, SET_AT, "sol");
  await spawnMote(h, SEAT, "comet");
  await spawnMote(h, BARE_HEX, "sol");
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);

  const before = await h.snapshot();
  assertNull(
    moteAt(before, RISE_AT),
    "the rise's footprint is vacant, so it will spawn",
  );
  assertEqual(
    moteAt(before, SEAT)?.type,
    "comet",
    "the wane's seat holds an essence",
  );
  assertEqual(
    moteAt(before, SET_AT)?.type,
    "sol",
    "the set's footprint holds its product",
  );
  assertEqual(
    before.sim?.status,
    "running",
    "the run is live before the boundary",
  );
  const opened = before.sim?.area ?? -1;

  await captureReplay(h, "ordering", () => advanceCycles(h, 1));

  const after = await h.snapshot();
  assertNotNull(
    after.sim,
    "the run is still reported at the completing boundary",
  );
  assertEqual(
    after.sim?.status,
    "complete",
    "the delivery brought the tally to the target, so this boundary completes the run",
  );
  assertEqual(
    tallyOf(after, 0),
    CONSTELLATION_TARGET,
    "the sets ran at this boundary: the tally reached the target",
  );
  assertNull(
    moteAt(after, SET_AT),
    "the sets ran at this boundary: the product was consumed",
  );
  assertEqual(
    moteAt(after, SEAT)?.type,
    "dust",
    "the sigil phase ran at this boundary: wane turned the comet to dust",
  );
  assertEqual(
    moteAt(after, RISE_AT)?.type,
    "sol",
    "the rises ran at this boundary: the reagent is back on the rise's footprint",
  );
  assertEqual(
    after.sim?.area,
    opened + BANKED_AT_THE_BOUNDARY,
    "the area bank ran at this boundary: it took the bare hex the witness rests on",
  );
  assertEqual(
    after.sim?.metrics?.area,
    opened + BANKED_AT_THE_BOUNDARY,
    "and the completion check read the bank after it had taken that hex",
  );
});
