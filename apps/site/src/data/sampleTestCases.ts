import type { TestCaseSummary } from "./testCases";

// Design-preview seed data for the test-case catalog. Fabricated entries used
// ONLY so the Test Cases section renders realistic content while
// `test-cases.json` is still sample-quality / empty. They match the shape
// `tcab catalog` emits. `useTestCases` falls back to these only when the real
// dataset is empty; remove this module once the catalog is populated.
export const sampleTestCases: TestCaseSummary[] = [
  {
    slug: "carom",
    name: "Carom",
    difficulty: "easy",
    tags: ["arcade", "2d", "paddle", "physics"],
    description:
      "# Carom\n\n**Carom** is a neon, top-down paddle duel for the browser and the simplest case in the catalog. Its signature mechanic is *spin*: the motion of a paddle as it strikes the ball curves the ball's flight afterward.\n",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    variants: [
      {
        slug: "base",
        name: "Base",
        description: "The standard duel: capped speed ramp and the fixed obstacle layout.",
      },
      {
        slug: "frenzy",
        name: "Frenzy",
        description: "A steeper, uncapped speed ramp so rallies escalate fast.",
      },
      {
        slug: "multi",
        name: "Multi-ball",
        description: "Two balls in play at once for a busier field.",
      },
    ],
    seededInputs: [
      {
        path: "specification.md",
        kind: "text",
        text: "# Carom — Specification\n\nProduce a complete, polished, playable paddle duel that runs entirely in a browser with no backend.\n",
      },
    ],
    referenceScreenshots: [
      { view: "title", url: "/catalog/carom/v1.0.0/reference/title.png" },
      { view: "gameplay", url: "/catalog/carom/v1.0.0/reference/gameplay.png" },
      {
        view: "game-over",
        url: "/catalog/carom/v1.0.0/reference/game-over.png",
      },
    ],
  },
  {
    slug: "phalanx",
    name: "Phalanx",
    difficulty: "medium",
    tags: ["arcade", "2d", "shooter"],
    description:
      "# Phalanx\n\n**Phalanx** is a fixed-shooter where descending ranks of invaders press toward a lone cannon. A medium-difficulty case that demands wave pacing, collision, and escalating difficulty.\n",
    versions: ["v0.9.0"],
    latestVersion: "v0.9.0",
    variants: [
      {
        slug: "base",
        name: "Base",
        description: "The standard campaign: escalating waves toward a lone cannon.",
      },
      {
        slug: "frenzy",
        name: "Frenzy",
        description: "Denser ranks that descend faster, with no rest between waves.",
      },
    ],
    seededInputs: [
      {
        path: "specification.md",
        kind: "text",
        text: "# Phalanx — Specification\n\nImplement a wave-based fixed shooter that runs in the browser with no backend.\n",
      },
    ],
    referenceScreenshots: [
      { view: "wave", url: "/catalog/phalanx/v0.9.0/reference/wave.png" },
      {
        view: "game-over",
        url: "/catalog/phalanx/v0.9.0/reference/game-over.png",
      },
    ],
  },
];
