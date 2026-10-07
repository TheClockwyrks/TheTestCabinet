import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidationMedia } from "../../../data/galleryContext";
import * as download from "./download";
import { ValidationMediaPair } from "./ValidationMediaPair";

/** A still captured on both sides. */
function media(overrides: Partial<ValidationMedia> = {}): ValidationMedia {
  return {
    itemId: "serve",
    subItemId: null,
    verdictId: "serve",
    id: "still",
    name: "Serve still",
    kind: "image",
    actualUrl: "https://example.test/runs/r1/serve__still.png",
    baselineUrl: "https://example.test/cases/serve__still.png",
    actualStoreUrl: null,
    baselineStoreUrl: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the media comparison", () => {
  it("labels the figure by the output's name without printing it", () => {
    render(<ValidationMediaPair media={media()} />);
    expect(screen.queryByText("Serve still")).toBeNull();
    expect(screen.getByRole("figure", { name: "Serve still" })).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("This run")).toBeTruthy();
  });

  it("downloads each side's captured file as it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(url, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const save = vi
      .spyOn(download, "downloadBlob")
      .mockImplementation(() => {});
    render(<ValidationMediaPair media={media()} />);

    fireEvent.click(screen.getByRole("button", { name: "Download reference" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "https://example.test/cases/serve__still.png",
    );
    expect(save.mock.calls[0]![1]).toBe("serve-still-reference.png");

    fireEvent.click(screen.getByRole("button", { name: "Download this run" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenLastCalledWith(
      "https://example.test/runs/r1/serve__still.png",
    );
    expect(save.mock.calls[1]![1]).toBe("serve-still-run.png");
  });

  it("offers no download for a side this run did not produce", () => {
    render(<ValidationMediaPair media={media({ actualUrl: null })} />);
    expect(screen.getByText(/did not produce this output/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download this run" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Download reference" }),
    ).toBeEnabled();
  });

  it("says a failed download failed, and lets the reviewer retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const save = vi
      .spyOn(download, "downloadBlob")
      .mockImplementation(() => {});
    render(<ValidationMediaPair media={media()} />);

    const button = screen.getByRole("button", { name: "Download reference" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(button.getAttribute("data-status")).toBe("error"),
    );
    expect(button).toBeEnabled();
    expect(button.getAttribute("title")).toMatch(/failed/);
    expect(save).not.toHaveBeenCalled();
  });
});
