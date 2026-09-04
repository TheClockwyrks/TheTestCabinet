// Orrery — the ten Extras, transcribed from `specs/challenges.md`. CASE-PROVIDED,
// and the SAME FILE in all three engine projects.
//
// `specs/challenges.md` is authoritative for the Extras shelf — "Build every
// challenge exactly as written here" — so this is that file as data, in the same
// order, and it is what the `extras/` checks hold a build's shelf against. Every
// document here is quoted; none of them was read off a reference implementation.
//
// The CAMPAIGN's challenges are the build's own invention and no entry here
// describes them. A campaign check reads the course off the build through
// `openChallenge` and holds it against the bounds `specs/modes/campaign.md`
// states, never against a fixed list.

import type { Challenge } from "./formats";

/**
 * The Extras shelf, in the order `specs/challenges.md` numbers it, so
 * `EXTRAS[0]` is challenge 1, "First Light". The list is `EXTRA_COUNT` (`10`)
 * long.
 */
export const EXTRAS: readonly Challenge[] = [
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

/** The Extras' names, in shelf order, which is what a select screen lists. */
export const EXTRA_NAMES: readonly string[] = EXTRAS.map((entry) => entry.name);

/**
 * A fresh copy of the Extra at `index`, so a check that hands one to
 * `loadChallenge` and a check that compares one against a snapshot cannot
 * disturb each other's document.
 */
export function extra(index: number): Challenge {
  const found = EXTRAS[index];
  if (found === undefined) {
    throw new RangeError(
      `Orrery: the Extras shelf holds ${EXTRAS.length} challenges, so there is no index ${index}`,
    );
  }
  return structuredClone(found) as Challenge;
}
