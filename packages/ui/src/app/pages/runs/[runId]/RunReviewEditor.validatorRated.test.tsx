import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@clockwyrks/run-record";
import type { ReviewItem, StoredReview } from "../../../../client/types";
import { RunReviewEditor } from "./RunReviewEditor";

// The editor reads its clients, account, catalog, and gallery from contexts that
// are irrelevant to the validator-rated branch under test; stub each at the seam
// the editor reads so the test exercises only the form's own logic.
const fixture = vi.hoisted(() => {
  const readReviewItems = vi.fn(async (): Promise<unknown[]> => []);
  return {
    submitReview: vi.fn(async () => {}),
    publish: vi.fn(async () => ({ published: true })),
    readReviewItems,
    // A stable backend identity: the editor's checklist-seeding effect keys on
    // it, so a fresh object per render would re-seed (and wipe an in-progress
    // override) after every interaction.
    backend: { client: { readReviewItems } },
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
      // The verdict surfaces resolve the run's catalog variant for reference
      // media; a null resolution just means no expected panes.
      fetchCaseVariant: async () => null,
    },
  };
});

vi.mock("../../../../client/context", () => ({
  useBackend: () => ({ client: fixture.backend.client }),
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
vi.mock("../../account/coveragePlan", () => ({
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
  it("renders the editable walker pre-filled with the validators' verdicts and ONE aesthetic select", async () => {
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

    // The old lock-out notice is gone — verdicts ARE overridable now.
    expect(screen.queryByText(/not yours to change/)).toBeNull();

    // The checklist walker is EDITABLE: the same rail + one-question-at-a-time
    // panel as a legacy review, with a Pass/Fail radiogroup on the point, every
    // point pre-addressed by the machine, and the bulk restore offered (inert
    // while nothing is overridden). "Mark unplayable" stays off — an override
    // is a point-by-point exception, not a wholesale rewrite.
    expect(
      screen.getByRole("navigation", { name: "Checklist items" }),
    ).toBeTruthy();
    expect(screen.getByText("2/2 addressed")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Verdict" })).toBeTruthy();
    const restore = screen.getByRole("button", {
      name: /Restore validator verdicts/,
    });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Mark unplayable")).toBeNull();
    expect(screen.queryByText("Ratings")).toBeNull();

    // The pre-filled verdict is marked machine-set (the desaturated auto style,
    // carrying its "click to override" affordance).
    expect(
      screen.getByTitle(/Auto-set from this run's debug script/),
    ).toBeTruthy();

    // What the reviewer is asked for: ONE run-wide aesthetic select (not one
    // per domain), unset until chosen, and the aesthetics-focused writeup.
    expect(screen.getByText("Aesthetics")).toBeTruthy();
    const pickers = screen.getAllByRole("combobox");
    expect(pickers).toHaveLength(1);
    expect((pickers[0] as HTMLSelectElement).value).toBe("");
    expect(
      screen.getByPlaceholderText(
        "How does the build look, sound, and feel to play? What stands out, and what falls flat?",
      ),
    ).toBeTruthy();
  });

  it("walks every point with plain Previous/Next despite all being pre-decided", async () => {
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

    // Landing on the first point, the passed serve: Pass is pre-selected.
    const pass = screen.getByRole("radio", { name: "Pass" });
    expect(pass.getAttribute("aria-checked")).toBe("true");

    // Every point is pre-addressed, yet Next still steps to the failed AI
    // point (nearest-unaddressed would strand the walker).
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    const fail = screen.getByRole("radio", { name: "Fail" });
    expect(fail.getAttribute("aria-checked")).toBe("true");
    // The last point: nothing further to step to.
    expect(
      (screen.getByRole("button", { name: "Next →" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offers Publish without a review, and submits no overrides when none were made", async () => {
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

    // Submit waits for a writeup and the run-wide tier.
    const submit = screen.getByRole("button", { name: "Submit review" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(
      screen.getByPlaceholderText(/How does the build look, sound, and feel/),
      { target: { value: "Looks lovely." } },
    );
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "amazing" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    // The submitted review carries the run-wide tier and prose — no functional
    // rating, and an EMPTY checklist: untouched verdicts are not overrides.
    fireEvent.click(submit);
    await waitFor(() => expect(fixture.submitReview).toHaveBeenCalledTimes(1));
    const [, review] = fixture.submitReview.mock.calls[0] as unknown as [
      string,
      {
        ratings: unknown[];
        aesthetic: string | null;
        checklist: unknown[];
        writeup: string;
      },
    ];
    expect(review.ratings).toEqual([]);
    expect(review.checklist).toEqual([]);
    expect(review.aesthetic).toBe("amazing");
    expect(review.writeup).toBe("Looks lovely.");
  });

  it("submits an override as a delta and folds it into the live score", async () => {
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
    // The validators' own live score first: one of two points passing.
    expect(screen.getByText("1 / 2 pts")).toBeTruthy();

    // Step to the failed AI point and override it to Pass.
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pass" }));

    // The live score folds the override in immediately…
    expect(screen.getByText("2 / 2 pts")).toBeTruthy();
    // …the per-point Restore appears, and the bulk restore arms.
    expect(screen.getByRole("button", { name: /^Restore validator/i }));
    expect(
      (
        screen.getByRole("button", {
          name: /Restore validator verdicts \(1\)/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    // Submit: the checklist carries ONLY the delta.
    fireEvent.change(
      screen.getByPlaceholderText(/How does the build look, sound, and feel/),
      { target: { value: "The AI actually works; instrumentation glitched." } },
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "good" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    await waitFor(() => expect(fixture.submitReview).toHaveBeenCalledTimes(1));
    const [, review] = fixture.submitReview.mock.calls[0] as unknown as [
      string,
      { checklist: { id: string; status: string }[]; aesthetic: string },
    ];
    expect(review.checklist).toEqual([{ id: "rules.ai", status: "pass" }]);
    expect(review.aesthetic).toBe("good");
  });

  it("restores an overridden verdict back to the validators' call", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pass" }));
    expect(screen.getByText("2 / 2 pts")).toBeTruthy();

    // The bulk restore (its confirm is stubbed to accept) puts the machine's
    // Fail back and the live score returns to the validators' own.
    fireEvent.click(
      screen.getByRole("button", { name: /Restore validator verdicts \(1\)/ }),
    );
    await waitFor(() => expect(screen.getByText("1 / 2 pts")).toBeTruthy());
    expect(
      screen.getByRole("radio", { name: "Fail" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  // A point whose validator names engines is decided only under those. The run
  // above is built on `simple-2d`, so a point scoped to `none` was never driven
  // and is not on this run's checklist: showing it would invite a verdict the
  // backend refuses (`review overrides a verdict the run's checklist does not
  // carry`), and would count weight the run does not carry.
  it("hides a point whose validator does not cover the run's engine", async () => {
    fixture.readReviewItems.mockResolvedValue([
      ...items,
      {
        id: "debug-overlay",
        title: "Debug overlay",
        text: "",
        weight: 1,
        validation: { engines: ["none"] },
        failureCap: "scuffed",
        domains: ["single-player"],
      },
    ]);
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

    // The rail and the walker carry the two points the run does carry, and the
    // scoped-away one is nowhere in the form.
    expect(screen.getByText("2/2 addressed")).toBeTruthy();
    expect(screen.queryByText("Debug overlay")).toBeNull();
  });

  it("shows an existing review's run-wide aesthetic badge, not a per-card score", async () => {
    fixture.readReviewItems.mockResolvedValue(items);
    const review = {
      reviewerId: "other",
      reviewer: "Someone",
      ratings: [],
      aesthetic: "good",
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
    // The aggregate badge and the review card's own; no "pts (avg of …)" line.
    expect(screen.getAllByLabelText("Aesthetic: Good").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/avg of/)).toBeNull();
  });
});
