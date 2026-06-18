// Curated implementation reviews. A review is a hand-written note shown on a
// run's page before its playable build is launched (see
// docs/site.md#implementation-writeups). It carries a quality rating and a
// Markdown body; neither is part of the run record. Reviews reach the UI through
// the injected gallery data source (see galleryContext) — the static site
// reconstructs them from the public snapshot, the consoles read them from the
// backend (published) or the worker (locally produced) — keyed by run id.
import type { ParsedWriteup } from "./ratings";
import { useGalleryData } from "./galleryContext";

// Resolve a run's review against the active data source. A locally-previewed
// writeup (passed as `override`, e.g. a run's local writeups) takes precedence
// over the published one. Returns undefined when the run has no writeup at all.
//
// This is a hook: call it once at the top of a component, then use the returned
// resolver freely (including inside list `.map` callbacks).
export function useFindReview(): (
  runId: string,
  override?: Readonly<Record<string, string>>,
) => ParsedWriteup | undefined {
  return useGalleryData().findReview;
}
