import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@test-cabinet/run-record";
import { RunVerdictPage } from "./RunVerdictPage";

// The read-only Verdict tab as a PUBLIC visitor sees it — the static gallery,
// where `canExecute` is false and no account is signed in. The run chrome is the
// layout's business; hand the body a fixture run directly.
vi.mock("../../../layouts/runs/RunDetailLayout", () => ({
  RunDetailLayout: ({
    children,
  }: {
    children: (ctx: {
      run: RunRecord;
      review: undefined;
      reviews: unknown[];
      published: boolean;
      validatorRated: boolean;
    }) => ReactNode;
  }) =>
    children({
      run: run(),
      review: undefined,
      reviews: [],
      published: true,
      validatorRated: true,
    }),
}));

// The public gallery's data source: nothing executable, no worker — but the
// validation media resolvers DO work there (the static site emits the media and
// baseline maps), which is what lets the comparisons render for visitors.
const gallery = {
  canExecute: false,
  localIds: new Set<string>(),
  proofMediaFor: () => [],
  assetResultFor: () => null,
  voxelResultFor: () => null,
  uiResultFor: () => null,
  materialResultFor: () => null,
  particleResultFor: () => null,
  audioResultFor: () => null,
  replayResultFor: () => null,
  fetchCaseVariant: async () => null,
  validationMediaFor: () => [
    {
      itemId: "rules",
      subItemId: "serve",
      verdictId: "rules.serve",
      id: "serve-shot",
      name: "Serve still",
      kind: "image" as const,
      actualUrl: "https://media.example/actual.png",
      baselineUrl: "https://media.example/baseline.png",
    },
  ],
};
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => gallery,
}));
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ account: null, token: null }),
}));
vi.mock("../../../runtime/runsRuntime", () => ({
  useRunsRuntime: () => ({ requestRefresh: () => {} }),
}));
vi.mock("../../../data/useTestCase", () => ({
  useTestCase: () => ({ testCase: undefined }),
}));
// The scoring model the read-only panel resolves per case, and the variant the
// item browser resolves for reference media — both stubbed at the hook seam.
vi.mock("../../../data/useRunVariant", () => ({
  useReviewModel: () => ({
    status: "ready",
    validatorRated: true,
    domains: [
      { id: "single-player", name: "Single player", description: "" },
    ],
    items: [
      {
        id: "rules",
        title: "Rules",
        text: "",
        weight: 2,
        subItems: [
          {
            id: "serve",
            title: "Ball serves",
            weight: 1,
            failureCap: "broken",
            domains: ["single-player"],
          },
          {
            id: "ai",
            title: "AI paddle tracks the ball (Solo)",
            weight: 1,
            failureCap: "scuffed",
            domains: ["single-player"],
          },
        ],
      },
    ],
  }),
  useRunVariant: () => ({ variant: undefined, status: "ready" }),
}));

// A published, completed, validator-rated run whose validators passed the serve
// and failed the AI point.
function run(): RunRecord {
  return {
    id: "run-1",
    subject: {
      testCaseSlug: "carom",
      testCaseVersion: "v3.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      engineSlug: "simple-2d",
      modelId: "m",
    },
    status: { state: "completed" },
    validation: {
      loaded: true,
      proofs: [],
      debugScripts: [
        {
          itemId: "rules",
          subItemId: null,
          title: "Rules",
          categoryTitle: "Rules",
          script: "validation/rules.mjs",
          gates: true,
          ran: true,
          preconditionUnmet: false,
          verdicts: [
            { id: "rules.serve", pass: true, assertions: [] },
            { id: "rules.ai", pass: false, assertions: [] },
          ],
          outputs: [],
        },
      ],
    },
  } as unknown as RunRecord;
}

describe("RunVerdictPage read-only on a validator-rated run", () => {
  it("mounts the item browser for visitors, with the validators' badges intact", () => {
    render(
      <MemoryRouter>
        <RunVerdictPage />
      </MemoryRouter>,
    );

    // The validators' verdict renders (the points, the domain breakdown)…
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Single player")).toBeTruthy();

    // …and the automated items are browsable: the item rail, the per-point
    // reference-vs-run media pair, and the validators' readout.
    expect(
      screen.getByRole("navigation", { name: "Checked points" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ball serves" })).toBeTruthy();
    expect(screen.getByText("Serve still")).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("This run")).toBeTruthy();
    expect(screen.getByText(/decided by this run/)).toBeTruthy();

    // Read-only throughout: no verdict radiogroups, no restore, no unplayable
    // shortcut, and none of the editor's lifecycle actions.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Restore/)).toBeNull();
    expect(screen.queryByText("Mark unplayable")).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Submit review/ })).toBeNull();
  });
});
