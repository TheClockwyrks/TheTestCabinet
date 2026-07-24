import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../../client/context";
import type { WorkerClient } from "../../../../client/clients";
import { NewGgRunPage } from "./NewGgRunPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the config/launch logic under test. Stub it, mirroring the run
// monitor's page test, so the test exercises only the form.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// Auth is only read for the bearer token; a local worker needs none, so a
// signed-out stub keeps the gating logic on the primary-slot binding, not auth.
vi.mock("../../../../client/auth", () => ({
  useAuth: () => ({ token: null }),
}));
// The catalog + case-name hooks pull from the backend/gallery data source; stub
// them with a single already-selected case so the only remaining launch gate is
// the primary-model slot (the thing this test asserts on).
vi.mock("../../../runtime/useCatalog", () => ({
  useCatalog: () => ({
    cases: [{ slug: "carom", versions: ["v1.0.0"] }],
    slug: "carom",
    version: "v1.0.0",
    variant: "base",
    versionInfo: {
      variants: [{ slug: "base", name: "Base" }],
      maxRuntimeSeconds: 600,
    },
    error: null,
    loading: false,
    noBackend: false,
    setSlug: () => {},
    setVersion: () => {},
    setVariant: () => {},
  }),
}));
vi.mock("../../../data/useTestCases", () => ({
  useTestCases: () => ({ testCases: [], status: "ready" }),
}));
vi.mock("../../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

// A backend context with no client — the page's `listModels` effect early-returns
// and the ModelCombobox falls back to accepting free-text ids.
const backendValue: BackendContextValue = {
  client: null,
  identity: null,
  status: "unconfigured",
  error: null,
  url: null,
  setUrl: () => {},
};

// A single local worker: `local: true` means no sign-in is required, so launch
// gating comes down to the primary-slot binding.
function workersValue(): WorkersContextValue {
  const client = {
    launchGgRun: vi.fn(),
  } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/runs/gg/new"]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue()}>
          <Routes>
            <Route path="/runs/gg/new" element={<NewGgRunPage />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("NewGgRunPage", () => {
  it("renders gg's capability-set config surface", () => {
    renderPage();
    // The two first-class sections and both Phase-0 capabilities are present.
    expect(screen.getByText("Capability set")).toBeInTheDocument();
    expect(screen.getByText("Primary model slot")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Launch gg run" }),
    ).toBeInTheDocument();
  });

  it("blocks launch until a model is bound to the primary slot", () => {
    renderPage();
    const launch = screen.getByRole("button", { name: "Launch gg run" });
    // A case is selected but no model is bound, so launch is disabled and the
    // blocking reason names the primary-slot binding.
    expect(launch).toBeDisabled();
    expect(
      screen.getByText(/Bind a model to the primary slot/i),
    ).toBeInTheDocument();

    // Binding the offline mock model satisfies the slot; launch enables.
    fireEvent.click(screen.getByRole("checkbox", { name: /Mock/i }));
    expect(launch).toBeEnabled();
  });
});
