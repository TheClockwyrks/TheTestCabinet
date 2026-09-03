// screens/select-confirm-enters-a-site — `confirm` on an open site enters it with
// the structure and tape stored on it.
//
// `specs/ui.md` § The screens, Site select: "`confirm` on an open or cleared site
// enters it, opening the `build` screen with that site's stored structure and
// tape." § Results says the other half of the same rule — opening a site returns
// the camera, empties the undo history and puts the run back to its placeholder,
// "while every site's stored structure and tape stand as they were built".
//
// WHAT IS BUILT IS DELIBERATELY SMALL AND EXACT. Two members and one move step:
// enough that "the structure and tape stored on it" has content to be wrong
// about, and few enough that the reading names which member or which step came
// back changed. The world is emptied first with `clearAll`, so the structure the
// entry restores is the one this check placed and not a site's own furniture.
//
// THE SITE IS LEFT AND RE-ENTERED THROUGH THE SCREEN THE RULE IS ABOUT: `back` on
// `build` "returns to `select`" (`specs/ui.md`) with the highlight on the site
// just left, and `confirm` there is the act under test. Nothing is posed between
// the two, so what stands afterwards is what the entry restored.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The `confirm` and `back` bindings, as `specs/controls.md` fixes them. */
const CONFIRM = BINDINGS.confirm[0]!;
const BACK = BINDINGS.back[0]!;

/** The site built on, entered again once the list has been visited. */
const SITE = 0;

/** Two struts on the site's own anchor nodes: a structure with an identity. */
const MEMBERS = [
  { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 2, z: 0 } },
  { a: { x: 2, y: 0, z: 0 }, b: { x: 2, y: 2, z: 0 } },
] as const;

/** One move step: the smallest tape that is not the empty one. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the site with the structure and tape stored on it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  for (const { a, b } of MEMBERS) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
  }
  await poseTape(h, TAPE);

  const built = await h.snapshot();
  assertLength(
    built.structure.members,
    MEMBERS.length,
    "the members standing on the site before it is left",
  );
  assertLength(
    built.program,
    TAPE.length,
    "the tape written before it is left",
  );

  await h.press(BACK);
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the screen `back` on `build` returns to (specs/ui.md)",
  );

  await h.press(CONFIRM);
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "build",
    "the screen `confirm` on an open site opens (specs/ui.md)",
  );
  assertEqual(
    entered.siteIndex,
    SITE,
    "the site `confirm` on its own row entered (specs/ui.md)",
  );

  assertLength(
    entered.structure.members,
    MEMBERS.length,
    `the members the entered site carries, which stand as they were built ` +
      "(specs/ui.md)",
  );
  for (const [index, { a, b }] of MEMBERS.entries()) {
    const member = entered.structure.members[index]!;
    const ends = [member.a, member.b];
    const matched =
      ends.some((p) => p.x === a.x && p.y === a.y && p.z === a.z) &&
      ends.some((p) => p.x === b.x && p.y === b.y && p.z === b.z);
    assertEqual(
      matched,
      true,
      `member ${index} of the entered site to run between ` +
        `(${a.x}, ${a.y}, ${a.z}) and (${b.x}, ${b.y}, ${b.z}), as it was ` +
        `built — it runs between (${member.a.x}, ${member.a.y}, ` +
        `${member.a.z}) and (${member.b.x}, ${member.b.y}, ${member.b.z})`,
    );
  }

  assertLength(
    entered.program,
    TAPE.length,
    "the tape steps the entered site carries, which stand as they were " +
      "written (specs/ui.md)",
  );
  const step = entered.program[0]!;
  assertEqual(step.kind, "move", "the kind of the entered site's one step");
  if (step.kind === "move") {
    assertLength(step.commands, 1, "the commands that step carries");
    assertEqual(step.commands[0]!.axis, "hoist", "that command's axis");
    assertEqual(
      step.commands[0]!.target,
      HOIST_START + 2,
      "that command's target",
    );
  }

  await h.advance(1);
  await h.capture(
    "entered-site",
    "The build screen entered with its stored structure and tape",
  );
});
