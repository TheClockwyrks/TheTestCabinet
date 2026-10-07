import { afterEach, describe, expect, it, vi } from "vitest";
import * as download from "./download";
import {
  downloadMediaFile,
  mediaExtension,
  paneFileStem,
} from "./mediaDownload";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("paneFileStem", () => {
  it("slugs the output's name and appends the side", () => {
    expect(paneFileStem("Serve still", "reference")).toBe(
      "serve-still-reference",
    );
    expect(paneFileStem("  The driven in-game state! ", "run")).toBe(
      "the-driven-in-game-state-run",
    );
    expect(paneFileStem("", "run")).toBe("output-run");
  });
});

describe("mediaExtension", () => {
  it("trusts the served type first, then the URL, then the kind", () => {
    expect(mediaExtension("image/png", "https://x/y.jpg", "image")).toBe("png");
    expect(
      mediaExtension("video/webm;codecs=vp9", "https://x/y", "video"),
    ).toBe("webm");
    expect(
      mediaExtension("application/octet-stream", "https://x/y.mp4", "video"),
    ).toBe("mp4");
    expect(mediaExtension("", "/runs/r1/serve__still.PNG?x=1", "image")).toBe(
      "png",
    );
    expect(mediaExtension("", "blob:https://x/abc", "image")).toBe("png");
    expect(mediaExtension("", "blob:https://x/abc", "video")).toBe("webm");
  });
});

describe("downloadMediaFile", () => {
  it("saves the fetched bytes as they are, under the stem and the served type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("png", {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const save = vi
      .spyOn(download, "downloadBlob")
      .mockImplementation(() => {});

    await downloadMediaFile("https://x/serve.bin", "image", "serve-still-run");

    expect(fetch).toHaveBeenCalledWith("https://x/serve.bin");
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, filename] = save.mock.calls[0]!;
    expect(filename).toBe("serve-still-run.png");
    expect(blob.size).toBe(3);
  });

  it("reports a failed fetch rather than saving an error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const save = vi
      .spyOn(download, "downloadBlob")
      .mockImplementation(() => {});
    await expect(
      downloadMediaFile("https://x/missing", "image", "x"),
    ).rejects.toThrow(/404/);
    expect(save).not.toHaveBeenCalled();
  });
});
