// assets/particle-systems-distinct — three effects, three systems.
//
// THE RULE, from The particle effects of `specs/assets.md`: "Produce each of
// these with `particle-2d` as a `system.json`, and play it live", over a table of
// THREE rows — Delivery, Fault and Completion — each with a file of its own and
// each fired at a different event. The three are asked for separately because
// they are three different things to a player: a delivery is a set taking its
// product, a fault is the run freezing, and a completion is the challenge solved.
// "Genuinely produced" closes the file on the same footing: "every delivery,
// fault, and completion is a simulated particle system".
//
// WHAT IT READS. What the runtime PARSED from each of the three files, rendered
// as one string apiece with every object's keys in a fixed order, and the three
// strings compared pairwise. Two files that differ only in their whitespace or in
// the order they wrote their keys are the same system and are reported as such,
// which is why the comparison is of the parsed systems rather than of the bytes:
// a point about one system shipped three times under three names would be
// answered wrongly by a comparison a reformatting could pass.
//
// WHAT IT DOES NOT DECIDE. Whether the three read as a delivery, a fault and a
// completion — whether they differ ENOUGH, and in the right direction — is the
// look of the game and is a reviewer's judgement. This point decides only that
// three systems were authored rather than one repeated.
//
// A FILE THE RUNTIME WILL NOT TAKE FAILS THIS POINT, because a file that never
// parsed is not one of three distinct systems. That it parses at all is decided
// on its own by the three `*-system-produced` points; here it is a precondition.
//
// THE EVIDENCE is the three systems plotted side by side from the runtime's own
// captured particles, so the three are compared by eye beside the verdict.

import { it } from "vitest";
import { fail } from "../assert";
import { PARTICLE_FILES, type ParticleName } from "./files";
import { readSystem } from "./particles";
import { canonicalSystem, showSystems } from "./systems";

/** The three rows of the table, in the order `specs/assets.md` tabulates them. */
const NAMES: readonly ParticleName[] = ["deliver", "fault", "complete"];

it("produces a system of its own for each of the three effects", async () => {
  const reads = await Promise.all(
    NAMES.map((name) => readSystem(PARTICLE_FILES[name])),
  );
  showSystems(
    "systems",
    NAMES.map((name, index) => ({
      file: PARTICLE_FILES[name],
      particles: reads[index].particles,
      note: `${name} — ${reads[index].peakLive} particles at its fullest`,
    })),
  );

  const canonical: string[] = [];
  for (const [index, name] of NAMES.entries()) {
    const read = reads[index];
    if (read.system === null) {
      fail(
        `a particle system @test-cabinet/particle-runtime accepts at ${PARTICLE_FILES[name]}`,
        read.reason,
      );
    }
    canonical.push(canonicalSystem(read.system));
  }

  // Reported with `fail` rather than compared with `assertNotEqual`, because the
  // values being compared are whole system documents: what a reviewer needs to
  // read is which two files carry one system, not four kilobytes of JSON twice.
  for (let i = 0; i < NAMES.length; i += 1) {
    for (let j = i + 1; j < NAMES.length; j += 1) {
      if (canonical[i] === canonical[j]) {
        fail(
          `${PARTICLE_FILES[NAMES[i]]} and ${PARTICLE_FILES[NAMES[j]]} to parse to different systems`,
          `both parse to the same ${canonical[i].length}-byte system`,
        );
      }
    }
  }
});
