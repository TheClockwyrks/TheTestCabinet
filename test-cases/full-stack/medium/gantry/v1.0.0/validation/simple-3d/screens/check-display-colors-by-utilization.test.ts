// screens/check-display-colors-by-utilization — with a structure that stands, the
// check colours each member by its static utilization.
//
// `specs/ui.md` § Build, the third of the check's outcomes: "No readiness issue,
// and the structure stands | The issues by name, … that the structure stands, and
// EACH MEMBER COLORED BY ITS STATIC UTILIZATION on the utilization ramp
// (`specs/overview.md`)". This is the outcome where the ramp is owed, and the two
// beside it are where it is not.
//
// THE READING IS THAT THE COLOURS SPREAD, AND SPREAD WITH THE FIGURES. `check()`
// reports each member's utilization, and `drawn()` reports the colour each was
// drawn in, so members carrying different shares must be drawn differently — and
// which way round is the build's ramp to choose.
//
// NO PALETTE IS FIXED. What is compared is the build's own colours against each
// other, ordered by the build's own solve.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  clearAll,
  colourDistance,
  createHarness,
  entriesOf,
  MINIMAL_CRANE,
  openSite,
  poseCrane,
  type Harness,
} from "../harness";

/** The key the `check` action is bound to (`specs/controls.md`). */
const CHECK_KEY = "KeyC";

/** How far the extremes of the ramp must stand apart, out of 765. */
const SPREAD = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("colours each member by its utilization when the structure stands", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, MINIMAL_CRANE);

  // THE ACTION, NOT THE READING. `specs/instrumentation.md` is explicit that
  // `check()` "is pure: it computes the check and returns it, and it displays
  // nothing, so the result the build screen is showing is untouched" — so what
  // colours the members is the `check` action, posed by `showCheck`, and the
  // reading is only how this check learns what the solve found.
  await h.debug.showCheck();
  await h.advance(1);

  const found = await h.check();
  assertTrue(
    found.stable && found.members.length >= 2,
    "a structure that stands and is solved, which is the outcome this check " +
      `is about — it reported ${found.members.length} member(s), stable=${found.stable}`,
  );

  const utilization = new Map(found.members.map((m) => [m.id, m.utilization]));
  const drawn = entriesOf(await h.drawn(), "member").filter(
    (entry) => entry.id !== null && utilization.has(entry.id),
  );

  await h.capture("check-colors", "The check colouring members by utilization");

  assertTrue(drawn.length >= 2, "at least two solved members drawn");
  const ordered = [...drawn].sort(
    (a, b) => utilization.get(a.id!)! - utilization.get(b.id!)!,
  );
  const low = ordered[0]!;
  const high = ordered[ordered.length - 1]!;
  // A crane whose members all carry the same share has one colour to show, and
  // that is the ramp working rather than failing.
  if (utilization.get(high.id!)! - utilization.get(low.id!)! < 0.05) return;

  const apart = colourDistance(low.color, high.color);
  assertTrue(
    apart >= SPREAD,
    `members carrying ${utilization.get(low.id!)!.toFixed(3)} and ` +
      `${utilization.get(high.id!)!.toFixed(3)} to be drawn in different ` +
      `colours — they stand only ${apart} of 765 apart (specs/ui.md)`,
  );
});
