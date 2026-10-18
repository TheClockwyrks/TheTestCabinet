import { useEffect, useState } from "react";
import { useOptionalBackend } from "../../client/context";
import type { ModelCandidates } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The async state of a model's provider candidate list. `unavailable` covers a
// host whose transport cannot read it (the static site).
export type ModelCandidatesState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; candidates: ModelCandidates };

/**
 * The candidate list the next gg enqueue of the model would build
 * (`GET /models/{slug}/candidates`), read once per model. The
 * backend reads OpenRouter's endpoints listing live, so the list reflects the
 * providers as they stand now, filtered by the model's catalog entry.
 */
export function useModelCandidates(slug: string): ModelCandidatesState {
  const { canExecute } = useGalleryData();
  const client = useOptionalBackend()?.client ?? null;
  const read =
    canExecute && client?.getModelCandidates
      ? client.getModelCandidates.bind(client)
      : null;
  const [state, setState] = useState<ModelCandidatesState>({
    status: "loading",
  });

  useEffect(() => {
    if (!read) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    read(slug)
      .then((candidates) => {
        if (active) setState({ status: "ready", candidates });
      })
      .catch((e) => {
        if (active) setState({ status: "error", message: errorMessage(e) });
      });
    return () => {
      active = false;
    };
    // The bound method is a new function every render; the client identity is
    // what changes when a different backend connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, canExecute, slug]);

  return state;
}

// An Error's own message reads better than its stringification (no "Error: "
// prefix); anything else is stringified as-is.
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
