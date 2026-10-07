// machinery/bore-grants-nothing — a marked core a bore removes grants nothing.
//
// THE SPEC LINE. `specs/machinery.md` — "Granting": "Extraction is the only
// source of a grant, and a marked core a bore removes grants nothing."
//
// WHY IT IS A POINT. A build that routes a bore's removal through the same code
// its extractions use grants whatever the cores the bore swept happened to carry,
// which is a machinery the player never earned — and it is invisible in every
// other machinery point, because they all pose unmarked bystanders.
// `machinery/bore-radius` decides which cores a bore takes; this decides what
// taking them is worth.
//
// THE POSE. Three cores on `specs/channel.md`'s leg 0, head first:
//
//   436  cobalt, marked `backflow`  — the witness, ahead of everything removed
//   408  halide, marked `bore`      — the mark the extraction grants
//   380  halide                     — the core the shot strikes
//
// The shot seats at 352, as `machinery/insertion-stage` describes, so the maximal
// same-charge run is 352, 380 and 408 and the extraction takes all three. The
// witness carries a different charge, so it is not in the run.
//
// WHAT THE BORE THEN DOES. `specs/machinery.md` — "Bore": the extraction point is
// "the field position the marked core held at the moment its run was extracted",
// which is arc 408 on leg 0, `(448, 40)`. The witness stands at `(476, 40)`, 28
// units away and well inside `BORE_RADIUS` (90), so the bore removes it. It sits
// AHEAD of the frontmost core the removal took, so `specs/extraction.md` leaves
// its arc position alone and the distance is the one the pose arranged.
//
// WHAT IS READ. The active machinery on the tick it all resolves. The only marks
// in play are the `bore` the extraction granted, which "never becomes the active
// machinery" (`specs/machinery.md`), and the `backflow` the bore swept up, which
// grants nothing — so a conformant build reports no active machinery at all. A
// build that granted from a bore's removal reports `backflow`.
//
// TOLERANCE. None: the reading is `machinery` reported as `null`, which
// `specs/instrumentation.md` fixes as the value "while no timed machinery is
// active". The witness having really been swept is asserted first, since a bore
// that removed nothing would leave the same `null` for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { BORE_RADIUS, SPACING } from "../constants";
import {
  captureReplay,
  createHarness,
  channelPoint,
  coreCount,
  distance,
  type Harness,
  type PosedCore,
} from "../harness";
import {
  driveExtraction,
  RUN_CHARGE,
  STRUCK_S,
  TRAILING_TICKS,
} from "./insertion-stage";

/** The arc position of the core carrying the bore mark. */
const BORE_S = STRUCK_S + SPACING;

/** The witness: a marked core of another charge, ahead of the run. */
const WITNESS_S = BORE_S + SPACING;
const WITNESS_MARK = "backflow";

const CORES: PosedCore[] = [
  [WITNESS_S, "cobalt", WITNESS_MARK],
  [BORE_S, RUN_CHARGE, "bore"],
  [STRUCK_S, RUN_CHARGE, null],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`grants nothing for the ${WITNESS_MARK} mark a bore removes`, async () => {
  // The arrangement really is the one the reading needs: the witness stands
  // inside the radius of the point the marked core will hold.
  const reach = distance(channelPoint(BORE_S), channelPoint(WITNESS_S));
  assertEqual(
    reach < BORE_RADIUS,
    true,
    `the witness ${reach.toFixed(1)} units from the extraction point, inside ` +
      `BORE_RADIUS (${BORE_RADIUS})`,
  );

  const after = await captureReplay(h, "bored", async () => {
    const resolved = await driveExtraction(h, CORES);
    await h.step(TRAILING_TICKS);
    return resolved;
  });

  // The run of three went, and the bore then took the witness with it: nothing is
  // left standing. A bore that removed nothing would leave the witness here, and
  // the reading below would be about a mark that never left the channel.
  assertEqual(
    coreCount(after),
    0,
    "the cores left once the run was drawn out and its bore swept the witness",
  );
  assertNull(
    after.machinery,
    `the active machinery after a bore removed a core marked ${WITNESS_MARK}`,
  );
});
