// Orrery — the challenges the game ships (specs/challenges.md,
// specs/modes/extras.md, specs/modes/campaign.md).
//
// The Extras shelf is fixed: specs/challenges.md is authoritative for all ten,
// and they are written out below exactly as it writes them, in that order. The
// campaign course is this build's own, authored to specs/modes/campaign.md.
//
// Every document here goes through `parseChallenge` at load, so a typo in a
// transcribed challenge is a loud failure at start-up rather than a puzzle
// that quietly cannot be solved.
//
// SEAM: `SOLUTION_DOCUMENTS` is what the reference-solution phase of this
// build fills in — one solution per challenge of each mode, in the solution
// format — so the debug surface's `referenceSolution` is written against it
// and needs no further change.

import { CAMPAIGN_DOCUMENTS } from "./campaign";
import { parseChallenge, parseSolution } from "./formats";
import type { Challenge, Mode, Solution } from "./types";

/** The ten Extras, exactly as specs/challenges.md writes them. */
const EXTRA_DOCUMENTS: unknown[] = [
  {
    name: "First Light",
    reagents: [{ motes: [{ q: 0, r: 0, type: "sol" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "sol" }], filaments: [] }],
    permitted: ["arm"],
    target: 6,
  },
  {
    name: "Twin Moons",
    reagents: [{ motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "luna" },
          { q: 1, r: 0, type: "luna" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["arm", "bind"],
    target: 6,
  },
  {
    name: "Waning Crescent",
    reagents: [{ motes: [{ q: 0, r: 0, type: "comet" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "dust" },
          { q: 1, r: 0, type: "dust" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["arm", "wane", "bind"],
    target: 6,
  },
  {
    name: "Mirrorwright",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "nova" },
          { q: 1, r: 0, type: "comet" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["arm", "wheel", "mirror", "bind"],
    target: 6,
  },
  {
    name: "Ascendant",
    reagents: [
      { motes: [{ q: 0, r: 0, type: "mercury" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "saturn" }], filaments: [] },
    ],
    products: [{ motes: [{ q: 0, r: 0, type: "jupiter" }], filaments: [] }],
    permitted: ["arm", "ascend"],
    target: 6,
  },
  {
    name: "Great Conjunction",
    reagents: [{ motes: [{ q: 0, r: 0, type: "venus" }], filaments: [] }],
    products: [{ motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] }],
    permitted: ["arm", "conjoin"],
    target: 6,
  },
  {
    name: "Syzygy",
    reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "umbra" },
          { q: 1, r: 0, type: "lumen" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
      },
    ],
    permitted: ["arm", "eclipse", "bind"],
    target: 6,
  },
  {
    name: "Aetherfall",
    reagents: [
      { motes: [{ q: 0, r: 0, type: "nebula" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "comet" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] },
      { motes: [{ q: 0, r: 0, type: "meteor" }], filaments: [] },
    ],
    products: [{ motes: [{ q: 0, r: 0, type: "aether" }], filaments: [] }],
    permitted: ["arm", "biarm", "confluence"],
    target: 6,
  },
  {
    name: "Trine",
    reagents: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
    products: [
      {
        motes: [
          { q: 0, r: 0, type: "nova" },
          { q: 1, r: 0, type: "nova" },
        ],
        filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 3 }],
      },
    ],
    permitted: ["arm", "triune"],
    target: 6,
  },
  {
    name: "Procession",
    reagents: [{ motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] }],
    products: [
      {
        motes: [{ q: 0, r: 0, type: "luna" }],
        filaments: [],
        repeat: {
          vector: { q: 1, r: 0 },
          link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
        },
      },
    ],
    permitted: ["arm", "piston", "track", "bind"],
    target: 6,
  },
];

/** The ten Extras, parsed and checked. */
export const EXTRA_CHALLENGES: readonly Challenge[] =
  EXTRA_DOCUMENTS.map(parseChallenge);

/** The campaign course, parsed and checked. */
export const CAMPAIGN_CHALLENGES: readonly Challenge[] =
  CAMPAIGN_DOCUMENTS.map(parseChallenge);

/** The reference solution documents, one per challenge of each mode. */
const SOLUTION_DOCUMENTS: Record<Mode, unknown[]> = {
  campaign: [],
  extras: [],
};

/** The challenges of one mode, in order. */
export function challengesOf(mode: Mode): readonly Challenge[] {
  return mode === "campaign" ? CAMPAIGN_CHALLENGES : EXTRA_CHALLENGES;
}

/** How many challenges a mode ships. */
export function challengeCount(mode: Mode): number {
  return challengesOf(mode).length;
}

/**
 * The build's own reference solution for one challenge, whatever is unlocked
 * or solved (specs/instrumentation.md `referenceSolution`).
 */
export function referenceSolutionFor(mode: Mode, index: number): Solution {
  const document = SOLUTION_DOCUMENTS[mode][index];
  if (document === undefined) {
    throw new Error(
      `referenceSolution: no reference solution is shipped for ${mode} challenge ${index}`,
    );
  }
  return parseSolution(document);
}
