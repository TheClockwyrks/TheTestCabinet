import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@clockwyrks/run-record";
import { RunVerdictPage } from "./RunVerdictPage";
import { RUN_STATE_DOCS_URL, describeRunState } from "../../../data/runState";

// A canceled run: never publishable, kept for inspection, and absent from every
// model statistic — the tier whose consequences a reader is least likely to know.
const run = () =>
  ({
    id: "run-canceled",
    status: {
      state: "canceled",
      detail: "run failed: canceled before the harness session launched",
    },
    subject: { testType: "end-to-end", testCaseSlug: "pong", variant: "base" },
    validation: {},
  }) as unknown as RunRecord;

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
      published: false,
      validatorRated: false,
    }),
}));
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({
    canExecute: false,
    localIds: new Set<string>(),
    replayResultFor: () => null,
    assetResultFor: () => null,
    voxelResultFor: () => null,
    uiResultFor: () => null,
    materialResultFor: () => null,
    particleResultFor: () => null,
    audioResultFor: () => null,
    proofMediaFor: () => [],
    validationMediaFor: () => [],
    fetchCaseVariant: async () => null,
  }),
}));
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ account: null, token: null }),
}));
vi.mock("../../../runtime/runsRuntime", () => ({
  useRunsRuntime: () => ({ requestRefresh: () => {} }),
}));
vi.mock("./RunErrataCallout", () => ({ RunErrataCallout: () => null }));
vi.mock("./AssetResultSection", () => ({ AssetResultSection: () => null }));

describe("the Verdict tab's failure note", () => {
  it("states what the tier means and links the contract behind it", () => {
    // The banner above carries the run's own failure detail, which reports the
    // error and nothing about how the system treats it. The tier's consequences —
    // never publishable, excluded from every model statistic, retained for
    // inspection — are documented knowledge a reader of the gallery still needs,
    // so they are stated here rather than deleted along with the old prose.
    render(
      <MemoryRouter>
        <RunVerdictPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(describeRunState("canceled").consequence),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /terminal states/i })
        .getAttribute("href"),
    ).toBe(RUN_STATE_DOCS_URL);
  });
});
