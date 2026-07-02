import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The download itself pokes the DOM / object URLs; assert we call it correctly
// rather than exercising a real save.
const downloadBlob = vi.fn();
vi.mock("./download", () => ({
  downloadBlob: (blob: Blob, filename: string) => downloadBlob(blob, filename),
}));

import { GifDownloadButton } from "./GifDownloadButton";

beforeEach(() => {
  downloadBlob.mockReset();
});

describe("GifDownloadButton", () => {
  it("encodes, then downloads the blob under the given filename", async () => {
    const blob = new Blob(["gif"], { type: "image/gif" });
    const encode = vi.fn().mockResolvedValue(blob);
    render(<GifDownloadButton filename="walk.gif" encode={encode} />);

    fireEvent.click(screen.getByRole("button", { name: "Download GIF" }));

    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "walk.gif"),
    );
    expect(encode).toHaveBeenCalledTimes(1);
    // Returns to idle so it can be pressed again.
    expect(screen.getByRole("button", { name: "Download GIF" })).toBeEnabled();
  });

  it("shows a busy label and blocks re-entry while encoding", async () => {
    let resolveEncode: (blob: Blob) => void = () => {};
    const encode = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          resolveEncode = resolve;
        }),
    );
    render(<GifDownloadButton filename="walk.gif" encode={encode} />);

    fireEvent.click(screen.getByRole("button", { name: "Download GIF" }));

    const busy = screen.getByRole("button", { name: "Preparing GIF…" });
    expect(busy).toBeDisabled();
    // A second click while working must not kick off a second encode.
    fireEvent.click(busy);
    expect(encode).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveEncode(new Blob(["gif"], { type: "image/gif" }));
    });
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  });

  it("reports a failed encode and stays retryable without downloading", async () => {
    const encode = vi.fn().mockRejectedValue(new Error("no frames"));
    // The component logs the failure; keep the test output clean.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(<GifDownloadButton filename="walk.gif" encode={encode} />);

    fireEvent.click(screen.getByRole("button", { name: "Download GIF" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Failed — retry" }),
      ).toBeEnabled(),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("honors the disabled prop", () => {
    render(<GifDownloadButton filename="walk.gif" encode={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Download GIF" })).toBeDisabled();
  });
});
