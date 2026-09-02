// editor/a-field-press-during-a-run-sets-focus-alone — while a run is live, a
// press on a placed part sets the focus and moves nothing else.
//
// THE RULE. "While a run is active, in any status, a press on the field or the
// tape panel sets the focus alone, and the editor reads the run controls above and
// `mute` and nothing else" (`specs/editor.md`, Running the machine). Which focus
// such a press sets is `specs/controls.md`'s: "A press inside the tape panel's
// extent, `x >= TRAY_REGION_W` (`224`) and `y >= TAPE_Y0` (`560`) as
// `specs/editor.md` fixes them, sets focus to `tape`; a press anywhere else on the
// editor screen sets it to `field`."
//
// WHAT THE PRESS MUST NOT DO is what the same file gives it while EDITING: "The
// press selects that part" (Selection on the field) and "a press on a part selects
// it at once and begins a move" (Dragging). Neither is available to a run, so the
// selection and the live drag are exactly what they were before it.
//
// "IN ANY STATUS" IS THE POINT, so the one press is made under all four of
// `specs/simulation.md`'s statuses, each reached the way that status is reached:
// `running` from `startRun`; `paused` from `setPaused(true)`, which "Moves
// `sim.status` between `running` and `paused`"; `faulted` from a piston at
// `ARM_MAX_LEN` (`3`) fetching `extend`, which "`overextended`" names; and
// `complete` from a machine holding its set and a tally posed at the challenge's
// `target`, so "a boundary at which every set's tally has reached the challenge's
// `target`" completes the run one cycle later.
//
// THE CONFIGURATION. Two parts and an empty field. The arm on `WEST` `(-3, 0)` is
// what the press lands on — `hexCenter` puts the press on that hex's own center,
// which `specs/field.md` targets — and the SECOND part is what the selection is
// posed to, so a build that selected on the press has something different to
// report than what was standing. Nothing else is on the field: `openBareRun`
// empties it, and the completing scenario's machine holds no rise, so its settle
// raises nothing either. The two hexes are three apart, so neither part's
// footprint reaches the other's.
//
// THE HANDS ARE POSED ONCE THE RUN IS LIVE, through `setSelected` and `setFocus`,
// rather than before it: no sentence of `specs/` fixes whether a run start keeps
// the selection or the focus, so a check that posed them while editing and read
// them back after would be deciding a rule the specification never wrote. The
// focus is posed to `tape` precisely so that "sets it to `field`" is a reading
// with somewhere to move FROM.
//
// THE VERDICT. After the press, `editor.selected` still names the second part,
// `editor.drag` is still `null`, and `editor.focus` is `field`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ARM_MAX_LEN, type SimStatusName } from "../constants";
import { hexCenter } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, EAST, ONE_DELIVERY, WEST } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  openRun,
  partIds,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The two parts a scenario poses: the one pressed, and the one selected. */
interface Posed {
  pressed: number;
  other: number;
}

/** Answer the ids of a two-part machine in placement order. */
async function bothParts(h: Harness): Promise<Posed> {
  const ids = await partIds(h);
  return { pressed: ids[0] ?? -1, other: ids[1] ?? -1 };
}

/** One live run, in one of the four statuses, with an arm on `WEST` to press. */
const SCENARIOS: readonly {
  status: SimStatusName;
  how: string;
  pose: (h: Harness) => Promise<Posed>;
}[] = [
  {
    status: "running",
    how: "startRun leaves sim.status running",
    pose: async (h) => {
      await openBareRun(h, {
        challenge: BARE,
        machine: solution([
          armPart("arm", WEST.q, WEST.r),
          armPart("arm", EAST.q, EAST.r),
        ]),
      });
      return bothParts(h);
    },
  },
  {
    status: "paused",
    how: "setPaused(true) moves the status to paused",
    pose: async (h) => {
      await openBareRun(h, {
        challenge: BARE,
        machine: solution([
          armPart("arm", WEST.q, WEST.r),
          armPart("arm", EAST.q, EAST.r),
        ]),
        paused: true,
      });
      return bothParts(h);
    },
  },
  {
    status: "faulted",
    how: "a piston at ARM_MAX_LEN fetching extend faults as overextended",
    pose: async (h) => {
      await openBareRun(h, {
        challenge: BARE,
        machine: solution([
          armPart("arm", WEST.q, WEST.r),
          armPart("piston", EAST.q, EAST.r, 0, ARM_MAX_LEN, ["extend"]),
        ]),
      });
      await advanceCycles(h, 1);
      return bothParts(h);
    },
  },
  {
    status: "complete",
    how: "a boundary with every tally at the challenge's target completes the run",
    pose: async (h) => {
      await openRun(h, {
        challenge: ONE_DELIVERY,
        machine: solution([
          armPart("arm", WEST.q, WEST.r),
          setPart(0, EAST.q, EAST.r),
        ]),
      });
      await h.debug.setTally(0, ONE_DELIVERY.target);
      await advanceCycles(h, 1);
      return bothParts(h);
    },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the focus to field and leaves the selection and the drag standing, in every status", async () => {
  for (const scenario of SCENARIOS) {
    const posed = await scenario.pose(h);

    assertEqual(
      (await h.snapshot()).sim?.status,
      scenario.status,
      `the run is ${scenario.status} before the press: ${scenario.how}`,
    );

    await h.debug.setSelected(posed.other);
    await h.debug.setFocus("tape");

    const standing = (await h.snapshot()).editor;
    assertEqual(
      standing.selected,
      posed.other,
      `the second part is selected before the press, with the run ${scenario.status}`,
    );
    assertEqual(
      standing.focus,
      "tape",
      "the focus stands at tape before the press, so a move to field is a reading",
    );
    assertNull(standing.drag, "no drag is live before the press");

    await pressAt(h, hexCenter(WEST));
    await h.advance(1);
    await captureStill(h, "inert-press");

    const editor = (await h.snapshot()).editor;
    await releasePointer(h);

    assertEqual(
      editor.selected,
      posed.other,
      `a press on the arm at (${WEST.q}, ${WEST.r}) selects nothing while the run is ${scenario.status}`,
    );
    assertNull(
      editor.drag,
      `that press begins no move while the run is ${scenario.status}`,
    );
    assertEqual(
      editor.focus,
      "field",
      `that press sets the focus to field while the run is ${scenario.status}`,
    );
  }
});
