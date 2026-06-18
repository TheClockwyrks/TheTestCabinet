import { describe, expect, it, vi } from "vitest";
import type { LoadProgress } from "./types";
import { readTextWithProgress } from "./progress";

// Build a minimal Response-like object backed by a readable stream of the given
// chunks, so the helper can exercise its incremental read path under jsdom.
function streamedResponse(
  chunks: Uint8Array[],
  contentLength: string | null,
): Response {
  const headers = new Headers();
  if (contentLength !== null) headers.set("content-length", contentLength);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const text = new TextDecoder().decode(
    Uint8Array.from(chunks.flatMap((c) => [...c])),
  );
  return { headers, body, text: async () => text } as unknown as Response;
}

const encode = (s: string) => new TextEncoder().encode(s);

describe("readTextWithProgress", () => {
  it("streams the body and reports cumulative progress against Content-Length", async () => {
    const chunks = [encode("hello "), encode("world")]; // 6 + 5 = 11 bytes
    const ticks: LoadProgress[] = [];

    const text = await readTextWithProgress(
      streamedResponse(chunks, "11"),
      (p) => ticks.push(p),
    );

    expect(text).toBe("hello world");
    // An initial zero tick, then one per chunk, all carrying the known total.
    expect(ticks).toEqual([
      { received: 0, total: 11 },
      { received: 6, total: 11 },
      { received: 11, total: 11 },
    ]);
  });

  it("reports an unknown total when there is no Content-Length", async () => {
    const ticks: LoadProgress[] = [];

    const text = await readTextWithProgress(
      streamedResponse([encode("abc")], null),
      (p) => ticks.push(p),
    );

    expect(text).toBe("abc");
    expect(ticks.at(-1)).toEqual({ received: 3, total: null });
    expect(ticks.every((t) => t.total === null)).toBe(true);
  });

  it("falls back to text() with no progress when no callback is given", async () => {
    const response = streamedResponse([encode("data")], "4");
    const textSpy = vi.spyOn(response, "text");

    expect(await readTextWithProgress(response)).toBe("data");
    expect(textSpy).toHaveBeenCalledOnce();
  });
});
