// sprites/component-types-distinct — the eight types are eight drawings.
//
// `specs/overview.md`: "each of the eight base types reads as its own type, coded
// distinctly from quality so the two axes never collide", and `specs/assets.md`
// asks for a head per type. `specs/components.md` gives each of the eight its own
// job, from a balanced bolt to a support node that never fires at all, so a yard
// a player cannot read the types off is a yard they cannot plan on.
//
// One tier is enough to decide it: the eight heads at that tier are held against
// each other, and two that are the same image are two types a player cannot tell
// apart wherever the ladder has taken them.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES, type Tier } from "../constants";
import { componentHead, decode, samePixels } from "./png";

/** One rung of the ladder: the rule is about the type axis, not the quality one. */
const TIER: Tier = 3;

it("draws the eight base types as eight different heads", async () => {
  const heads = COMPONENT_TYPES.map((type) => ({
    type,
    png: decode(componentHead(type, TIER)),
  }));
  for (let i = 0; i < heads.length; i += 1) {
    for (let j = i + 1; j < heads.length; j += 1) {
      assertEqual(
        samePixels(heads[i]!.png, heads[j]!.png),
        false,
        `whether assets/${componentHead(heads[i]!.type, TIER).path} and ` +
          `assets/${componentHead(heads[j]!.type, TIER).path} are the same ` +
          "image",
      );
    }
  }

  const h = await createHarness();
  try {
    openYard(h);
    let col = 6;
    for (const type of COMPONENT_TYPES) {
      standComponent(h, type, TIER, col, 10);
      col += 3;
    }
    h.debug.clearSelection();
    await h.advance(1);
    captureStill(h, "types");
  } finally {
    h.dispose();
  }
});
