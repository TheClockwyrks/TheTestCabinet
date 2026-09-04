// sigils/passing-mote-untouched — a sigil acts on what RESTS on its hexes, so a
// mote merely swept across one is not acted on.
//
// THE RULE. A sigil "acts at each boundary, the settle included, in the sigil
// phase `specs/simulation.md` defines, on the motes resting on its hexes"
// (`specs/sigils.md`), and `specs/simulation.md` puts that phase at step 5 of the
// cycle, when "Motes are at rest on hex centers again". A mote in flight at
// `t = 4/8` is resting on nothing; the only hex it rests on at the boundary is the
// one it landed on, and `wane`'s condition is about its own seat: "An essence mote
// on the seat becomes `dust`."
//
// THE CONFIGURATION, quoted from the review item: "an arm at length 2 carrying an
// essence from `(2, 0)` to `(0, 2)` with rotate-cw passes over hex `(1, 1)`, and a
// wane engraved there leaves the essence its own type at that boundary." So: an
// `arm` anchored on `(0, 0)` at rotation `0` and length `2`, whose one gripper
// stands at "`base + length * DIRS[d]`" (`specs/parts.md`) on `(2, 0)`; a `nova`,
// which `specs/field.md` classes an essence, held there; a tape cell of
// `rotate-cw`, under which "The part's direction turns 60 degrees about its base,
// clockwise" and the held constellation takes "The same rotation about the base"
// (`specs/simulation.md`); and one `wane` engraved on `(1, 1)`, whose footprint is
// the single hex `(0, 0)` at rotation `0` and so is that hex alone.
//
// THE SWEEP REALLY CROSSES THE SEAT, and the specification is what says by how
// much. Worked example D of `specs/simulation.md` is this exact sweep — "An arm at
// `(0, 0)`, length 2, carries a mote from `(2, 0)` toward `(0, 2)` with
// `rotate-cw`. A mote rests on `(1, 1)`" — and its table pins the nearest sampled
// approach at "`12.86` at `t = 4/8`", the distance between the carried mote's
// center and the center of `(1, 1)`. Distances there are "in logical units rounded
// to two decimals". So the check stops the run at `t = 4/8` and reads that the
// carried mote is drawn `12.86` from the seat's center: it really is over the
// wane's hex, well inside `MOTE_R` (`22`), before it sweeps away again.
//
// NOTHING COLLIDES, because the carried mote is the only mote on the field: the
// collision rule watches "the distance between the centers of two motes", and
// there is no second one. A sigil is not a mote.
//
// THE VERDICT. At the boundary the essence rests on `(0, 2)`, which is not the
// wane's seat, and it is still `nova`. A build whose sigils act on whatever passes
// over their hexes during a cycle answers `dust`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { FRACTION_TOLERANCE, HEX_PITCH } from "../constants";
import { at, distance, hexCenter } from "../field";
import { armPart, sigilPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** Where the arm stands, and the center its sweep turns about. */
const BASE = at(0, 0);

/** Where the carried essence starts: `base + 2 * DIRS[0]`. */
const FROM = at(2, 0);

/** Where it lands: `(2, 0)` turned one clockwise step, `(q, r) -> (-r, q + r)`. */
const TO = at(0, 2);

/** The wane's seat, the hex the sweep crosses. */
const SEAT = at(1, 1);

/** The arm's length, as the review item states it. */
const LENGTH = 2;

/**
 * The nearest sampled approach worked example D of `specs/simulation.md` records
 * for this sweep against `(1, 1)`, in logical units.
 */
const APPROACH = 12.86;

/**
 * How near that approach must land: the table's own rounding, "rounded to two
 * decimals", with a fraction's worth of the sweep's arc allowed on top.
 */
const APPROACH_TOLERANCE = 0.005 + LENGTH * HEX_PITCH * FRACTION_TOLERANCE;

/** How near a drawn position must land on a hex center. */
const DRAWN_TOLERANCE = HEX_PITCH * FRACTION_TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an essence swept across a wane's seat its own type at the boundary", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", BASE.q, BASE.r, 0, LENGTH, ["rotate-cw"]),
      sigilPart("wane", SEAT.q, SEAT.r, 0),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const essence = await spawnMote(h, FROM, "nova");
  await takeGrip(h, arm, 0, essence);

  await captureReplay(h, "sweep", async () => {
    await advanceFraction(h, 4 / 8);

    const midway = await h.snapshot();
    const flying = moteById(midway, essence);
    assertNotNull(flying, "the carried essence is reported mid-sweep");
    assertNear(
      distance(
        { x: flying?.x ?? Number.NaN, y: flying?.y ?? Number.NaN },
        hexCenter(SEAT),
      ),
      APPROACH,
      APPROACH_TOLERANCE,
      "at t = 4/8 the sweep is 12.86 from the seat's center, so it really passes over the wane's hex",
    );
    assertEqual(
      flying?.type,
      "nova",
      "mid-cycle the essence is in flight, resting on no hex at all",
    );

    await advanceFraction(h, 4 / 8);
  });

  const snapshot = await h.snapshot();
  const sim = snapshot.sim;
  assertNotNull(sim, "the run is live through the cycle");
  assertEqual(
    sim?.status,
    "running",
    "one mote alone on the field can collide with nothing, so the cycle reaches its boundary",
  );
  assertNull(sim?.fault ?? null, "no fault is raised by the sweep");
  assertEqual(sim?.cycle, 1, "the cycle reached its boundary");
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a completed cycle leaves the fraction on the boundary it reached",
  );

  const landed = moteById(snapshot, essence);
  assertNotNull(landed, "the essence is still on the field");
  assertEqual(
    `${landed?.q},${landed?.r}`,
    `${TO.q},${TO.r}`,
    "rotate-cw carried the essence from (2, 0) to (0, 2): the sweep really ran",
  );
  assertNear(
    distance(
      { x: landed?.x ?? Number.NaN, y: landed?.y ?? Number.NaN },
      hexCenter(TO),
    ),
    0,
    DRAWN_TOLERANCE,
    "at t = 1 every mote lands exactly on a hex center",
  );
  assertEqual(
    landed?.type,
    "nova",
    "the essence rests on (0, 2) rather than on the seat, so the wane's condition never held and it stayed nova",
  );
  assertLength(
    sim?.motes ?? [],
    1,
    "the swept essence is the only mote on the field",
  );
});
