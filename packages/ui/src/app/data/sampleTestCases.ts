import type { TestCaseSummary } from "./testCases";

// Design-preview seed data for the test-case catalog. Fabricated entries used
// ONLY so the Test Cases section renders realistic content while the published
// catalog (the backend's R2 snapshot) is still empty. `useTestCases` falls back
// to these only when the real dataset is empty; remove this module once the
// catalog is populated.
export const sampleTestCases: TestCaseSummary[] = [
  {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
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
          { view: "title", kind: "image", url: "/catalog/carom/v1.0.0/base/reference/title.png" },
          { view: "gameplay", kind: "image", url: "/catalog/carom/v1.0.0/base/reference/gameplay.png" },
          { view: "game-over", kind: "image", url: "/catalog/carom/v1.0.0/base/reference/game-over.png" },
        ],
        reviewItems: [
          { id: "ball-spin", title: "Paddle spin", text: "A swinging paddle curves the ball's flight.", weight: 1 },
          { id: "scoring", title: "Scoring", text: "A ball crossing a goal edge scores for the opposite side.", weight: 1 },
          { id: "ai-beatable", title: "Beatable AI", text: "The AI opponent is competent but clearly beatable.", weight: 1, domain: "single-player" },
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
          { view: "title", kind: "image", url: "/catalog/carom/v1.0.0/frenzy/reference/title.png" },
          { view: "gameplay", kind: "image", url: "/catalog/carom/v1.0.0/frenzy/reference/gameplay.png" },
          { view: "game-over", kind: "image", url: "/catalog/carom/v1.0.0/frenzy/reference/game-over.png" },
        ],
        reviewItems: [
          { id: "ball-spin", title: "Paddle spin", text: "A swinging paddle curves the ball's flight.", weight: 1 },
          { id: "scoring", title: "Scoring", text: "A ball crossing a goal edge scores for the opposite side.", weight: 1 },
          { id: "ai-beatable", title: "Beatable AI", text: "The AI opponent is competent but clearly beatable.", weight: 1, domain: "single-player" },
          { id: "frenzy-escalation", title: "Frenzy escalation", text: "Ball speed escalates uncapped each hit.", weight: 1 },
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
          { view: "title", kind: "image", url: "/catalog/carom/v1.0.0/multi/reference/title.png" },
          { view: "gameplay", kind: "image", url: "/catalog/carom/v1.0.0/multi/reference/gameplay.png" },
          { view: "game-over", kind: "image", url: "/catalog/carom/v1.0.0/multi/reference/game-over.png" },
        ],
        reviewItems: [
          { id: "ball-spin", title: "Paddle spin", text: "A swinging paddle curves the ball's flight.", weight: 1 },
          { id: "scoring", title: "Scoring", text: "A ball crossing a goal edge scores for the opposite side.", weight: 1 },
          { id: "ai-beatable", title: "Beatable AI", text: "The AI opponent is competent but clearly beatable.", weight: 1, domain: "single-player" },
          { id: "multi-two-balls", title: "Two balls in play", text: "Two balls share the field, scored independently.", weight: 1 },
        ],
      },
    ],
    domains: [
      { id: "single-player", name: "Single Player", description: "Solo play against the AI opponent." },
      { id: "versus", name: "Versus", description: "Two-player local play, no AI." },
    ],
  },
  {
    slug: "phalanx",
    name: "Phalanx",
    testType: "end-to-end",
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
          { view: "wave", kind: "image", url: "/catalog/phalanx/v0.9.0/base/reference/wave.png" },
          { view: "game-over", kind: "image", url: "/catalog/phalanx/v0.9.0/base/reference/game-over.png" },
        ],
        reviewItems: [
          { id: "wave-pacing", title: "Wave pacing", text: "Waves escalate at a fair, readable pace.", weight: 1 },
          { id: "collision", title: "Tight collision", text: "Shots and invaders collide precisely.", weight: 1 },
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
          { view: "wave", kind: "image", url: "/catalog/phalanx/v0.9.0/frenzy/reference/wave.png" },
          { view: "game-over", kind: "image", url: "/catalog/phalanx/v0.9.0/frenzy/reference/game-over.png" },
        ],
        reviewItems: [
          { id: "wave-pacing", title: "Wave pacing", text: "Waves escalate at a fair, readable pace.", weight: 1 },
          { id: "collision", title: "Tight collision", text: "Shots and invaders collide precisely.", weight: 1 },
        ],
      },
    ],
    domains: [
      { id: "gameplay", name: "Gameplay", description: "The single-player wave campaign." },
    ],
  },
];
