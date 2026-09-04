// instrumentation/challenge-index-out-of-range-throws — an index outside a mode's
// challenge count throws.
//
// THE RULE. "`mode` is `"campaign"` or `"extras"` throughout this group, and an
// `index` outside that mode's challenge count throws an `Error` naming the
// bounds" (`specs/instrumentation.md`, Navigation and progress). The rule is
// stated over the whole Navigation-and-progress group — `setSolved`, `setRecord`
// and `setLast` — and the two challenge operations that take the same pair are
// held to the same thing: "An argument outside the domain its operation states is
// invalid, and the call fails loudly rather than guessing what was meant", so
// `openChallenge(mode, index)` and `referenceSolution(mode, index)` refuse an
// index their mode does not hold. A refused call is not a pose: "Each pose sets
// one thing and leaves the rest of the game as it stands", and one that failed
// set nothing.
//
// THE BOUNDS are the mode's own count, which the snapshot reports as
// `<mode>.count`: "how many challenges the shipped course holds" and, for the
// Extras, `count: 10`. So `-1` is below every mode's range and `count` is the
// first index at or above it.
//
// THE CONFIGURATION. A reset session with no challenge open, no machine and no
// run, so the whole of what the refused calls could disturb — both modes'
// progress, the screen, and the open challenge — is read before and after and
// compared. Every one of the five operations is called twice per mode, once with
// `-1` and once with that mode's `count`.
//
// WHAT THE MESSAGE IS HELD TO. The specification requires the bounds NAMED, and
// leaves the wording free; a build may write the last index it accepts or the
// first it refuses. So the message of each Navigation-group refusal at `count` is
// required to carry one of those two figures, and nothing more is demanded of it.
//
// THE VERDICT. Every one of the twenty calls throws; the three Navigation-group
// operations name the bounds; and both modes' unlocked count, solved sets,
// records, stashes and `last` figures, the screen, and the open challenge all
// stand exactly as they did before the first refusal.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  assertNull,
  fail,
} from "../assert";
import type { ModeName } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  progressOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The message a call refused with, or a failure that it did not refuse at all. */
async function refusal(
  run: () => Promise<unknown>,
  doing: string,
): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return fail(
    `a thrown Error (${doing}: an index outside the mode's challenge count)`,
    "the call returned without throwing",
  );
}

it("refuses every index outside a mode's count, and changes nothing", async () => {
  await openTitle(h);
  await h.debug.setUnlockedCount(3);
  await h.debug.setSolved("campaign", 1, true);
  await h.debug.setSolved("extras", 2, true);
  await h.debug.setRecord("extras", 2, "cost", 45);
  await h.debug.setLast("campaign", 2);
  await h.debug.setLast("extras", 5);
  await openSelect(h, "extras");
  await captureStill(h, "bounded");

  const before = await h.snapshot();
  const modes: readonly ModeName[] = ["campaign", "extras"];

  for (const mode of modes) {
    const count = progressOf(before, mode).count;
    for (const index of [-1, count]) {
      const at = `${mode} index ${index}`;
      await refusal(
        () => h.debug.setSolved(mode, index, true),
        `setSolved(${at})`,
      );
      await refusal(
        () => h.debug.setRecord(mode, index, "cost", 1),
        `setRecord(${at})`,
      );
      await refusal(() => h.debug.setLast(mode, index), `setLast(${at})`);
      await refusal(
        () => h.debug.openChallenge(mode, index),
        `openChallenge(${at})`,
      );
      await refusal(
        () => h.debug.referenceSolution(mode, index),
        `referenceSolution(${at})`,
      );
    }

    const bound = new RegExp(`(?:^|\\D)(?:${count}|${count - 1})(?:\\D|$)`);
    for (const [name, run] of [
      ["setSolved", () => h.debug.setSolved(mode, count, true)],
      ["setRecord", () => h.debug.setRecord(mode, count, "cost", 1)],
      ["setLast", () => h.debug.setLast(mode, count)],
    ] as const) {
      const message = await refusal(run, `${name}(${mode} index ${count})`);
      assertMatches(
        message,
        bound,
        `${name}'s refusal names the bounds of ${mode}, whose count is ${count}`,
      );
    }
  }

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    before.screen,
    "a refused call moved the game to no screen",
  );
  assertNull(after.challenge, "and opened no challenge");
  assertDeepEqual(
    after.campaign,
    before.campaign,
    "the campaign's unlocked count, solved set, records, stashes and last stand",
  );
  assertDeepEqual(
    after.extras,
    before.extras,
    "the Extras' solved set, records, stashes and last stand",
  );
});
