// runs/play-refusal-names-what-is-missing — a refused `play` leaves the heading
// saying WHICH part the machine is short of.
//
// THE RULE. "The `play` action starts a run when every rise and every set is
// placed; otherwise it does nothing and the heading states which are missing"
// (`specs/editor.md`, Running the machine). The heading is the strip that carries
// the editor's messages: "`x` `0` to `STAGE_W` (`1280`), `y` `0` to `HEADING_H`
// (`48`) ... The challenge's name, the machine's current cost, and the editor's
// messages" (the same file's layout table). Its internal layout is the build's —
// "The heading and the readout are display only, and their internal layout is
// yours" — so the specification fixes that the statement REACHES that rectangle,
// not where in it, in what words, or in what typeface.
//
// HOW "WHICH ARE MISSING" IS READ WITHOUT READING ANY WORDS. Three machines are
// posed on `BARE` and the heading's rectangle is sampled after each: one short of
// its SET, one short of its RISE, and one complete. All three carry the same
// challenge name and the same machine cost — a rise and a set each cost `0`
// (`specs/parts.md`, Costs), and every machine here holds exactly one arm — so
// the message is the only thing in that strip that can differ. A heading that
// states which are missing therefore draws three different rectangles: naming the
// set differs from naming the rise, and both differ from a heading with nothing
// to report. A heading that says nothing, or says the same thing whatever is
// short, draws two of the three identically.
//
// WHY THE COMPLETE MACHINE IS ONE OF THE THREE. It is what makes the pair of
// refusals mean something: without it a build that drew one fixed message
// forever, missing or not, would pass on the two refusals alone.
//
// THE PRESSES ARE THE PLAYER'S, through the key `specs/controls.md` binds to
// `play`, and each is confirmed to have been REFUSED — `sim` stays `null` — so
// what the heading is read after is a refusal rather than a run.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNull } from "../assert";
import { HEADING_REGION } from "../field";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pixelsDiffering,
  playAction,
  type Harness,
  type PixelRect,
} from "../harness";

/** The arm every one of the three machines carries, so all three cost the same. */
const ARM = armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []);

/** The rise placed, the set missing. */
const MISSING_THE_SET = solution([risePart(0, WEST.q, WEST.r), ARM]);

/** The set placed, the rise missing. */
const MISSING_THE_RISE = solution([setPart(0, EAST.q, EAST.r), ARM]);

/** Both placed: nothing is missing, so there is nothing to state. */
const COMPLETE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  ARM,
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The heading strip as the last frame drew it. */
function readHeading(): Promise<PixelRect> {
  return h.pixelRect(
    HEADING_REGION.x,
    HEADING_REGION.y,
    HEADING_REGION.w,
    HEADING_REGION.h,
  );
}

it("draws a different heading for a missing set, a missing rise, and nothing missing", async () => {
  await openChallengeDocument(h, BARE);

  await loadMachine(h, MISSING_THE_SET);
  await playAction(h);
  const refusedSet = await h.snapshot();
  const headingForSet = await readHeading();
  await captureStill(h, "heading");

  await loadMachine(h, MISSING_THE_RISE);
  await playAction(h);
  const refusedRise = await h.snapshot();
  const headingForRise = await readHeading();

  await loadMachine(h, COMPLETE);
  await h.advance(1);
  const headingForComplete = await readHeading();

  assertNull(
    refusedSet.sim,
    "the machine short of its set starts no run, so the heading is read after a refusal",
  );
  assertNull(
    refusedRise.sim,
    "the machine short of its rise starts no run, so the heading is read after a refusal",
  );

  assertGreaterThan(
    pixelsDiffering(headingForSet, headingForRise),
    0,
    "the heading states WHICH are missing, so a missing set and a missing rise are not the same heading",
  );
  assertGreaterThan(
    pixelsDiffering(headingForSet, headingForComplete),
    0,
    "the heading states the missing set, so it differs from the heading of a machine with nothing missing",
  );
  assertGreaterThan(
    pixelsDiffering(headingForRise, headingForComplete),
    0,
    "the heading states the missing rise, so it differs from the heading of a machine with nothing missing",
  );
});
