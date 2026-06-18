// The transport-agnostic runner/reporter console shared by the web and tauri
// apps. Mount <Console> inside a <BackendProvider> and <WorkersProvider> (from
// `@test-cabinet/ui/client`); each app supplies those with its own transport.
export { Console } from "./Console";
export { RunScreen } from "./RunScreen";
export { SpecsScreen } from "./SpecsScreen";
export { ReviewScreen } from "./ReviewScreen";
export { ConnectionsScreen } from "./ConnectionsScreen";
export { CaseSelector } from "./CaseSelector";
export { useCatalog, type CatalogSelection } from "./useCatalog";
