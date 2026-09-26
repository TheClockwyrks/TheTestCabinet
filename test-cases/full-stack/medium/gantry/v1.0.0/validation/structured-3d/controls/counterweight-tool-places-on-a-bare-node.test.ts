// controls/counterweight-tool-places-on-a-bare-node — under the counterweight
// tool, a click on a node carrying none places one there.
//
// `specs/controls.md` § The build tools: "Counterweight: a click on a node
// without a counterweight places one there; a click on a node carrying one
// removes it." This check is the first half of that sentence.
//
// THE NODE IS AN END OF THE ONE MEMBER STANDING. `specs/structure.md` places a
// counterweight "on any node the structure uses, a node a member ends at or a
// flange node of the ring", so the scenario stands exactly one member and clicks
// the end of it — the smallest structure that can carry a counterweight at all,
// with nothing else built that the click could have taken instead.
//
// THE CLICK IS MADE AT THE POINT THE BUILD SAYS IT DREW THAT NODE AT, so the node
// it picks is that node at zero pixels and can be no other, whatever lens the
// build draws through (`specs/instrumentation.md`: "a press and release at a
// visible node's projected point picks that node").
//
// The yard is emptied first: an obstacle would refuse the member, and neither
// loads nor obstacles are what this rule is about.

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

it("places a counterweight on the bare node the click takes", async () => {
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
  await h.debug.setTool("counterweight");

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the one member the scenario stands (specs/structure.md)",
  );
  assertLength(
    posed.structure.counterweights,
    0,
    "the counterweights standing before the click",
  );
  assertEqual(posed.tool, "counterweight", "the tool the click is made under");

  const at = await h.project(MEMBER.b.x, MEMBER.b.y, MEMBER.b.z);
  assertTrue(at.visible, "the node the click is made on is on the stage");
  await h.click(at.x, at.y);

  await h.capture("state", "the member with a counterweight on its top node");

  const s = await h.snapshot();
  assertLength(
    s.structure.counterweights,
    1,
    "the counterweights after a click on a node carrying none, under the " +
      "counterweight tool (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.counterweights[0]),
    JSON.stringify({ x: MEMBER.b.x, y: MEMBER.b.y, z: MEMBER.b.z }),
    "the node the counterweight was placed on: the one the click took",
  );
});
