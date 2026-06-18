// Streamed-download helper shared by the transports that fetch a recorded run's
// events. Recorded event files can be large, so the transports read the response
// body incrementally and report transfer progress as bytes arrive (see
// {@link LoadProgress}); the run-detail Events tab turns those ticks into a
// progress bar. The body is still buffered to a string and parsed once complete
// — the partially loaded data is never rendered, only its progress.
import type { ProgressCallback } from "./types";

// Read a `fetch` Response body to text, reporting transfer progress from its
// `Content-Length` as each chunk arrives. Falls back to `response.text()` when
// the body isn't a readable stream (an environment without streaming bodies), in
// which case no intermediate progress is reported — the read simply resolves.
export async function readTextWithProgress(
  response: Response,
  onProgress?: ProgressCallback,
): Promise<string> {
  const header = response.headers.get("content-length");
  const parsed = header ? Number(header) : NaN;
  const total = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  // No stream to observe (or no one listening): buffer it in one shot.
  if (!response.body || !onProgress) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  onProgress({ received: 0, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    // Decode incrementally so multi-byte characters split across chunks survive.
    text += decoder.decode(value, { stream: true });
    onProgress({ received, total });
  }
  text += decoder.decode();
  return text;
}
