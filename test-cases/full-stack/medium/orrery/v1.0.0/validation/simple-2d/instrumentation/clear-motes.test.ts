// instrumentation/clear-motes — `clearMotes` empties the field of motes, the
// fixtures with them, and takes every filament and every grip with it.
//
// THE RULE. "`clearMotes()` | Removes every mote, fixtures included, and with
// them every filament and every grip. The area bank stands."
// (`specs/instrumentation.md`, The run). A fixture is a mote: "A `wheel` is a hub
// on its anchor hex carrying six fixture motes, one on each adjacent hex"
// (`specs/parts.md`), and the snapshot reports them among `sim.motes`, `wheel`
// naming the wheel each belongs to (`specs/state.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm on it, then a wheel
// placed while the run is live — "a part one of them adds enters the run at its
// rest pose holding nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`) — so the field holds exactly six fixtures. Two
// loose motes are spawned on adjacent hexes and joined by a filament, and the
// arm's gripper is closed on them with `setGrip`, "which takes hold with no
// `grab` ever running". So there is one of everything the call is required to
// remove, and the check reads all four back BEFORE the call: a build that
// cleared nothing because there was nothing to clear decides nothing.
//
// THE VERDICT. After the call `sim.motes`, `sim.filaments` and `sim.grips` are
// all empty. Then one mote is spawned, and the field holds exactly it — which is
// what "a scenario keeps only the motes it spawns afterwards" asks for, and what
// a build that raised the wheel's ring again on the next frame would fail.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, SOUTH, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteById,
  openBareRun,
  partIds,
  placePart,
  spawnConstellation,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the field of motes, fixtures included, and of filaments and grips", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", WEST.q, WEST.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const pair = await spawnConstellation(
    h,
    [
      { hex: at(-2, 0), type: "dust" },
      { hex: at(-2, 1), type: "dust" },
    ],
    [{ a: 0, b: 1 }],
  );
  await takeGrip(h, arm, 0, pair[0] ?? -1);
  const before = await h.snapshot();

  await h.debug.clearMotes();
  const cleared = await h.snapshot();

  const kept = await spawnMote(h, SOUTH, "dust");
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "empty");

  assertNotNull(before.sim, "the run is live before the clear");
  assertLength(
    fixturesOf(before, wheel),
    6,
    "the wheel raised its ring, so there are six fixtures for the clear to remove",
  );
  assertLength(
    looseMotes(before),
    2,
    "two loose motes are on the field for the clear to remove",
  );
  assertLength(
    before.sim?.filaments ?? [],
    1,
    "one filament joins them, so there is a filament for the clear to remove",
  );
  assertLength(
    before.sim?.grips ?? [],
    1,
    "the arm holds their constellation, so there is a grip for the clear to remove",
  );
  assertLength(
    cleared.sim?.motes ?? [],
    0,
    "clearMotes removes every mote, the wheel's fixtures included",
  );
  assertLength(
    cleared.sim?.filaments ?? [],
    0,
    "the filaments go with the motes they joined",
  );
  assertLength(
    cleared.sim?.grips ?? [],
    0,
    "the grips go with the motes they held",
  );
  assertLength(
    after.sim?.motes ?? [],
    1,
    "the field keeps only the mote spawned after the clear",
  );
  assertEqual(
    moteById(after, kept)?.type,
    "dust",
    "and that one mote is the one this check spawned",
  );
});
