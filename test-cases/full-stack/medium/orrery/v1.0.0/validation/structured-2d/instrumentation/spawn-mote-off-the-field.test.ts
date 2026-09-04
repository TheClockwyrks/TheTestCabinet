// instrumentation/spawn-mote-off-the-field — a hex off the field is posed like
// any other.
//
// THE RULE. "A hex off the field is posed like any other, as
// `specs/simulation.md` lets a mote rest off it" (`specs/instrumentation.md`, The
// run). What `specs/simulation.md` lets it do there: "A mote may be carried over,
// dropped on, and rest on a hex off the field. Off the field it collides, is
// grabbed, and is banked exactly as on it". The field is "the hexagonal region of
// radius `FIELD_R` around `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`" (`specs/field.md`), and `FIELD_R` is `5` —
// so `(6, 0)` is off it, and so is the `(5, 1)` the arm carries it to.
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm anchored on `(5, 0)`,
// the last hex of the field on that row, rotation `0` and length `1` — so its
// gripper stands on `(6, 0)`, one hex OFF the field, which is legal because "Only
// motes collide, so a gripper and the drawn arm between base and gripper pass
// over any hex, on or off the field" (`specs/parts.md`). One mote is spawned
// there and nothing else is on the field, so nothing else can be what moved.
//
// THE VERDICT. The mote rests on `(6, 0)`, is drawn on that hex's center by the
// formulas of `specs/field.md` — which place a hex whether or not the field holds
// it — and is grabbed and carried by `rotate-cw` from one off-field hex to the
// next, with the run still running and no fault: exactly as a mote carried off
// the field behaves.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  pauseRun,
  resumeRun,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** One hex east of the field's edge: `max(6, 0, 6)` is past `FIELD_R` (`5`). */
const OUTSIDE = at(6, 0);

/** Where `rotate-cw` about `(5, 0)` carries it: `(1, 0)` turns to `(0, 1)`. */
const CARRIED_TO = at(5, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rests a mote on a hex off the field, and carries it there like any other", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 5, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const mote = await spawnMote(h, OUTSIDE, "dust");
  const posed = await h.snapshot();

  await pauseRun(h);
  await h.advance(1);
  await captureStill(h, "outside");
  await resumeRun(h);

  await takeGrip(h, arm, 0, mote);
  await advanceCycles(h, 1);
  const after = await h.snapshot();

  assertNotNull(posed.sim, "the run is live at the spawn");
  assertLength(
    posed.sim?.motes ?? [],
    1,
    "the off-field hex was posed, so the field holds exactly the one mote",
  );
  const posedMote = moteById(posed, mote);
  assertNotNull(posedMote, "the mote spawned off the field is reported");
  assertEqual(
    `${posedMote?.q},${posedMote?.r}`,
    `${OUTSIDE.q},${OUTSIDE.r}`,
    "the mote rests on the off-field hex the call named",
  );
  assertCloseTo(
    posedMote?.x ?? Number.NaN,
    hexCenter(OUTSIDE).x,
    3,
    "an off-field hex is placed by the same formulas as any other, so the mote is drawn on its center",
  );
  assertCloseTo(
    posedMote?.y ?? Number.NaN,
    hexCenter(OUTSIDE).y,
    3,
    "an off-field hex is placed by the same formulas as any other, so the mote is drawn on its center",
  );
  assertNotNull(after.sim, "the run is still live after the cycle");
  assertEqual(
    after.sim?.status,
    "running",
    "carrying a mote across hexes off the field faults nothing",
  );
  assertNull(after.sim?.fault ?? null, "no fault is raised off the field");
  assertEqual(
    `${moteById(after, mote)?.q},${moteById(after, mote)?.r}`,
    `${CARRIED_TO.q},${CARRIED_TO.r}`,
    "the off-field mote was grabbed and carried by the sweep, exactly as a mote on the field is",
  );
});
