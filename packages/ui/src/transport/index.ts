// `@clockwyrks/ui/transport` — the shared HTTP transports the web console uses.
//
// The web console talks to the backend over one HTTP API (the backend serves the
// catalog and published data, owns the run queue, and proxies the artifact/arena
// services). These transports are the single implementation of that wire
// protocol.
export {
  bearer,
  getJson,
  getJsonStreamed,
  getNdjson,
  getNdjsonStreamed,
  getText,
  getTextStreamed,
  joinUrl,
  postJson,
} from "./http";
export {
  createBackendExec,
  createHttpBackend,
  fetchArenaUrl,
  fetchArtifactsUrl,
  fetchGrafanaUrl,
  fetchSnapshotUrl,
  referenceMediaKey,
} from "./httpBackend";
export type { ArtifactsUrlSource } from "./httpBackend";
export { createHttpArena } from "./httpArena";
