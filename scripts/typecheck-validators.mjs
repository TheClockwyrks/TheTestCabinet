// Type-checks every test case's validator projects.
//
// A case that supports engines ships one validator project per engine under
// `<version>/validation/<engine>/`, each with a `tsconfig.json` of its own. This
// walks the checkout for those configs and runs `tsc --noEmit` over each, so a
// validator that does not compile is caught here rather than in a run, where a
// broken suite costs the run every point it decides.
//
// The projects resolve two things that only exist in the STAGED tree — the
// build's `../src/*` and the harness copied in as `./case-harness/*` — through
// the `rootDirs` each project's config declares. See the header comment on any
// `validation/tsconfig.json`.
//
// Projects are independent, so they run concurrently, one `tsc` per project up
// to the core count. Every failing project is reported before the exit, because
// fixing one at a time across fifty-odd projects is the slow way round.

import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/** Every `validation/<engine>/` directory that carries a `tsconfig.json`. */
function findProjects() {
  const projects = [];
  const casesRoot = join(repoRoot, "test-cases");
  // test-cases/<type>/<difficulty>/<slug>/<version>/validation/<engine>
  const dirs = (path) =>
    existsSync(path)
      ? readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(path, entry.name))
      : [];
  for (const type of dirs(casesRoot)) {
    for (const difficulty of dirs(type)) {
      for (const slug of dirs(difficulty)) {
        for (const version of dirs(slug)) {
          for (const engine of dirs(join(version, "validation"))) {
            if (existsSync(join(engine, "tsconfig.json")))
              projects.push(engine);
          }
        }
      }
    }
  }
  return projects.sort();
}

/** `tsc -p project`, resolving to its output rather than throwing on a failure. */
function typecheck(project) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [tsc, "-p", project],
      { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ project, ok: !error, output: `${stdout}${stderr}`.trim() });
      },
    );
  });
}

const projects = findProjects();
if (projects.length === 0) {
  console.error("no validator projects found under test-cases/");
  process.exit(1);
}

const queue = [...projects];
const failures = [];
const workers = Array.from(
  { length: Math.min(availableParallelism(), queue.length) },
  async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await typecheck(next);
      const name = relative(repoRoot, result.project);
      if (result.ok) {
        console.log(`ok   ${name}`);
      } else {
        console.log(`FAIL ${name}`);
        failures.push(result);
      }
    }
  },
);
await Promise.all(workers);

if (failures.length > 0) {
  console.error(
    `\n${failures.length} of ${projects.length} projects failed:\n`,
  );
  for (const failure of failures) {
    console.error(`--- ${relative(repoRoot, failure.project)}`);
    console.error(failure.output);
    console.error("");
  }
  process.exit(1);
}

console.log(`\n${projects.length} validator projects type-check.`);
