// `@test-cabinet/ui/transport` — the shared HTTP transports the live consoles use.
//
// Both the web console and the Tauri desktop app talk to the same backend over
// the same HTTP API (the backend serves the catalog and published data, owns the
// run queue, and proxies the artifact/arena services). These transports are the
// single implementation of that wire protocol, so neither host duplicates it: the
// web host mounts them directly, and the desktop host mounts the same ones inside
// its native shell (using Tauri IPC only for the in-process local arena and shell
// concerns). The desktop's arena stays local, so it keeps its own arena transport
// and does not use {@link createHttpArena}.
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
} from "./httpBackend";
export type { ArtifactsUrlSource } from "./httpBackend";
export { createHttpArena } from "./httpArena";
