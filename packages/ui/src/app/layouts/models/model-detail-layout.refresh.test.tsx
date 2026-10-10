import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ModelDetailLayout } from "./ModelDetailLayout";
import type { BackendClient } from "../../../client/clients";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import { GalleryDataProvider } from "../../data/galleryContext";
import { useModels } from "../../data/useModels";
import { RunsRuntimeProvider, useRunsRuntime } from "../../runtime/runsRuntime";
import { useLiveGallery } from "../../runtime/useLiveGallery";

// The layout's chrome reaches for the app-wide backdrop and the model-config
// capability; neither says anything about how an unresolved model is reported.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../data/useModelConfig", () => ({ useModelConfig: () => null }));

// A model as `GET /models` serves one, carrying what `toModelSummary` reads.
function model(slug: string) {
  return {
    slug,
    name: slug,
    provider: "anthropic",
    curated: true,
    coveredModelIds: [slug],
    aliases: [{ slug, harnessFamily: "openrouter" }],
    description: null,
    logoSvg: null,
    providerLogoUrl: null,
    openrouterSlug: null,
  };
}

// What the config form does on a successful save, in one event handler: request
// the catalog refresh, then navigate to the created model's page.
function SaveAndOpen({ slug }: { slug: string }) {
  const runtime = useRunsRuntime();
  const navigate = useNavigate();
  const { status } = useModels();
  return (
    <button
      type="button"
      onClick={() => {
        runtime.requestRefresh();
        void navigate(`/models/${slug}`);
      }}
    >
      save
      {status === "ready" && <span>catalog ready</span>}
    </button>
  );
}

// The real gallery hook feeding the real provider, as the console mounts them.
function Console() {
  const gallery = useLiveGallery();
  return (
    <GalleryDataProvider value={gallery}>
      <Routes>
        <Route path="/models/new" element={<SaveAndOpen slug="claude" />} />
        <Route
          path="/models/:modelId"
          element={
            <ModelDetailLayout tab="overview">
              {({ model: resolved }) => <p>body for {resolved.slug}</p>}
            </ModelDetailLayout>
          }
        />
      </Routes>
    </GalleryDataProvider>
  );
}

function renderConsole(client: BackendClient) {
  const backendValue = {
    client,
    identity: null,
    status: "ready",
    error: null,
    // No URL, so the hook makes no config fetches over the network.
    url: null,
    setUrl: vi.fn(),
  } as BackendContextValue;
  const workersValue = {
    workers: [],
    activeId: null,
    active: null,
    setActive: vi.fn(),
    addWorker: vi.fn(),
    removeWorker: vi.fn(),
  } as WorkersContextValue;
  render(
    <MemoryRouter initialEntries={["/models/new"]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue}>
          <RunsRuntimeProvider>
            <Console />
          </RunsRuntimeProvider>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// The reported defect, end to end: after adding a model, the page landed on
// named it unknown until the catalog re-read arrived.
describe("ModelDetailLayout opened on a model created a moment ago", () => {
  it("shows the loading state, never unknown, until the re-read lands", async () => {
    // The re-read is held open so the page's state while it is in flight is
    // observed rather than raced.
    const backend = new EventTarget();
    const reread = new Promise<unknown[]>((resolve) => {
      backend.addEventListener("answer", () => {
        resolve([model("gpt"), model("claude")]);
      });
    });
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([model("gpt")])
      .mockReturnValueOnce(reread);
    renderConsole({
      listTestCases: vi.fn().mockResolvedValue([]),
      listTestCaseGroups: vi.fn().mockResolvedValue([]),
      listModels,
    } as unknown as BackendClient);

    // The catalog is ready and does not hold the model about to be created.
    expect(await screen.findByText("catalog ready")).toBeInTheDocument();

    // Every commit from the save onwards is watched, so a single frame naming
    // the model unknown fails the test even if a later one replaces it.
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(document.body.textContent);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    // The first render of the detail page, with the re-read still in flight.
    expect(screen.getByText("Loading model…")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown model/)).not.toBeInTheDocument();
    expect(listModels).toHaveBeenCalledTimes(2);

    await act(async () => {
      backend.dispatchEvent(new Event("answer"));
      await reread;
    });

    expect(await screen.findByText("body for claude")).toBeInTheDocument();
    expect(screen.queryByText("Loading model…")).not.toBeInTheDocument();
    observer.disconnect();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((text) => text.includes("Unknown model"))).toEqual([]);
  });
});
