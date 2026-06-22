// Generate the Test Cabinet data contract — the TypeScript bindings and the JSON
// Schemas — from the Rust types that are its single source of truth.
//
// The work happens in two steps. First the `contract-codegen` crate (see
// `crates/contract-codegen`) emits the TypeScript (`packages/run-record/src/`)
// and the JSON Schemas (`apps/docs/public/schema/`) from the Rust contract types,
// which derive `ts_rs::TS` + `schemars::JsonSchema` behind their `contract`
// feature. The Rust generator is correct but not pretty (ts_rs emits ragged
// whitespace), so the second step runs Prettier to make the committed output
// deterministic and conventional. CI regenerates and fails on any diff, so the
// committed artifacts always match the Rust source — hand-edits never survive.
//
// Usage: `npm run gen:contract` (from the repository root).

import { execFileSync } from "node:child_process";

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

// 1. Emit raw TS + JSON from the Rust source of truth.
run("cargo", ["run", "--quiet", "-p", "contract-codegen"]);

// 2. Normalize formatting so the committed artifacts are deterministic. Prettier
//    is pinned (see the root `package.json`) so the same input always formats the
//    same way, which is what makes the drift check trustworthy.
run("npx", [
  "prettier",
  "--write",
  "--log-level",
  "warn",
  "packages/run-record/src/**/*.ts",
  "apps/docs/public/schema/**/*.json",
]);
