import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReviewItem, StoredReview } from "../../../../client/types";
import { RunReviewEditor } from "./RunReviewEditor";

// The editor reads its clients, account, catalog, and gallery from contexts that
// are irrelevant to the validator-rated branch under test; stub each at the seam
// the editor reads so the test exercises only the form's own logic.
const fixture = vi.hoisted(() => ({
  submitReview: vi.fn(async () => {}),
  publish: vi.fn(async () => ({ published: true })),
  readReviewItems: vi.fn(async (): Promise<unknown[]> => []),
  local: false,
  // Stable identities, as the real hooks return state: the editor's seeding
  // effects key on the case's domain list, so a fresh object per render would
  // re-seed forever.
  testCase: {
    domains: [],
    variants: [
      {
        slug: "base",
        referenceScreenshots: [],
        domains: [
          { id: "single-player", name: "Single player", description: "" },
          { id: "versus", name: "Versus", description: "" },
        ],
      },
    ],
  },
  gallery: {
    proofMediaFor: () => [],
    assetResultFor: () => null,
    validationMediaFor: () => [],
    // The read-only item browser resolves the run's catalog variant for its
    // reference media; a null resolution just means no expected panes.
    fetchCaseVariant: async () => null,
  },
}));

vi.mock("../../../../client/context", () => ({
  useBackend: () => ({
    client: { readReviewItems: fixture.readReviewItems },
  }),
  useWorkers: () => ({
    active: {
      local: fixture.local,
      client: {
        submitReview: fixture.submitReview,
        publish: fixture.publish,
      },
    },
  }),
}));
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({
    account: { id: "acct-1", displayName: "Reviewer", pictureUrl: null },
    token: "token",
  }),
}));
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => fixture.gallery,
}));
vi.mock("../../../data/useTestCase", () => ({
  useTestCase: () => ({ testCase: fixture.testCase }),
}));
vi.mock("../../account/CoveragePlanPage", () => ({
  topUpAfterReview: async () => {},
}));
vi.mock("../../account/LadderPage", () => ({
  topUpLaddersAfterReview: async () => {},
}));
vi.mock("../../../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: async () => true }),
}));
vi.mock("../../../components/SubmitNotice", () => ({
  SubmitNotice: ({ message }: { message: string | null }) =>
    message ? <p>{message}</p> : null,
}));

const items: ReviewItem[] = [
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
        domains: ["single-player", "versus"],
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
];

// A completed run whose validators passed the serve and failed the AI point.
const run = {
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

function mount(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RunReviewEditor on a validator-rated run", () => {
  it("shows the validators' verdict read-only and asks only for aesthetics", async () => {
    fixture.readReviewItems.mockResolvedValue(items);
    mount(
      <RunReviewEditor
        run={run}
        reviews={[]}
        published={false}
        validatorRated
        onChanged={() => {}}
      />,
    );
    // The checklist loads, then the validators' verdict renders from the record:
    // the functional rating (AI failed at a scuffed cap) and the points.
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeTruthy());
    expect(screen.getAllByText("Scuffed").length).toBeGreaterThan(0);

    // No reviewer control over the checklist: no Pass/Fail radiogroups, no
    // override, no restore, no "Mark unplayable", no functional rating pickers.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Restore validator verdicts/)).toBeNull();
    expect(screen.queryByText("Mark unplayable")).toBeNull();
    expect(screen.queryByText("Ratings")).toBeNull();

    // The automated items can still be BROWSED, though: the read-only item rail
    // is mounted with each checked point navigable, the machine's tally in its
    // summary, and the validators' call shown as a readout, not a control.
    expect(
      screen.getByRole("navigation", { name: "Checked points" }),
    ).toBeTruthy();
    expect(screen.getByText("1/2 passed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ball serves" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "AI paddle tracks the ball (Solo)" }),
    ).toBeTruthy();
    expect(screen.getByText(/Pass, decided by this run/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next →" })).toBeTruthy();

    // What the reviewer is asked for: one aesthetic picker per domain.
    expect(screen.getByText("Aesthetics")).toBeTruthy();
    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(2);
    // Unset until chosen — the scale has no neutral default.
    expect((pickers[0] as HTMLSelectElement).value).toBe("");
  });

  it("walks the browsed items one at a time without offering a verdict", async () => {
    fixture.readReviewItems.mockResolvedValue(items);
    mount(
      <RunReviewEditor
        run={run}
        reviews={[]}
        published={false}
        validatorRated
        onChanged={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeTruthy());

    // Landing on the first point: the passed serve, read from the record.
    expect(
      screen.getByText("Pass, decided by this run’s validators.", {
        exact: false,
      }),
    ).toBeTruthy();

    // Stepping forward shows the failed AI point, still with no control.
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(
      screen.getByText("Fail, decided by this run’s validators.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    // The last point: nothing further to step to.
    expect(
      (screen.getByRole("button", { name: "Next →" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offers Publish without a review, and Submit only once every domain is rated", async () => {
    fixture.readReviewItems.mockResolvedValue(items);
    fixture.submitReview.mockClear();
    mount(
      <RunReviewEditor
        run={run}
        reviews={[]}
        published={false}
        validatorRated
        onChanged={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeTruthy());

    // Zero reviews, yet publish is enabled: the functional rating stands alone.
    const publish = screen.getByRole("button", { name: "Publish run" });
    expect((publish as HTMLButtonElement).disabled).toBe(false);
    expect(publish.getAttribute("title")).toMatch(
      /without an aesthetic review/,
    );

    // Submit waits for a writeup and a tier for every domain.
    const submit = screen.getByRole("button", { name: "Submit review" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/How did the build play/), {
      target: { value: "Looks lovely." },
    });
    const [single, versus] = screen.getAllByRole("combobox");
    fireEvent.change(single!, { target: { value: "amazing" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(versus!, { target: { value: "okay" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    // The submitted review carries aesthetics only — no functional rating and
    // no checklist verdict, both of which the backend refuses on such a run.
    fireEvent.click(submit);
    await waitFor(() => expect(fixture.submitReview).toHaveBeenCalledTimes(1));
    const [, review] = fixture.submitReview.mock.calls[0] as unknown as [
      string,
      {
        ratings: unknown[];
        aesthetics: { domain: string; rating: string }[];
        checklist: unknown[];
        writeup: string;
      },
    ];
    expect(review.ratings).toEqual([]);
    expect(review.checklist).toEqual([]);
    expect(review.aesthetics).toEqual([
      { domain: "single-player", rating: "amazing" },
      { domain: "versus", rating: "okay" },
    ]);
    expect(review.writeup).toBe("Looks lovely.");
  });

  it("shows an existing review's aesthetic badge, not a score", async () => {
    fixture.readReviewItems.mockResolvedValue(items);
    const review = {
      reviewerId: "other",
      reviewer: "Someone",
      ratings: [],
      aesthetics: [
        { domain: "single-player", rating: "good" },
        { domain: "versus", rating: "legendary" },
      ],
      checklist: [],
      writeup: "Fine.",
    } as unknown as StoredReview;
    mount(
      <RunReviewEditor
        run={run}
        reviews={[review]}
        published={false}
        validatorRated
        onChanged={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeTruthy());
    // The aggregate aesthetic (worst across the review's domains) and the
    // review card's own badge; no "pts (avg of …)" for a review with no checklist.
    expect(screen.getAllByLabelText("Aesthetic: Good").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/avg of/)).toBeNull();
  });
});
