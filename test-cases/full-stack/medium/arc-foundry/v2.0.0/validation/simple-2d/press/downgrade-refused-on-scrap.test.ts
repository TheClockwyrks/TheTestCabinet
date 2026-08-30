// press/downgrade-refused-on-scrap — a Scrap candidate cannot be downgraded.
//
// Scrap is the bottom rung of the ladder (`specs/components.md`), so there is
// nothing below it to harvest into: `specs/scrap-press.md` offers DOWNGRADE on a
// candidate at Tuned or above and on nothing else, and `specs/hud.md` draws the
// control disabled in its slot rather than removing it.
//
// THE EXPENSIVE HALF OF THE FAILURE IS THE WAVE. A downgrade is a harvest, and a
// harvest ends the build phase and launches the wave. A build that lets the
// refused action through does not merely produce a nonsense tier — it spends the
// level's one harvest on it and starts the wave, from a control the player was
// told was inert. So the phase and the wave counter are read alongside the
// candidate itself.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  TIERS,
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  structureById,
  type Harness,
} from "../harness";

/** The roll the downgrade is attempted on: the bottom of the ladder. */
const ROLLS = { type: "coil", quality: TIERS[0]! } as const;
const AT = { col: 20, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes nothing when a Scrap candidate is downgraded", async () => {
  openYard(h);
  const candidate = standCandidate(
    h,
    ROLLS.type,
    ROLLS.quality,
    AT.col,
    AT.row,
  );
  const before = h.snapshot();

  h.debug.select(candidate);
  // `specs/instrumentation.md` leaves an operation two conformant answers when
  // its subject is not in the condition it states: refuse and do nothing, or fail
  // loudly. What this point decides is the yard either answer leaves behind, and
  // a pose that throws leaves the engine's state exactly as it was.
  try {
    h.debug.downgrade(candidate);
  } catch {
    // The loud refusal, which is the other conformant answer.
  }

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "refused");

  const still = structureById(after, candidate);
  assertEqual(
    still.kind,
    "candidate",
    "what the Scrap candidate is after a refused downgrade",
  );
  assertEqual(
    still.quality,
    ROLLS.quality,
    "the quality of the Scrap candidate after a refused downgrade",
  );
  assertEqual(
    after.phase,
    before.phase,
    "the phase after a refused downgrade, which harvests nothing",
  );
  assertEqual(
    after.wave,
    before.wave,
    "the wave counter after a refused downgrade, which starts no wave",
  );
});
