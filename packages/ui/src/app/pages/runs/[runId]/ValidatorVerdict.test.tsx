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
    expect(decision.failures.map((f) => f.id)).toEqual([
      "rules.ai",
      "rules.hud",
    ]);
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
    expect(decision.failures).toEqual([]);
  });
});

describe("ValidatorVerdict", () => {
  it("shows the functional rating, points, and which items capped each domain", () => {
    render(<ValidatorVerdict run={run()} model={model} aesthetics={[]} />);

    // The headline: the validator-decided rating and score, before any review.
    expect(screen.getByText("1 / 3")).toBeTruthy();
    // No reviewer has rated the aesthetic channel yet, so there is no aesthetic
    // badge — only the functional one.
    expect(screen.queryByLabelText(/^Aesthetic:/)).toBeNull();
    expect(screen.getByText(/no reviewer has rated it yet/)).toBeTruthy();

    // Per domain: the rating and the failing items that capped it.
    const single = screen.getByText("Single player").closest("li")!;
    const singleCaps = within(single).getByLabelText("Capped by");
    expect(within(singleCaps).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(singleCaps).getByText("AI paddle tracks the ball (Solo)"),
    ).toBeTruthy();
    expect(within(singleCaps).getByText("Scuffed")).toBeTruthy();

    const versus = screen.getByText("Versus").closest("li")!;
    const versusCaps = within(versus).getByLabelText("Capped by");
    expect(within(versusCaps).getAllByRole("listitem")).toHaveLength(1);
    expect(within(versusCaps).getByText("Score readout updates")).toBeTruthy();
  });

  it("shows the aggregate aesthetic beside the functional rating once reviewed", () => {
    render(
      <ValidatorVerdict
        run={run()}
        model={model}
        aesthetics={[
          { domain: "single-player", rating: "amazing" },
          { domain: "versus", rating: "okay" },
        ]}
      />,
    );
    // The overall aesthetic is the worst across domains.
    const aesthetics = screen.getAllByLabelText(/^Aesthetic:/);
    expect(aesthetics[0]!.textContent).toBe("Okay");
    // And each domain shows its own.
    const single = screen.getByText("Single player").closest("li")!;
    expect(within(single).getByLabelText("Aesthetic: Amazing")).toBeTruthy();
  });

  it("renders the checklist read-only from the validators' verdicts", () => {
    render(<ValidatorVerdict run={run()} model={model} aesthetics={[]} />);
    // The machine's verdicts, not a reviewer's: one pass and two fails.
    expect(screen.getAllByText("Pass")).toHaveLength(1);
    expect(screen.getAllByText("Fail")).toHaveLength(2);
    // Nothing here is a control: no override, no restore.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Restore/)).toBeNull();
  });
});
