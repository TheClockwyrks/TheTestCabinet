// controls/counterweight-tool-removes-a-carried-one — under the counterweight
// tool, a click on a node carrying a counterweight removes it.
//
// `specs/controls.md` § The build tools: "Counterweight: a click on a node
// without a counterweight places one there; a click on a node carrying one
// removes it." This check is the second half of that sentence.
//
// THE COUNTERWEIGHT IS POSED RATHER THAN CLICKED ON. `addCounterweight` "places
// a counterweight on that lattice node, under the rules of
// `specs/structure.md`", so the scenario reaches the state this rule is about
// without going through the placing click a different check decides: a build that
// cannot place one still fails only the item about placing.
//
// The node is an end of the one member standing, which is what makes it "a node
// the structure uses" (`specs/structure.md`), and the click is made at the point
// the build says it drew that node at, so the node it picks is that node at zero
// pixels and can be no other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The one member standing: a leg from an anchor of site 1. */
const MEMBER = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 0, y: 4, z: 0 },
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the counterweight the node it clicks is carrying", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(
    MEMBER.a.x,
    MEMBER.a.y,
    MEMBER.a.z,
    MEMBER.b.x,
    MEMBER.b.y,
    MEMBER.b.z,
    "strut",
  );
  await h.debug.addCounterweight(MEMBER.b.x, MEMBER.b.y, MEMBER.b.z);
  await h.debug.setTool("counterweight");

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the one member the scenario stands (specs/structure.md)",
  );
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight the scenario poses on that member's top node",
  );
  assertEqual(posed.tool, "counterweight", "the tool the click is made under");

  const at = await h.project(MEMBER.b.x, MEMBER.b.y, MEMBER.b.z);
  assertTrue(at.visible, "the node the click is made on is on the stage");
  await h.click(at.x, at.y);

  await h.capture(
    "state",
    "the member after the counterweight was clicked off",
  );

  assertLength(
    (await h.snapshot()).structure.counterweights,
    0,
    "the counterweights after a click on the node carrying one, under the " +
      "counterweight tool (specs/controls.md)",
  );
});
