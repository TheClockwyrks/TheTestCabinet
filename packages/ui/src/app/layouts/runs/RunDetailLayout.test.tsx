import { render, screen } from "@testing-library/react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { RunDetailLayout } from "./RunDetailLayout";

// The layout's chrome reads app-wide contexts (backdrop settings, the worker
// connection the delete control needs) that say nothing about which tabs a run
// gets. Stub them so these tests exercise only the tab set and the header badge.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/RunDeleteControl", () => ({
  RunDeleteControl: () => null,
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
vi.mock("../../data/useModels", () => ({
  useFindModel: () => () => null,
}));
// The run the layout resolves. Held in a hoisted cell so each test can swap the
// record in before rendering (a `vi.mock` factory is hoisted above module scope
// and so cannot close over an ordinary `let`).
const fixture = vi.hoisted(() => ({ detail: null as unknown }));
vi.mock("../../data/galleryContext", () => ({
  useGalleryData: () => ({
    fetchRun: async () => fixture.detail,
    localIds: new Set<string>(),
    writeups: {},
    canExecute: false,
    // The layout calls this unguarded to decide whether the Proof tab has an
    // adversarial replay to show; none of these fixtures is an adversarial run.
    replayResultFor: () => null,
  }),
}));

const RUN_ID = "run-1";

// A completed run of the given type. The layout reads the subject, the status,
// and (for the badge) the reviews fetched beside the record.
function record(testType: RunRecord["subject"]["testType"]): RunRecord {
  return {
    id: RUN_ID,
    subject: {
      testCaseSlug: "lattice",
      testCaseVersion: "v1.0.0",
      testType,
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1.2.3",
      modelId: "claude-sonnet-4-5",
    },
    status: { state: "completed", detail: null },
    // `proofs` is read unguarded when the layout decides whether to offer the
    // Proof tab; none of these fixtures declares proof media.
    validation: { loaded: true, proofs: [] },
  } as unknown as RunRecord;
}

// Stand the layout up for one run, with a single `great`-rated review attached so
// the header badge has something to render when the type allows one.
function renderLayout(testType: RunRecord["subject"]["testType"]) {
  fixture.detail = {
    record: record(testType),
    reviews: [
      {
        reviewerId: "u1",
        reviewer: { userId: "u1", username: "u1", displayName: "U One" },
        ratings: [{ domain: "approach", rating: "great" }],
        checklist: [],
        writeup: "Solid.",
        reviewedAt: "2026-06-18T00:00:00Z",
      },
    ],
  };
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}`]}>
      <Routes>
        <Route
          path="/runs/:runId"
          element={
            <RunDetailLayout tab="verdict">{() => null}</RunDetailLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailLayout tabs", () => {
  it("names the default tab Verdict for a human-reviewed run", async () => {
    renderLayout("end-to-end");
    expect(
      await screen.findByRole("link", { name: "Verdict" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Results" })).toBeNull();
  });

  it("names the default tab Results for an auto-graded performance run", async () => {
    renderLayout("performance");
    // A performance run is scored by the harness, so its default tab presents the
    // recorded result rather than a reviewer's verdict.
    expect(
      await screen.findByRole("link", { name: "Results" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Verdict" })).toBeNull();
    // It still has no Play tab — it produces no hostable build.
    expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
  });

  it("shows no review rating badge for a performance run", async () => {
    renderLayout("performance");
    await screen.findByRole("link", { name: "Results" });
    // The badge is derived from a human review's per-domain ratings. A performance
    // run carries no review, so a stray rating riding along with the record must
    // not surface as a headline verdict on an automatically-scored run.
    expect(screen.queryByText(/great/i)).toBeNull();
  });
});
