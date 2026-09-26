// campaign/finale-carries-the-longest-tape — the course's last challenge asks for
// a longer tape than any before it.
//
// THE RULE. "The last challenge of the course asks for more parts and a longer
// tape than any before it" (`specs/modes/campaign.md`, Course design). The half
// this point decides is the TAPE half; the parts half is its own item. What a
// challenge "asks for" is what its reference solution has to write, because the
// reference is the one machine the specification requires to exist for it: the
// build "ships a reference solution for it, in the solution format, that is legal,
// places every rise and set, and whose run completes without faulting"
// (`specs/modes/campaign.md`, The course). So the reading is over the reference
// solutions, taken through the one door the specification opens onto them —
// "`referenceSolution(mode, index)` ... A pure read: the build's own reference
// solution for that challenge, as a solution document"
// (`specs/instrumentation.md`).
//
// HOW A TAPE IS MEASURED. "The machine's period `P` is the largest tape length
// across its arms and wheels" and a tape's length is "the index of its last
// non-blank cell plus one, and `0` when it is entirely blank"
// (`specs/instructions.md`), which is what `tapeLength` computes. A solution
// document's tapes are already trimmed — "Its last entry is an instruction, and an
// entirely blank tape is the empty list" (`specs/formats.md`) — so the two agree,
// and measuring the definition rather than the array length means a build that
// ships an untrimmed tape is measured on the cells it really holds.
//
// THE VERDICT. The longest tape of the last challenge's reference solution holds
// strictly more cells than the longest tape of every earlier challenge's. The
// comparison is over the whole course rather than against the runner-up alone, so
// the failure names the challenge that ties or beats the finale.
//
// A COURSE OF ONE HAS NO "EARLIER", so the check would decide nothing on it. The
// course length is bounded — "The campaign holds between `CAMPAIGN_MIN` (`8`) and
// `CAMPAIGN_MAX` (`16`) challenges" — and this point is posed on a course that has
// something before its last challenge; the length itself is its own item.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import type { Solution } from "../formats";
import { tapeLength } from "../parts";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The longest tape a solution's parts carry, in cells. */
function longestTape(machine: Solution): number {
  return machine.parts.reduce(
    (most, part) => Math.max(most, tapeLength(part.tape)),
    0,
  );
}

it("gives the last challenge a longer tape than every challenge before it", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    1,
    "the course holds a challenge before its last one, so there is something " +
      "for the finale's tape to be longer than",
  );

  const longest: number[] = [];
  for (let index = 0; index < count; index += 1) {
    longest.push(longestTape(await referenceSolution(h, "campaign", index)));
  }

  // The evidence is the finale's own tape panel, which is the editor over the
  // last challenge with its reference machine loaded onto it.
  const finale = count - 1;
  await openChallenge(h, "campaign", finale);
  await loadMachine(h, await referenceSolution(h, "campaign", finale));
  await h.advance(1);
  await captureStill(h, "tape-panel");

  const finaleTape = longest[finale] ?? 0;
  for (let index = 0; index < finale; index += 1) {
    assertGreaterThan(
      finaleTape,
      longest[index] ?? 0,
      `the last challenge asks for a longer tape than any before it, and ` +
        `challenge ${index + 1}'s reference solution writes ${longest[index] ?? 0} cells`,
    );
  }
});
