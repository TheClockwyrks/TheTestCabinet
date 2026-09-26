// runs/bank-takes-motes-at-every-boundary — every boundary banks the hex of every
// mote, so a mote carried across three hexes leaves all three behind.
//
// THE RULE. "After every boundary, the settle included, it takes the hex of every
// mote and of every gripper" (`specs/simulation.md`, Completion and metrics).
// EVERY mote, not only the ones a gripper is on — a carried constellation "moves
// as one rigid body: every mote of it follows the motion, and at `t = 1` every
// mote lands exactly on a hex center" (Motion and carrying).
//
// THE CONFIGURATION SEPARATES A MOTE'S HEXES FROM A GRIPPER'S. One `arm` at the
// origin, rotation `0`, length `1`, whose tape is a single `rotate-cw`, so it
// turns one step about its base every cycle. What it holds is a constellation of
// TWO motes joined by a filament: the held mote on the gripper's hex `(1, 0)`,
// and a second mote one hex further out on `(2, 0)`. The hold is given through
// the gate `specs/instrumentation.md` names, "`setGrip`, which takes hold with no
// `grab` ever running".
//
// The pair rotates rigidly about the anchor, so over three cycles the gripper
// visits three hexes at radius one and the OUTER mote visits three hexes at
// radius two — `(0, 2)`, `(-2, 2)` and `(-2, 0)` — which no gripper ever reaches
// and which nothing else on the field could have banked. A bank that took only
// grippers is three hexes short.
//
// THE EXPECTED HEXES ARE COMPUTED FROM `specs/field.md`'s own rotation, through
// `field.ts`'s `rotateAbout`, and the outer mote's hex is read back at every
// boundary against it, so the figure belongs to a rotation that really happened.
//
// THE VERDICT. `area` is the count of everything the machine touched: the anchor,
// the four hexes the gripper rested on, and the three the outer mote landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { at, rotateAbout, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** One arm that turns one step clockwise about its base every cycle. */
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
]);

/** The held mote's hex, the outer mote's hex, and the spoke the grip is on. */
const HELD_HEX = at(1, 0);
const OUTER_HEX = at(2, 0);
const SPOKE = 0;

/** How many cycles the pair is carried through. */
const CYCLES = 3;

const key = (hex: Hex): string => `${hex.q},${hex.r}`;

/** Where each of the two motes rests at boundary `n`, by the rotation of `specs/field.md`. */
const heldAt = (n: number): Hex => rotateAbout(HELD_HEX, ORIGIN, n);
const outerAt = (n: number): Hex => rotateAbout(OUTER_HEX, ORIGIN, n);

/** The anchor and every hex the gripper rests on: the bank without the motes. */
const WITHOUT_MOTES = new Set([
  key(ORIGIN),
  ...Array.from({ length: CYCLES + 1 }, (_, n) => key(heldAt(n))),
]);

/** The same, plus the three hexes the outer mote came to rest on. */
const WITH_MOTES = new Set([
  ...WITHOUT_MOTES,
  ...Array.from({ length: CYCLES }, (_, n) => key(outerAt(n + 1))),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("banks the hex of a carried mote at every boundary, gripper or no gripper", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[0] ?? -1;
  const held = await spawnMote(h, HELD_HEX, "sol");
  const outer = await spawnMote(h, OUTER_HEX, "sol");
  await h.debug.linkMotes(held, outer, 1);
  await takeGrip(h, arm, SPOKE, held);

  const seen = await captureReplay(h, "trail", async () => {
    const boundaries: OrrerySnapshot[] = [];
    for (let n = 0; n < CYCLES; n += 1) {
      await advanceCycles(h, 1);
      boundaries.push(await h.snapshot());
    }
    return boundaries;
  });

  assertGreaterThan(
    WITH_MOTES.size,
    WITHOUT_MOTES.size,
    "the outer mote rests on hexes no gripper of this machine ever reaches, which is what makes the reading below about motes",
  );

  for (const [n, snapshot] of seen.entries()) {
    assertNotNull(snapshot.sim, `the run is still live at boundary ${n + 1}`);
    assertEqual(
      snapshot.sim?.status,
      "running",
      `nothing faults at boundary ${n + 1}: the pair turns rigidly and nothing else is on the field`,
    );
    const rested = moteById(snapshot, outer);
    assertNotNull(
      rested,
      `the outer mote is still on the field at boundary ${n + 1}`,
    );
    assertEqual(
      rested === null ? null : key(rested),
      key(outerAt(n + 1)),
      `the outer mote follows the rotation, so at boundary ${n + 1} it rests where specs/field.md's rotation puts it`,
    );
  }

  const last = seen[seen.length - 1] as OrrerySnapshot;
  assertEqual(
    last.sim?.area,
    WITH_MOTES.size,
    "after every boundary the bank takes the hex of every mote, so a mote carried across three hexes over three cycles leaves all three hexes in the bank",
  );
});
