import type { RunRecord } from "@test-cabinet/run-record";

// NOTE: This is a small bundled sample so the gallery renders during local
// development. The REAL dataset is generated at publish time from the published
// run-record artifacts and replaces this module's contents. Nothing here should
// be treated as canonical data.
export const runs: RunRecord[] = [
  {
    id: "run-0001",
    startedAt: "2026-06-01T12:00:00Z",
    finishedAt: "2026-06-01T12:07:30Z",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "1.0.0",
      harnessSlug: "claude",
      harnessVersion: "1.2.3",
      modelId: "claude-opus-4-8",
    },
    metrics: {
      runTimeSeconds: 450,
      tokens: {
        uncachedInput: 12000,
        cachedInput: 48000,
        output: 9000,
        reasoning: 3000,
      },
      cost: {
        comparable: 0.84,
        actual: 0.41,
      },
    },
    validation: {
      loaded: true,
      referenceComparisons: [{ view: "gameplay", similarity: 0.92 }],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/run-0001",
      playableBuild: "https://builds.the-test-cabinet.dev/run-0001/",
    },
    status: {
      state: "completed",
      detail: null,
    },
  },
  {
    id: "run-0002",
    startedAt: "2026-06-02T09:15:00Z",
    finishedAt: "2026-06-02T09:21:10Z",
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "1.0.0",
      harnessSlug: "codex",
      harnessVersion: null,
      modelId: "gpt-x",
    },
    metrics: {
      runTimeSeconds: 370,
      tokens: {
        uncachedInput: 15000,
        cachedInput: 0,
        output: 11000,
        reasoning: 0,
      },
      cost: {
        comparable: 0.62,
        actual: 0.62,
      },
    },
    validation: {
      loaded: false,
      referenceComparisons: [],
    },
    links: {
      sourceRepo: "https://github.com/the-test-cabinet/run-0002",
      playableBuild: null,
    },
    status: {
      state: "failed",
      detail: "Build did not load in the reference runtime.",
    },
  },
];

export function findRun(runId: string): RunRecord | undefined {
  return runs.find((run) => run.id === runId);
}
