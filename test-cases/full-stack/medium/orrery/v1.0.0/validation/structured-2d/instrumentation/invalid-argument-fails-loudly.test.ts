// instrumentation/invalid-argument-fails-loudly — an argument outside its
// operation's stated domain throws, and leaves the game exactly as it stood.
//
// THE RULE. "An argument outside the domain its operation states is invalid, and
// the call fails loudly rather than guessing what was meant, except where an
// operation states that it normalizes or ignores the call"
// (`specs/instrumentation.md`, The operations). None of the five rows below states
// any such licence, and each states its domain:
//
//   `setSpeed(index)`                     "Sets `sim.speed` to `index`, `0` to `3`."
//   `setPartRotation(part, rotation)`     "Sets that part's rest rotation, `0` to `5`."
//   `setPartLength(part, length)`         "`ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)."
//   `setHowtoPage(n)`                     "`0` to `HOWTO_PAGES - 1` (`4`)."
//   `setTapeCell(part, col, instruction)` "a name from `INSTRUCTIONS` in
//                                          `specs/instructions.md` or `null` for a blank."
//
// So `4`, `6`, `4`, `5` and `"grabb"` are each one step outside a stated bound or
// off a stated list, and each is the argument the review item names.
//
// THE VERDICT IS BOTH HALVES OF "FAILS LOUDLY". The call throws an `Error` rather
// than returning, and the game is left as it stood — which is read as the WHOLE
// snapshot before against the whole snapshot after, the build's own reading
// compared with itself, so a build that clamped `setSpeed(4)` to `3`, rounded
// `setPartLength(4)` down, or wrote a blank where `"grabb"` was refused is caught
// wherever it put the change.
//
// THE POSE is one live run on `BARE` with one arm on it and nothing else: `setSpeed`
// "requires a live run and throws an `Error` without one", and the two part
// operations and `setTapeCell` need a part with a tape to name. No frame is
// advanced anywhere in the check, so nothing but a refused call could move the
// snapshot at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  ARM_MAX_LEN,
  HOWTO_PAGES,
  SPEEDS,
  type InstructionName,
} from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The call throws an `Error` and returns nothing, and the game is where it was.
 *
 * Both halves of the requirement in one place, so a build that throws but half
 * applies the call, and a build that applies nothing but returns quietly, each
 * fail on the half they broke.
 */
async function refused(
  call: () => Promise<unknown>,
  doing: string,
): Promise<void> {
  const before = await h.snapshot();
  let thrown: unknown = null;
  let returned = false;
  try {
    await call();
    returned = true;
  } catch (error) {
    thrown = error;
  }
  assertEqual(
    returned,
    false,
    `${doing} is outside the domain its row states, so the call fails rather than returning`,
  );
  assertTrue(
    thrown instanceof Error,
    `${doing} fails loudly, by throwing an Error`,
  );
  assertDeepEqual(
    await h.snapshot(),
    before,
    `${doing} changes nothing: no clamp, no rounding, no guess at what was meant`,
  );
}

it("throws on an argument outside its stated domain, and changes nothing", async () => {
  await openBareRun(h, { challenge: BARE });
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.debug.setTapeCell(arm, 0, "grab");
  await h.advance(1);
  await captureStill(h, "unchanged");

  await refused(
    () => h.debug.setSpeed(SPEEDS.length),
    `setSpeed(${SPEEDS.length})`,
  );
  await refused(
    () => h.debug.setPartRotation(arm, 6),
    "setPartRotation(part, 6)",
  );
  await refused(
    () => h.debug.setPartLength(arm, ARM_MAX_LEN + 1),
    `setPartLength(part, ${ARM_MAX_LEN + 1})`,
  );
  await refused(
    () => h.debug.setHowtoPage(HOWTO_PAGES),
    `setHowtoPage(${HOWTO_PAGES})`,
  );
  await refused(
    () => h.debug.setTapeCell(arm, 0, "grabb" as InstructionName),
    'setTapeCell(part, col, "grabb")',
  );
});
