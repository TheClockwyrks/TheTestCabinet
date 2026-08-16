import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareControl } from "./ShareControl";

// The control reads only the share base off the gallery context.
const gallery = vi.hoisted(() => ({ shareBaseUrl: null as string | null }));
vi.mock("../data/galleryContext", () => ({
  useGalleryData: () => ({ shareBaseUrl: gallery.shareBaseUrl }),
}));

// A UUID run id: its first eight characters (the first hex group) are the code.
const RUN_ID = "2f81c4a9-7b3e-4d1c-9a02-5e6f7a8b9c0d";
const CODE = "2f81c4a9";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gallery.shareBaseUrl = "https://tcab.ai";
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderControl(
  overrides: { published?: boolean; hasPlayableBuild?: boolean } = {},
) {
  const { published = true, hasPlayableBuild = true } = overrides;
  return render(
    <ShareControl
      runId={RUN_ID}
      published={published}
      hasPlayableBuild={hasPlayableBuild}
    />,
  );
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Share this run" }));
}

function clickTarget(label: RegExp) {
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("ShareControl", () => {
  it("offers nothing when no resolver fronts the deployment", () => {
    gallery.shareBaseUrl = null;
    renderControl();
    expect(screen.queryByRole("button", { name: "Share this run" })).toBeNull();
  });

  it("offers nothing for an unpublished run", () => {
    // A short code addresses the published corpus, so an unpublished run has no
    // link that would resolve for whoever received it.
    renderControl({ published: false });
    expect(screen.queryByRole("button", { name: "Share this run" })).toBeNull();
  });

  it("copies the verdict link derived from the run id", async () => {
    renderControl();
    open();
    clickTarget(/Verdict page/);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`https://tcab.ai/r/${CODE}`);
    });
  });

  it("copies the play link", async () => {
    renderControl();
    open();
    clickTarget(/Play page/);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`https://tcab.ai/p/${CODE}`);
    });
  });

  it("shows the link each item copies", () => {
    renderControl();
    open();
    expect(screen.getByText(`tcab.ai/r/${CODE}`)).toBeTruthy();
    expect(screen.getByText(`tcab.ai/p/${CODE}`)).toBeTruthy();
  });

  it("tolerates a trailing slash on the configured base", async () => {
    gallery.shareBaseUrl = "https://tcab.ai/";
    renderControl();
    open();
    clickTarget(/Verdict page/);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`https://tcab.ai/r/${CODE}`);
    });
  });

  it("disables the play link for a run that released no build, and says why", () => {
    renderControl({ hasPlayableBuild: false });
    open();
    const play = screen.getByRole("menuitem", { name: /Play page/ });
    expect(play.hasAttribute("disabled")).toBe(true);
    expect(play.getAttribute("title")).toBe(
      "This run released no playable build",
    );
    // The verdict link is still offered — the run still has a page worth sharing.
    expect(
      screen
        .getByRole("menuitem", { name: /Verdict page/ })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("confirms a copy", async () => {
    renderControl();
    open();
    clickTarget(/Verdict page/);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copied!");
    });
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderControl();
    open();
    clickTarget(/Verdict page/);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Couldn’t reach the clipboard",
      );
    });
  });

  it("reports failure rather than success where there is no clipboard at all", async () => {
    // `navigator.clipboard` is absent in any non-secure context. Awaiting an
    // optional-chained call there resolves, which would confirm a copy that never
    // happened.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    renderControl();
    open();
    clickTarget(/Verdict page/);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Couldn’t reach the clipboard",
      );
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
