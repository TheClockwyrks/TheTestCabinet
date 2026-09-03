// presentation/members-told-apart-by-form — a strut, a cable and a rail are told
// apart by form and not by hue alone.
//
// specs/overview.md § Visual design, the row for members by material: "A strut, a
// cable, and a rail are told apart at a glance, by form and not by hue alone."
// specs/assets.md § What is drawn in code: the members are "each as real drawn
// geometry telling strut, cable, and rail apart".
//
// HUE IS DISCARDED BY CONSTRUCTION. What this point reads is not colour but the
// SHAPE each material draws: the geometry that arrives when the member is placed
// — how much of it there is, and the box it fills. Two materials drawn as the
// same geometry in two colours answer the same shape and fail here; two drawn as
// different geometry answer different shapes and pass whatever colours they are
// drawn in. So the reading answers the sentence's own question — told apart by
// form, not by hue.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there.
//
// NOTHING IS FOUND BY NAME. What a build calls an object, which component it
// reaches for and what it paints with are the build's; what a check finds an
// object by is WHERE IT IS and WHAT SHAPE IT HAS.
//
// ONE MEMBER AT A TIME, ON THE SAME TWO NODES, so nothing but the material
// differs between the three readings: the yard is emptied, one member is placed,
// its drawing is read, and it is removed again. The nodes are chosen so all three
// materials are legal there — six units apart along `x`, inside the envelope,
// with neither end on an anchor — since `specs/structure.md` refuses a placement
// for reasons that have nothing to do with how it would be drawn.
//
// AND ALL THREE PAIRS ARE COMPARED, because "told apart" is about each pair: a
// build that drew a cable differently from both a strut and a rail but drew those
// two alike has left a player unable to read half its structures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type Harness,
  type MaterialName,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The two nodes every material is drawn between, six units apart. */
const FROM: Vec3 = { x: 6, y: 6, z: 0 };
const TO: Vec3 = { x: 12, y: 6, z: 0 };

/** The three materials specs/structure.md gives a member. */
const MATERIALS: readonly MaterialName[] = ["strut", "cable", "rail"];

/** How far two forms' extents may agree and still be two forms, in units. */
const SAME = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The shape one material draws between the two nodes, without its colour. */
async function formOf(material: MaterialName): Promise<string> {
  await h.debug.clearStructure();
  await h.advance(1);
  const before = new Set(
    drawnObjects(h).map((object) => JSON.stringify(object.box)),
  );

  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, material);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).structure.members.length,
    1,
    `the ${material} the placement stood between the two nodes ` +
      "(specs/structure.md)",
  );

  const arrived = drawnObjects(h).filter(
    (object) => !before.has(JSON.stringify(object.box)),
  );
  assertTrue(
    arrived.length > 0,
    `something drawn once a ${material} is placed, since the members are ` +
      'drawn "each as real drawn geometry" (specs/assets.md)',
  );
  // The COLOUR is deliberately left out: what is compared is how much geometry
  // arrived and the extent it fills, which is the form and nothing else.
  return arrived
    .map((object) =>
      JSON.stringify([
        object.type,
        object.vertices,
        [
          Math.round(object.box!.size.x / SAME),
          Math.round(object.box!.size.y / SAME),
          Math.round(object.box!.size.z / SAME),
        ],
      ]),
    )
    .sort()
    .join("\n");
}

it("draws the three materials as three different forms", async () => {
  await openSite(h, SITE);
  await clearAll(h);

  const forms = new Map<MaterialName, string>();
  for (const material of MATERIALS) forms.set(material, await formOf(material));
  await h.capture("materials", "The three materials on the same two nodes");

  for (const one of MATERIALS) {
    for (const other of MATERIALS) {
      if (one >= other) continue;
      assertTrue(
        forms.get(one) !== forms.get(other),
        `a ${one} and a ${other} drawn between the same two nodes to differ ` +
          'in FORM rather than in colour alone: "A strut, a cable, and a rail ' +
          'are told apart at a glance, by form and not by hue alone" ' +
          `(specs/overview.md) — both drew ${forms.get(one)!}`,
      );
    }
  }
});
