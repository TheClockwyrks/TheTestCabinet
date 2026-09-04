// editor/part-verbs-are-inert-during-a-run — the field-focus verbs edit nothing
// while a run is live.
//
// THE RULE. "While a run is active, in any status, a press on the field or the
// tape panel sets the focus alone, and the editor reads the run controls above and
// `mute` and nothing else" (`specs/editor.md`, Running the machine); the run
// controls above it are `play`, `step`, `speed-up`, `speed-down` and `back`.
// `specs/controls.md` says it as a table — "`editor`, `running` or `paused` |
// `play`, `step`, `speed-up`, `speed-down`, `back`, `mute`" — under the rule "An
// action a row omits does nothing on that screen." `part-cw`, `part-grow` and
// `part-delete` are on the field-focus row, which that list omits.
// `specs/simulation.md` says the same from the machine's side: "The editor's parts
// are locked for the whole run."
//
// WHAT EACH VERB WOULD DO IF IT WERE READ is what makes the three readings
// discriminating. While editing, "`part-cw` and `part-ccw` turn an arm, a wheel, or
// a sigil one rotation step; `part-grow` and `part-shrink` change an arm's length
// within the bounds `specs/parts.md` fixes ... and `part-delete` removes any part"
// (`specs/editor.md`, Selection on the field). So the subject is posed where each
// of the three has room to act: an `arm` at `(0, 0)` at rotation `0` — `part-cw`
// would reach `1` — and at length `ARM_MIN_LEN` (`1`) — `part-grow` would reach `2`,
// and "Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)"
// admits it. Both results are legal placements, since only the anchor must be on
// the field for an arm and the anchor never moves, so "A rotation or length change
// that would make the placement illegal ... does not happen" cannot be what holds
// them still.
//
// THE CONFIGURATION. `BARE` with one arm at `(0, 0)`, a blank tape, and an empty
// field — "A blank cell is a rest on every part ... and never faults"
// (`specs/simulation.md`), so the run ticks on and raises nothing while the three
// presses are made, and nothing but the subject can appear in `editor.parts`.
//
// THE HANDS ARE POSED ONCE THE RUN IS LIVE. The item's "selected before the run
// began" is how a player reaches this state, since a press during a run selects
// nothing; but no sentence of `specs/` fixes whether a run start keeps the
// selection or the focus, so posing both after `startRun` decides this rule
// without leaning on one the specification never wrote. The focus is posed to
// `field` because it has to be: `part-grow` and `ins-extend` "share a physical
// key", `KeyW`, and "the game reads the ones the current focus names"
// (`specs/controls.md`), so under `tape` focus the press would be inert for a
// reason that is not this one.
//
// THE VERDICT. After each of the three presses in turn, the arm's `rotation` is
// still `0`, its `length` is still `ARM_MIN_LEN`, and `editor.parts` still holds
// exactly that one id, in its place.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN, type ActionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The rotation the arm is placed at, which `part-cw` would step to `1`. */
const REST_ROTATION = 0;

/** The three field-focus verbs this point names, each with what it would do. */
const VERBS: readonly { action: ActionName; would: string }[] = [
  { action: "part-cw", would: "turn the arm one rotation step clockwise" },
  { action: "part-grow", would: "raise the arm's length to 2" },
  { action: "part-delete", would: "remove the arm from the machine" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the selected arm's rotation, length and place in editor.parts standing", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, REST_ROTATION, ARM_MIN_LEN),
    ]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "startRun leaves sim.status running, which is the status this point names",
  );
  assertEqual(
    opened.editor.selected,
    arm,
    "the arm is selected before any verb, so each verb has a subject to act on",
  );
  assertEqual(
    opened.editor.focus,
    "field",
    "the focus stands at field, so the game reads the field-focus half of the shared keys",
  );

  for (const verb of VERBS) {
    await pressAction(h, verb.action);
    await captureStill(h, "inert-verbs");

    const snapshot = await h.snapshot();
    const part = partById(snapshot, arm);
    assertNotNull(
      part,
      `${verb.action} does not ${verb.would}: the arm is still in editor.parts`,
    );
    assertEqual(
      part?.rotation,
      REST_ROTATION,
      `${verb.action} leaves the arm's rotation at ${REST_ROTATION} while the run is live`,
    );
    assertEqual(
      part?.length,
      ARM_MIN_LEN,
      `${verb.action} leaves the arm's length at ARM_MIN_LEN (${ARM_MIN_LEN}) while the run is live`,
    );
    assertDeepEqual(
      await partIds(h),
      [arm],
      `${verb.action} leaves the arm in its place in editor.parts, and adds nothing`,
    );
  }
});
