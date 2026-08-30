// sprites/head-tiers-distinct — a type's five heads are five drawings.
//
// `specs/overview.md` puts it among the things a player reads at a glance: "the
// five tiers escalate visibly in finish and in firing-effect intensity, so a yard
// of Scrap and a yard of Tesla-Prime read differently on sight".
// `specs/components.md` gives each rung its own reading, from "pitted, rusted, a
// dim flicker" to "mirror-chromed, wreathed in continuous arcs", and
// `specs/assets.md` asks for one head per type per tier — forty separate files.
//
// A ladder produced by copying one file five times satisfies every path and every
// canvas this category checks and none of that, so the five are opened and held
// against each other. Two of them being the same FILE is what this rules out; a
// build that redrew each rung differs in far more than a pixel.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES, TIERS } from "../constants";
import { componentHead, decode, samePixels } from "./png";

it("draws each base type's five heads as five different images", async () => {
  for (const type of COMPONENT_TYPES) {
    const heads = TIERS.map((tier) => ({
      tier,
      png: decode(componentHead(type, tier)),
    }));
    for (let i = 0; i < heads.length; i += 1) {
      for (let j = i + 1; j < heads.length; j += 1) {
        assertEqual(
          samePixels(heads[i]!.png, heads[j]!.png),
          false,
          `whether assets/${componentHead(type, heads[i]!.tier).path} and ` +
            `assets/${componentHead(type, heads[j]!.tier).path} are the same ` +
            "image",
        );
      }
    }
  }

  const h = await createHarness();
  try {
    await openYard(h);
    let col = 6;
    for (const tier of TIERS) {
      await standComponent(h, "discharge", tier, col, 10);
      col += 3;
    }
    await h.debug.clearSelection();
    await h.advance(1);
    await captureStill(h, "ladder");
  } finally {
    await h.dispose();
  }
});
