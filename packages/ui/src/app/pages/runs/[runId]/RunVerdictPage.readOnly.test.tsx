import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugScriptResult, RunRecord } from "@clockwyrks/run-record";
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
      // A still carries no table of images, so neither side has anything stored
      // beside it to resolve.
      actualStoreUrl: null,
      baselineStoreUrl: null,
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
    domains: [{ id: "single-player", name: "Single player", description: "" }],
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

// The validators' results the fixture run carries: one whole-item driver that
// passed the serve and failed the AI point. A test about how an outcome READS
// replaces them before rendering.
function decided(): DebugScriptResult[] {
  return [
    {
      itemId: "rules",
      subItemId: null,
      title: "Rules",
      categoryTitle: "Rules",
      script: "validation/rules.mjs",
      gates: true,
      ran: true,
      preconditionUnmet: false,
      inconclusive: null,
      verdicts: [
        { id: "rules.serve", pass: true, assertions: [] },
        { id: "rules.ai", pass: false, assertions: [] },
      ],
      outputs: [],
    },
  ] as unknown as DebugScriptResult[];
}

/** The same case's validators, each having decided nothing for `reason`. A
 * validator drives one verdict unit, so an undecided point is one whose own
 * per-sub-item driver reported back without a verdict. */
function undecided(
  reason: DebugScriptResult["inconclusive"],
): DebugScriptResult[] {
  return ["serve", "ai"].map(
    (subItemId) =>
      ({
        ...decided()[0]!,
        subItemId,
        ran: false,
        preconditionUnmet: true,
        inconclusive: reason,
        detail:
          reason === "timedOut"
            ? "the validators exceeded the 2700 second cap and were stopped"
            : null,
        verdicts: [],
      }) as unknown as DebugScriptResult,
  );
}

let scripts = decided();
beforeEach(() => {
  scripts = decided();
});

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
      debugScripts: scripts,
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
    expect(screen.getByRole("button", { name: /^Ball serves/ })).toBeTruthy();
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

  it("renders each piece of information once: the browser owns the detail", () => {
    render(
      <MemoryRouter>
        <RunVerdictPage />
      </MemoryRouter>,
    );

    // The compact domain strip carries the badge only — the old "capped by"
    // list and the old separate checklist/script sections are gone.
    const single = screen.getByText("Single player").closest("li")!;
    expect(within(single).queryByLabelText("Capped by")).toBeNull();
    expect(screen.queryByText("Automated validation")).toBeNull();

    // The rail is the at-a-glance pass/fail overview: the machine's tally plus
    // per-point ✓/✕ marks.
    expect(screen.getByText("1/2 passed")).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Checked points" });
    expect(within(rail).getAllByText("✓").length).toBeGreaterThan(0);
    expect(within(rail).getAllByText("✕").length).toBeGreaterThan(0);

    // Every rail row shows the tier its point caps at on failure: greyed on the
    // passing serve (its Broken cap is not in force), lit on the failing AI
    // point (its Scuffed cap is).
    const serveNav = screen.getByRole("button", { name: /^Ball serves/ });
    const serveCap = within(serveNav).getByText("Broken");
    expect(serveCap.getAttribute("data-muted")).toBe("true");
    expect(serveCap.getAttribute("title")).toMatch(
      /passed, so its cap does not apply/,
    );
    const aiNav = screen.getByRole("button", {
      name: /^AI paddle tracks the ball \(Solo\)/,
    });
    const aiCap = within(aiNav).getByText("Scuffed");
    expect(aiCap.getAttribute("data-muted")).toBeNull();
    expect(aiCap.getAttribute("title")).toMatch(
      /failed, so its cap is in force/,
    );

    // The first (passing) point's panel also carries its cap line, greyed and
    // saying the cap did not apply.
    const serveNote = screen.getByText(/Failing would cap Single player/);
    expect(serveNote.textContent).toBe(
      "Failing would cap Single player; this item passed, so it does not apply.",
    );
    expect(serveNote.closest("p")!.getAttribute("data-applied")).toBeNull();

    // Stepping to the failing AI point, the browser shows the detail the strip
    // no longer carries: the failure cap (in force) + affected domains, and the
    // backing validator script's state and path.
    fireEvent.click(aiNav);
    const aiNote = screen.getByText("Failing caps Single player.");
    expect(aiNote.closest("p")!.getAttribute("data-applied")).toBe("true");
    const panelCap = within(aiNote.closest("p")!).getByText("Scuffed");
    expect(panelCap.getAttribute("data-muted")).toBeNull();
    expect(panelCap.getAttribute("title")).toMatch(/^Failure cap: Scuffed\./);
    expect(
      screen.getByText(/The validator script ran to completion/),
    ).toBeTruthy();
    expect(screen.getByText("validation/rules.mjs")).toBeTruthy();
  });

  it("says a run stopped at its time budget judged nothing about the build", () => {
    scripts = undecided("timedOut");

    render(
      <MemoryRouter>
        <RunVerdictPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Ball serves/ }));

    // The reason is the host's clock, and it is not dressed up as a fact about
    // the build's world.
    expect(screen.getByText(/ran out of time/)).toBeTruthy();
    expect(screen.queryByText(/precondition was not met/)).toBeNull();
    expect(screen.queryByText(/contract failure/)).toBeNull();
  });

  it("still reads an older record's inconclusive point as an unmet precondition", () => {
    // A record written before the outcomes were told apart carries no reason,
    // which is exactly what this state used to mean.
    scripts = undecided(null);

    render(
      <MemoryRouter>
        <RunVerdictPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Ball serves/ }));

    expect(screen.getByText(/precondition was not met/)).toBeTruthy();
  });
});
