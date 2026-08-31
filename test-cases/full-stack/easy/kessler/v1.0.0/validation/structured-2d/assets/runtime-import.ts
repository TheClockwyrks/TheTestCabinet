// assets/runtime-import — finding the particle runtime's canvas binding in the
// build's own source.
//
// specs/assets.md: "Play them through `@test-cabinet/particle-runtime`, an
// installed dependency imported by its bare name, using its `./canvas`
// binding". The import is a fact about the build's source, so it is read
// there: every source module the build wrote is scanned for the bare
// specifier `@test-cabinet/particle-runtime/canvas`, in any of the forms an
// import takes (static, dynamic, require). The build's own test files do not
// count — a binding only a test imports plays nothing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { WORKSPACE } from "./media-out";

/** The bare specifier of the runtime's 2D-canvas binding. */
export const CANVAS_BINDING = "@test-cabinet/particle-runtime/canvas";

/** Directories that hold no source the shipped game is built from. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "validation",
  ".git",
  "coverage",
  "assets",
  "public",
  "showcase",
]);

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const IMPORT_FORMS = new RegExp(
  String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']` +
    CANVAS_BINDING.replace(/[/@-]/g, "\\$&") +
    String.raw`["']`,
);

/**
 * Workspace-relative paths of the build's source modules that import the
 * `./canvas` binding by its bare name.
 */
export function sourcesImportingCanvasBinding(): string[] {
  const hits: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (SKIPPED.has(entry) || entry.startsWith(".")) continue;
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (!SOURCE_EXTENSIONS.test(entry)) continue;
      if (/\.(?:test|spec)\./.test(entry)) continue;
      if (IMPORT_FORMS.test(readFileSync(path, "utf8"))) {
        hits.push(relative(WORKSPACE, path));
      }
    }
  };
  walk(WORKSPACE);
  return hits;
}
