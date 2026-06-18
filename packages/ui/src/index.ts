// `@test-cabinet/ui` — shared frontend library for The Test Cabinet's GUIs.
//
// The root entry exports the brand-neutral primitives and the rating model that
// every GUI (site, web, tauri) can use. The runner/reporter console and its
// backend/worker client interfaces — shared by web and tauri but not the static
// site — live under the `./console` and `./client` subpath exports.
export * from "./ratings";
export * from "./primitives";
