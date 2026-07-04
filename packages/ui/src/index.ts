// `@test-cabinet/ui` — shared frontend library for The Test Cabinet's GUIs.
//
// The root entry exports the brand-neutral primitives and the rating model that
// every GUI (site, web, tauri) can use. The full routed gallery application and
// its backend/worker client interfaces live under the `./app` and `./client`
// subpath exports.
export * from "./ratings";
export * from "./modelId";
export * from "./primitives";
