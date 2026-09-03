// simulation/anchors-carry-the-whole-weight — the anchor reactions carry the
// whole of the weight the load model lumps on the crane.
//
// specs/statics.md opens by fixing what a solve is: "each solve is a linear
// equilibrium at the current prescribed geometry", and § The two solves gives the
// reading a support answers with — "the reaction at a support node is minus the
// sum of the applied force there and every member force pulling on it". The
// tower's supports are the anchor nodes, so with nothing moving the anchor
// reactions must add up to everything the load model puts on the crane:
// § The load model lumps at nodes "half of every intact member ending at it, each
// half being the member's length times its material's mass per unit", plus
// `RING_MASS / 8` at each of the eight flange nodes, plus `TROLLEY_MASS` at the
// trolley point, plus `COUNTERWEIGHT_MASS` per counterweight; and the hook reaches
// the structure "only through the cable force", which at rest is the bob's weight
// straight down, `HOOK_MASS * GRAVITY` (specs/rigging.md § Cable tension).
//
// THE READING IS THE STATIC CHECK OF THE MINIMAL CRANE, which is exactly the
// world this equilibrium is simplest in: specs/structure.md § The static check
// runs the two solves "at the run-start posture ... with the bare hook hanging at
// rest and nothing moving", so every acceleration is zero, `F = m * g - m * a` is
// pure weight, and the only other force in the system is the `50` the hook hangs
// at the trolley point. The minimal crane carries no counterweight, so that term
// is zero here and the arithmetic below leaves it out.
//
// The reaction at an anchor is reconstructed from what the check reports, member
// by member, because the reaction itself is not on the snapshot: a member's force
// `N` pulls the node it ends at toward its far end, so the pull at the anchor is
// `N` times the unit vector from the anchor toward that far end, and the applied
// force there is that node's own lumped mass times `-GRAVITY` on `y`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRAVITY,
  HOOK_MASS,
  RAIL_MASS_PER_UNIT,
  RING_MASS,
  STRUT_MASS_PER_UNIT,
  TROLLEY_MASS,
  type Vec3,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  standMinimalCrane,
  type Harness,
  type MaterialName,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** The mass per unit of each material (specs/structure.md § Members). */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

/**
 * The sum runs over twenty-one members and four anchors and comes to under a
 * thousand units of force, so this is a hair over the rounding of the arithmetic
 * rather than a tolerance on the physics.
 */
const TOLERANCE = 1e-6;

/** A node, as a key that compares two lattice positions. */
const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds the anchor reactions up to the whole weight the load model lumps on the crane", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  const result = await h.check();
  const { structure, site } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "check-members-force-check-stable-structure-m",
    "check.members[].force, check.stable, structure.members[].a/.b/.material",
  );

  assertTrue(
    result.stable,
    "the minimal crane to stand, so the check reports the solved member " +
      "forces (specs/structure.md § The static check)",
  );

  const forceOf = new Map(result.members.map((one) => [one.id, one.force]));
  const anchors = new Set(site.anchors.map(key));

  // The lumped mass at each anchor node, and the whole crane's lumped mass:
  // half of every intact member at each of its ends (specs/statics.md § The
  // load model).
  const anchorMass = new Map<string, number>();
  let memberMass = 0;
  for (const member of structure.members) {
    const mass = distance3(member.a, member.b) * MASS_PER_UNIT[member.material];
    memberMass += mass;
    for (const end of [member.a, member.b]) {
      if (!anchors.has(key(end))) continue;
      anchorMass.set(key(end), (anchorMass.get(key(end)) ?? 0) + mass / 2);
    }
  }

  // Each anchor's vertical reaction: minus the applied force there and every
  // member force pulling on it.
  let carried = 0;
  for (const anchor of site.anchors) {
    let pull = 0;
    for (const member of structure.members) {
      const at = key(anchor);
      const far =
        key(member.a) === at
          ? member.b
          : key(member.b) === at
            ? member.a
            : null;
      if (far === null) continue;
      const force = forceOf.get(member.id);
      assertTrue(
        force !== undefined,
        `the check to report a force for member ${member.id}`,
      );
      pull += (force ?? 0) * ((far.y - anchor.y) / distance3(far, anchor));
    }
    const applied = -(anchorMass.get(key(anchor)) ?? 0) * GRAVITY;
    carried += -(applied + pull);
  }

  assertNear(
    carried,
    GRAVITY * (memberMass + RING_MASS + TROLLEY_MASS) + HOOK_MASS * GRAVITY,
    TOLERANCE,
    "the vertical reaction the four anchors carry: every intact member's " +
      `length times its mass per unit (${memberMass.toFixed(4)}), plus ` +
      `RING_MASS (${RING_MASS}) and TROLLEY_MASS (${TROLLEY_MASS}), times ` +
      `GRAVITY (${GRAVITY}), plus the cable force the bare hook hangs at the ` +
      `trolley point, HOOK_MASS (${HOOK_MASS}) times GRAVITY ` +
      "(specs/statics.md § The load model)",
  );
});
