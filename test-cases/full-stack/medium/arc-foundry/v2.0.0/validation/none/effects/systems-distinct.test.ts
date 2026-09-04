// Arc Foundry — effects/systems-distinct: the twelve systems are twelve authored
// effects rather than one file committed twelve times.
//
// THE REQUIREMENT. `specs/assets.md` gives each of the twelve a row of its own
// naming what it carries — "a shower of sparks and a snap of arc", "forked
// lightning between each unit the chain strikes, dimming per leap", "an expanding
// ring covering the splash radius" — and `particle-2d` "authors a system as
// emitters, forces, and per-particle curves". Twelve rows describing twelve
// different things cannot be satisfied by one authored system, so no two of the
// twelve are the same authored system.
//
// WHAT COUNTS AS THE SAME SYSTEM, AND WHY THE COLORS ARE DROPPED. The comparison
// is over the authored shape of `./systems.ts`: the field and duration, the global
// forces, and every emitter's shape, position, extent, emission, lifetime, speed,
// direction, cone, force overrides and per-particle size, opacity, rotation and
// stretch curves. The color stops are deliberately left out, because a build that
// authored one burst and recolored it twelve times has committed one effect
// twelve times, which is exactly what this point exists to catch. Whether the
// three status effects carry colors of their own is a separate point of its own.
//
// EXACT, AND IN ONE DIRECTION ONLY. Two systems that differ anywhere in that shape
// are two systems; how DIFFERENT they look is the aesthetic rating's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";
import { tileCenter } from "../constants";
import { evidence } from "./region";
import { EFFECTS, authoredShape, readSystem } from "./systems";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("authors twelve different systems", async () => {
  await evidence(h, "fx", async () => {
    await openYard(h, { wave: 1 });
    await standComponent(h, "coil", 3, 20, 14);
    await parkUnit(h, "slug", tileCenter(25, 15));
    await h.advanceSeconds(1);
  });

  const shapes = EFFECTS.map((effect) => authoredShape(readSystem(effect)));
  const repeated: string[] = [];
  for (let i = 0; i < EFFECTS.length; i += 1) {
    for (let j = i + 1; j < EFFECTS.length; j += 1) {
      if (shapes[i] === shapes[j]) {
        repeated.push(`fx/${EFFECTS[i]}.json and fx/${EFFECTS[j]}.json`);
      }
    }
  }
  assertDeepEqual(
    repeated,
    [],
    "no two of the twelve systems to be the same authored effect — the same " +
      "emitters, forces and per-particle curves (specs/assets.md)",
  );
});
