// `@clockwyrks/ui/transport` — the shared HTTP transports the web console uses.
//
// The web console talks to the backend, the artifacts service and the arena
// service, each at a path of its own origin (`/api`, `/artifacts`, `/arena`).
// These transports are the single implementation of that wire protocol.
export {
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
  referenceMediaKey,
} from "./httpBackend";
export {
  ARENA_PATH,
  ARTIFACTS_PATH,
  BACKEND_PATH,
  currentHostname,
  grafanaUrlForHost,
  snapshotUrlForHost,
} from "./origin-services";
export { createHttpArena } from "./httpArena";
