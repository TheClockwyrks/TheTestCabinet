import type { RunRecord } from "@test-cabinet/run-record";

// Design-preview seed data. These are fabricated run records used ONLY to give
// the gallery designs realistic content to render while the published dataset
// (`runs.json`) is still empty. They are not real results and are never mixed
// with published runs: `data/runs.ts` falls back to these only when no runs have
// been published yet. Remove this module once real runs populate the gallery.
export const sampleRuns: RunRecord[] = [
  {
    id: "sample-pong-codex",
    startedAt: "2026-06-15T04:32:47Z",
    finishedAt: "2026-06-15T04:36:29Z",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "v1.0.0",
      variant: "base",
      harnessSlug: "codex",
      harnessVersion: "0.139.0",
      modelId: "gpt-5.4-mini",
    },
    tooling: { testCabinetCommit: "a1f4c9e2b7d3068f5e1a9c4b2d7e6f0813a5c9d2" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/codex:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 216,
      tokens: {
        uncachedInput: 43791,
        cachedInput: 552960,
        output: 26422,
        reasoning: 12250,
      },
      cost: { comparable: 0.2483, actual: 0.2483 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "title", name: "Title", reached: true, similarity: 0.969, detail: null },
        { view: "rally", name: "Rally", reached: true, similarity: 0.882, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-pong-codex",
      playableBuild: "https://builds.testcabinet.ai/sample-pong-codex/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-carom-claude",
    startedAt: "2026-06-15T05:01:10Z",
    finishedAt: "2026-06-15T05:18:44Z",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "v1.2.0",
      variant: "frenzy",
      harnessSlug: "claude",
      harnessVersion: "2.1.0",
      modelId: "claude-opus-4-8",
    },
    tooling: { testCabinetCommit: "b2e5d0f3c8a4179061f2b0d5c3e8f7a924b6d0e3" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/claude:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 1054,
      tokens: {
        uncachedInput: 88210,
        cachedInput: 1840221,
        output: 73904,
        reasoning: 41880,
      },
      cost: { comparable: 1.842, actual: 1.79 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "menu", name: "Menu", reached: true, similarity: 0.941, detail: null },
        { view: "match", name: "Match", reached: true, similarity: 0.873, detail: null },
        { view: "spin", name: "Spin", reached: true, similarity: 0.79, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-carom-claude",
      playableBuild: "https://builds.testcabinet.ai/sample-carom-claude/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-phalanx-gemini",
    startedAt: "2026-06-15T06:10:00Z",
    finishedAt: "2026-06-15T06:29:51Z",
    subject: {
      testCaseSlug: "phalanx",
      testCaseVersion: "v0.9.0",
      variant: "base",
      harnessSlug: "opencode",
      harnessVersion: "0.42.1",
      modelId: "gemini-3.0-pro",
    },
    tooling: { testCabinetCommit: "c3f6e1a4d9b528a172e3c1f6d4a9e8b035c7e1f4" },
    environment: {
      os: "Ubuntu 24.04.1 LTS",
      containerImage: "test-cabinet/opencode:latest",
      nodeVersion: "v20.18.1",
    },
    metrics: {
      runTimeSeconds: 1191,
      tokens: {
        uncachedInput: 102338,
        cachedInput: 990120,
        output: 64115,
        reasoning: 0,
      },
      cost: { comparable: 0.971, actual: 0.971 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "wave", name: "Wave", reached: true, similarity: 0.704, detail: null },
        {
          view: "game-over",
          name: "Game Over",
          reached: false,
          similarity: 0,
          detail: "could not reach game-over screen",
        },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-phalanx-gemini",
      playableBuild: "https://builds.testcabinet.ai/sample-phalanx-gemini/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-serpentine-goose",
    startedAt: "2026-06-15T07:00:00Z",
    finishedAt: "2026-06-15T07:09:12Z",
    subject: {
      testCaseSlug: "serpentine",
      testCaseVersion: "v1.0.0",
      variant: "multi",
      harnessSlug: "goose",
      harnessVersion: "1.5.2",
      modelId: "gpt-5.4",
    },
    tooling: { testCabinetCommit: "d4a7f2b5e0c639b283f4d2a7e5b0f9c146d8f2a5" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/goose:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 552,
      tokens: {
        uncachedInput: 51002,
        cachedInput: 612480,
        output: 38770,
        reasoning: 19044,
      },
      cost: { comparable: 0.612, actual: 0.64 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "board", name: "Board", reached: true, similarity: 0.915, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-serpentine-goose",
      playableBuild: "https://builds.testcabinet.ai/sample-serpentine-goose/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-brickfall-cline",
    startedAt: "2026-06-15T08:15:00Z",
    finishedAt: "2026-06-15T08:21:33Z",
    subject: {
      testCaseSlug: "brickfall",
      testCaseVersion: "v0.4.0",
      variant: "base",
      harnessSlug: "cline",
      harnessVersion: "3.2.0",
      modelId: "claude-sonnet-4-6",
    },
    tooling: { testCabinetCommit: "e5b8a3c6f1d74ac394a5e3b8f6c1a0d257e9a3b6" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/cline:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 393,
      tokens: {
        uncachedInput: 34880,
        cachedInput: 410220,
        output: 21044,
        reasoning: 8800,
      },
      cost: { comparable: 0.331, actual: 0.331 },
    },
    validation: {
      loaded: false,
      detail: "build threw on startup: missing canvas context",
      install: { command: "npm ci", succeeded: true, detail: null },
      build: {
        command: "npm run build",
        succeeded: false,
        detail: "build threw on startup: missing canvas context",
      },
      checks: [],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-brickfall-cline",
      playableBuild: null,
    },
    status: {
      state: "failed",
      detail: "Implementation does not boot.",
    },
  },
  {
    id: "sample-cascade-kilo",
    startedAt: "2026-06-15T09:40:00Z",
    finishedAt: "2026-06-15T10:12:08Z",
    subject: {
      testCaseSlug: "cascade",
      testCaseVersion: "v1.1.0",
      variant: "frenzy",
      harnessSlug: "kilo",
      harnessVersion: "0.7.4",
      modelId: "gpt-5.4",
    },
    tooling: { testCabinetCommit: "f6c9b4d7a2e85bd4a5b6f4c9a7d2b1e368fab4c7" },
    environment: {
      os: "Ubuntu 24.04.1 LTS",
      containerImage: "test-cabinet/kilo:latest",
      nodeVersion: "v20.18.1",
    },
    metrics: {
      runTimeSeconds: 1928,
      tokens: {
        uncachedInput: 142003,
        cachedInput: 2210880,
        output: 98220,
        reasoning: 55110,
      },
      cost: { comparable: 2.41, actual: 2.41 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "well", name: "Well", reached: true, similarity: 0.86, detail: null },
        {
          view: "line-clear",
          name: "Line Clear",
          reached: true,
          similarity: 0.812,
          detail: null,
        },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-cascade-kilo",
      playableBuild: "https://builds.testcabinet.ai/sample-cascade-kilo/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-belt-antigravity",
    startedAt: "2026-06-15T11:05:00Z",
    finishedAt: "2026-06-15T11:33:47Z",
    subject: {
      testCaseSlug: "belt",
      testCaseVersion: "v0.8.0",
      variant: "base",
      harnessSlug: "antigravity",
      harnessVersion: null,
      modelId: "gemini-3.0-flash",
    },
    tooling: { testCabinetCommit: "a7dac5e8b3f96ce5b6c7a5dab8e3c2f479abc5d8" },
    environment: {
      os: "unknown",
      containerImage: "test-cabinet/antigravity:latest",
      nodeVersion: null,
    },
    metrics: {
      runTimeSeconds: 1727,
      tokens: {
        uncachedInput: 77410,
        cachedInput: 880200,
        output: 52900,
        reasoning: 0,
      },
      cost: { comparable: 0.704, actual: 0.704 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        {
          view: "field",
          name: "Field",
          reached: true,
          similarity: 0.58,
          detail: "ship sprite missing",
        },
      ],
    },
    links: {
      sourceRepo: null,
      playableBuild: "https://builds.testcabinet.ai/sample-belt-antigravity/",
    },
    status: {
      state: "unevaluable",
      detail: "Renders but core mechanic is non-functional.",
    },
  },
  {
    id: "sample-pong-pi",
    startedAt: "2026-06-15T12:20:00Z",
    finishedAt: "2026-06-15T12:24:02Z",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "v1.0.0",
      variant: "frenzy",
      harnessSlug: "pi",
      harnessVersion: "0.3.1",
      modelId: "claude-haiku-4-5",
    },
    tooling: { testCabinetCommit: "b8ebd6f9c4a07df6c7d8b6ebc9f4d3a58abcd6e9" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/pi:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 242,
      tokens: {
        uncachedInput: 29110,
        cachedInput: 305400,
        output: 18220,
        reasoning: 6010,
      },
      cost: { comparable: 0.119, actual: 0.119 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "title", name: "Title", reached: true, similarity: 0.844, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-pong-pi",
      playableBuild: "https://builds.testcabinet.ai/sample-pong-pi/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-carom-codex-base",
    startedAt: "2026-06-15T13:05:00Z",
    finishedAt: "2026-06-15T13:18:21Z",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "v1.2.0",
      variant: "base",
      harnessSlug: "codex",
      harnessVersion: "0.139.0",
      modelId: "gpt-5.4",
    },
    tooling: { testCabinetCommit: "c9fce7a0d5b18ea7d8e9c7fcda05e4b69bcde7fa" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/codex:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 801,
      tokens: {
        uncachedInput: 71240,
        cachedInput: 1402330,
        output: 58110,
        reasoning: 30220,
      },
      cost: { comparable: 1.214, actual: 1.214 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "menu", name: "Menu", reached: true, similarity: 0.92, detail: null },
        { view: "match", name: "Match", reached: true, similarity: 0.851, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-carom-codex-base",
      playableBuild: "https://builds.testcabinet.ai/sample-carom-codex-base/",
    },
    status: { state: "completed", detail: null },
  },
  {
    id: "sample-carom-goose-multi",
    startedAt: "2026-06-15T14:12:00Z",
    finishedAt: "2026-06-15T14:33:48Z",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "v1.2.0",
      variant: "multi",
      harnessSlug: "goose",
      harnessVersion: "1.5.2",
      modelId: "gemini-3.0-pro",
    },
    tooling: { testCabinetCommit: "dab0f8b1e6c29fb8e9fad80fdeb16f5c7acdef0b" },
    environment: {
      os: "Debian GNU/Linux 12 (bookworm)",
      containerImage: "test-cabinet/goose:latest",
      nodeVersion: "v22.14.0",
    },
    metrics: {
      runTimeSeconds: 1308,
      tokens: {
        uncachedInput: 95110,
        cachedInput: 1980040,
        output: 81230,
        reasoning: 0,
      },
      cost: { comparable: 1.553, actual: 1.553 },
    },
    validation: {
      loaded: true,
      detail: null,
      install: { command: "npm ci", succeeded: true, detail: null },
      build: { command: "npm run build", succeeded: true, detail: null },
      checks: [
        { view: "menu", name: "Menu", reached: true, similarity: 0.889, detail: null },
        { view: "match", name: "Match", reached: true, similarity: 0.812, detail: null },
        { view: "spin", name: "Spin", reached: true, similarity: 0.741, detail: null },
      ],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/sample-carom-goose-multi",
      playableBuild: "https://builds.testcabinet.ai/sample-carom-goose-multi/",
    },
    status: { state: "completed", detail: null },
  },
];
