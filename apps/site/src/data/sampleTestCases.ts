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
    summary:
      "A neon top-down paddle duel where the swing of a paddle puts spin on the ball, and two fixed obstacles turn the open field into a bank-shot puzzle.",
    description:
      "# Carom\n\n**Carom** is a neon, top-down paddle duel for the browser and the simplest case in the catalog. Its signature mechanic is *spin*: the motion of a paddle as it strikes the ball curves the ball's flight afterward.\n",
    versions: ["v1.0.0"],
    latestVersion: "v1.0.0",
    variants: [
      {
        slug: "base",
        name: "Base",
        description: "The standard duel: capped speed ramp and the fixed obstacle layout.",
        prompt:
          "Build **Carom**, a neon top-down paddle duel that runs entirely in the browser with no backend. The specification is seeded under `specs/`:\n\n- `specs/overview.md`\n- `specs/modes/standard.md`\n",
        seededInputs: [
          {
            path: "specs/overview.md",
            kind: "text",
            text: "# Carom — Overview\n\nProduce a complete, polished, playable paddle duel that runs entirely in a browser with no backend.\n",
          },
          {
            path: "specs/modes/standard.md",
            kind: "text",
            text: "# Standard mode\n\nSolo and Versus play with a capped speed ramp.\n",
          },
        ],
        referenceScreenshots: [
          { view: "title", url: "/catalog/carom/v1.0.0/base/reference/title.png" },
          { view: "gameplay", url: "/catalog/carom/v1.0.0/base/reference/gameplay.png" },
          { view: "game-over", url: "/catalog/carom/v1.0.0/base/reference/game-over.png" },
        ],
      },
      {
        slug: "frenzy",
        name: "Frenzy",
        description: "A steeper, uncapped speed ramp so rallies escalate fast.",
        prompt:
          "Build **Carom**, a neon top-down paddle duel that runs entirely in the browser with no backend. This is the *Frenzy* configuration. The specification is seeded under `specs/`:\n\n- `specs/overview.md`\n- `specs/modes/standard.md`\n- `specs/modes/frenzy.md`\n",
        seededInputs: [
          {
            path: "specs/overview.md",
            kind: "text",
            text: "# Carom — Overview\n\nProduce a complete, polished, playable paddle duel that runs entirely in a browser with no backend.\n",
          },
          {
            path: "specs/modes/standard.md",
            kind: "text",
            text: "# Standard mode\n\nSolo and Versus play with a capped speed ramp.\n",
          },
          {
            path: "specs/modes/frenzy.md",
            kind: "text",
            text: "# Frenzy mode\n\nAn uncapped speed ramp: every paddle hit accelerates the ball with no ceiling.\n",
          },
        ],
        referenceScreenshots: [
          { view: "title", url: "/catalog/carom/v1.0.0/frenzy/reference/title.png" },
          { view: "gameplay", url: "/catalog/carom/v1.0.0/frenzy/reference/gameplay.png" },
          { view: "game-over", url: "/catalog/carom/v1.0.0/frenzy/reference/game-over.png" },
        ],
      },
      {
        slug: "multi",
        name: "Multi-ball",
        description: "Two balls in play at once for a busier field.",
        prompt:
          "Build **Carom**, a neon top-down paddle duel that runs entirely in the browser with no backend. This is the *Multi-ball* configuration. The specification is seeded under `specs/`:\n\n- `specs/overview.md`\n- `specs/modes/standard.md`\n- `specs/modes/multi.md`\n",
        seededInputs: [
          {
            path: "specs/overview.md",
            kind: "text",
            text: "# Carom — Overview\n\nProduce a complete, polished, playable paddle duel that runs entirely in a browser with no backend.\n",
          },
          {
            path: "specs/modes/standard.md",
            kind: "text",
            text: "# Standard mode\n\nSolo and Versus play with a capped speed ramp.\n",
          },
          {
            path: "specs/modes/multi.md",
            kind: "text",
            text: "# Multi-ball mode\n\nTwo balls share the field at once, each scored independently.\n",
          },
        ],
        referenceScreenshots: [
          { view: "title", url: "/catalog/carom/v1.0.0/multi/reference/title.png" },
          { view: "gameplay", url: "/catalog/carom/v1.0.0/multi/reference/gameplay.png" },
          { view: "game-over", url: "/catalog/carom/v1.0.0/multi/reference/game-over.png" },
        ],
      },
    ],
  },
  {
    slug: "phalanx",
    name: "Phalanx",
    difficulty: "medium",
    tags: ["arcade", "2d", "shooter"],
    summary:
      "A fixed-shooter where descending ranks of invaders press toward a lone cannon, demanding wave pacing, tight collision, and an escalating difficulty curve.",
    description:
      "# Phalanx\n\n**Phalanx** is a fixed-shooter where descending ranks of invaders press toward a lone cannon. A medium-difficulty case that demands wave pacing, collision, and escalating difficulty.\n",
    versions: ["v0.9.0"],
    latestVersion: "v0.9.0",
    variants: [
      {
        slug: "base",
        name: "Base",
        description: "The standard campaign: escalating waves toward a lone cannon.",
        prompt:
          "Build **Phalanx**, a wave-based fixed shooter that runs entirely in the browser with no backend. The specification is seeded under `specs/`:\n\n- `specs/overview.md`\n",
        seededInputs: [
          {
            path: "specs/overview.md",
            kind: "text",
            text: "# Phalanx — Overview\n\nImplement a wave-based fixed shooter that runs in the browser with no backend.\n",
          },
        ],
        referenceScreenshots: [
          { view: "wave", url: "/catalog/phalanx/v0.9.0/base/reference/wave.png" },
          { view: "game-over", url: "/catalog/phalanx/v0.9.0/base/reference/game-over.png" },
        ],
      },
      {
        slug: "frenzy",
        name: "Frenzy",
        description: "Denser ranks that descend faster, with no rest between waves.",
        prompt:
          "Build **Phalanx**, a wave-based fixed shooter that runs entirely in the browser with no backend. This is the *Frenzy* configuration. The specification is seeded under `specs/`:\n\n- `specs/overview.md`\n- `specs/modes/frenzy.md`\n",
        seededInputs: [
          {
            path: "specs/overview.md",
            kind: "text",
            text: "# Phalanx — Overview\n\nImplement a wave-based fixed shooter that runs in the browser with no backend.\n",
          },
          {
            path: "specs/modes/frenzy.md",
            kind: "text",
            text: "# Frenzy waves\n\nRanks are denser and descend faster, with no rest between waves.\n",
          },
        ],
        referenceScreenshots: [
          { view: "wave", url: "/catalog/phalanx/v0.9.0/frenzy/reference/wave.png" },
          { view: "game-over", url: "/catalog/phalanx/v0.9.0/frenzy/reference/game-over.png" },
        ],
      },
    ],
  },
];
