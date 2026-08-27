import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReviewModel } from "../../../data/galleryContext";
import { ValidatorVerdict, decideValidatorRun } from "./ValidatorVerdict";

// A validator-rated case: two domains, one category of three scored points, each
// with its cap and the domains a failure lowers.
const model: ReviewModel = {
  validatorRated: true,
  domains: [
    { id: "single-player", name: "Single player", description: "Solo." },
    { id: "versus", name: "Versus", description: "Two players." },
  ],
  items: [
    {
      id: "rules",
      title: "Rules",
      text: "",
      weight: 3,
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
        {
          id: "hud",
          title: "Score readout updates",
          weight: 1,
          failureCap: "great",
          domains: ["single-player", "versus"],
        },
      ],
    },
  ],
};

// A completed run whose validators failed the AI point and the HUD point, and
// passed the serve. Only the fields the verdict reads are populated.
function run(
  verdicts: { id: string; pass: boolean }[] = [
    { id: "rules.serve", pass: true },
    { id: "rules.ai", pass: false },
    { id: "rules.hud", pass: false },
  ],
): RunRecord {
  return {
    id: "r-1",
    validation: {
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
          verdicts: verdicts.map((v) => ({ ...v, assertions: [] })),
          outputs: [],
        },
      ],
    },
  } as unknown as RunRecord;
}

describe("decideValidatorRun", () => {
  it("caps each domain at the lowest cap among its failing points", () => {
    const decision = decideValidatorRun(run(), model);
    // Single player: AI (scuffed) and HUD (great) failed → scuffed.
    expect(decision.domainRatings.get("single-player")).toBe("scuffed");
    // Versus: only the HUD (great) failed → great.
    expect(decision.domainRatings.get("versus")).toBe("great");
    // The run: the worst across its domains.
    expect(decision.rating).toBe("scuffed");
    // Points: the one validated point that passed, over the three validated.
    expect(decision.score).toMatchObject({ earned: 1, total: 3 });
  });

  it("is Flawless with full points when nothing failed", () => {
    const decision = decideValidatorRun(
      run([
        { id: "rules.serve", pass: true },
        { id: "rules.ai", pass: true },
        { id: "rules.hud", pass: true },
      ]),
      model,
    );
    expect(decision.rating).toBe("flawless");
    expect(decision.score).toMatchObject({ earned: 3, total: 3 });
  });

  it("reproduces the validators' figures for a review with no overrides", () => {
    const withReview = decideValidatorRun(run(), model, [
      { checklist: [], aesthetic: "good" },
    ]);
    const without = decideValidatorRun(run(), model);
    expect(withReview.rating).toBe(without.rating);
    expect(withReview.score).toMatchObject({
      earned: without.score.earned,
      total: without.score.total,
    });
  });

  it("folds a reviewer's overrides into the rating and score", () => {
    // The reviewer overrides the failing AI point to pass: Single player's only
    // remaining failure is the HUD (great cap), so the run recovers to great,
    // and the score climbs to 2 / 3.
    const decision = decideValidatorRun(run(), model, [
      { checklist: [{ id: "rules.ai", status: "pass" }], aesthetic: "good" },
    ]);
    expect(decision.domainRatings.get("single-player")).toBe("great");
    expect(decision.rating).toBe("great");
    expect(decision.score).toMatchObject({ earned: 2, total: 3 });
  });

  it("aggregates worst rating and average score across several reviews", () => {
    const decision = decideValidatorRun(run(), model, [
      // One reviewer recovers the AI point (2/3, great)…
      { checklist: [{ id: "rules.ai", status: "pass" }] },
      // …the other stands on the validators' verdicts (1/3, scuffed).
      { checklist: [] },
    ]);
    expect(decision.rating).toBe("scuffed");
    expect(decision.score).toMatchObject({ earned: 1.5, total: 3 });
  });
});

describe("ValidatorVerdict", () => {
  it("shows the rating, points, and a compact per-domain strip", () => {
    render(<ValidatorVerdict run={run()} model={model} reviews={[]} />);

    // The headline: the validator-decided rating and score, before any review.
    expect(screen.getByText("1 / 3")).toBeTruthy();
    // No reviewer has rated the aesthetic channel yet, so there is no aesthetic
    // badge — only the functional one.
    expect(screen.queryByLabelText(/^Aesthetic:/)).toBeNull();
    expect(screen.getByText(/no reviewer has rated it yet/)).toBeTruthy();
    // The explainer says overrides are possible, not that verdicts are locked.
    expect(screen.getByText(/can override any point/)).toBeTruthy();

    // Per domain: the effective functional badge ONLY — no "capped by" list
    // (that detail lives in the item browser now) and no per-domain aesthetic.
    const single = screen.getByText("Single player").closest("li")!;
    expect(within(single).getByText("Scuffed")).toBeTruthy();
    expect(within(single).queryByLabelText("Capped by")).toBeNull();
    expect(
      within(single).queryByText("AI paddle tracks the ball (Solo)"),
    ).toBeNull();
    const versus = screen.getByText("Versus").closest("li")!;
    expect(within(versus).getByText("Great")).toBeTruthy();
    expect(within(versus).queryByLabelText("Capped by")).toBeNull();
  });

  it("shows the aggregate run-wide aesthetic once reviewed", () => {
    render(
      <ValidatorVerdict
        run={run()}
        model={model}
        reviews={[
          { checklist: [], aesthetic: "amazing" },
          { checklist: [], aesthetic: "okay" },
        ]}
      />,
    );
    // The overall aesthetic is the worst run-wide tier across reviews, and it is
    // the only aesthetic badge — domains carry none of their own.
    const aesthetics = screen.getAllByLabelText(/^Aesthetic:/);
    expect(aesthetics).toHaveLength(1);
    expect(aesthetics[0]!.textContent).toBe("Okay");
  });

  it("reads a legacy stored review's per-domain tiers collapsed to worst", () => {
    render(
      <ValidatorVerdict
        run={run()}
        model={model}
        reviews={[
          {
            checklist: [],
            aesthetics: [
              { domain: "single-player", rating: "amazing" },
              { domain: "versus", rating: "okay" },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("Aesthetic: Okay")).toBeTruthy();
  });

  it("folds a reviewer's override into the shown rating and score", () => {
    render(
      <ValidatorVerdict
        run={run()}
        model={model}
        reviews={[
          {
            checklist: [{ id: "rules.ai", status: "pass" }],
            aesthetic: "good",
          },
        ]}
      />,
    );
    // The recovered AI point lifts the score to 2 / 3 and the rating to Great:
    // the headline badge and both domain badges now read Great.
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getAllByText("Great").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Scuffed")).toBeNull();
  });

  it("renders no checklist and no script table — the item browser owns that detail", () => {
    render(<ValidatorVerdict run={run()} model={model} reviews={[]} />);
    expect(screen.queryByText("Automated validation")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Restore/)).toBeNull();
    expect(screen.queryByText("validation/rules.mjs")).toBeNull();
  });
});
