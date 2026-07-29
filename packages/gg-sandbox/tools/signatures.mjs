// Emit the signature catalogue gg renders its system prompt from.
//
// gg has to tell a model, every turn, what functions its program may call and what they do. The
// wrong way to do that is a hand-written list in the prompt template: it drifts away from the SDK
// silently, and a model that is shown a signature the sandbox does not have wastes a whole turn
// discovering that. So the list is REFLECTED out of the SDK's own emitted declarations instead — in
// a `.d.ts` the declaration *is* the signature, and the JSDoc beside it is already written for the
// audience that will read it.
//
// The pipeline, all of which `packages/gg-sandbox/build.sh` runs in order:
//
//   src/**.ts  --tsc-->  dist/headers/**.d.ts  --this script-->  crates/gg/src/sandbox/signatures.json
//
// and `crates/gg/src/sandbox/signatures.rs` embeds that JSON with `include_str!`. Because the same
// `build.sh` invocation also rebuilds the component, the prompt can never be more current than the
// component that implements it — the correct failure direction.
//
// Two properties are enforced here rather than left to review:
//
//   * every catalogued export must exist, in the module the catalogue names for it — a typo in
//     `src/catalogue.ts` is an error, not a missing prompt line;
//   * every catalogued export must carry a doc comment — an undocumented tool would reach a model as
//     a bare signature with nothing after the dash.
//
// Beside its provenance line the catalogue has four parts — `session`, `tools`, `helpers`, `types` —
// and `session` comes first because it is the one part that is not a projection of the run's enabled
// set: an ending call is bound from the agent's *role*, so the prompt renders the role's group
// unconditionally, and a run that offers no tools at all still has to be told how to end.
//
// Usage:
//   node tools/signatures.mjs --out <path>            # write the catalogue
//   node tools/signatures.mjs --out <path> --check    # verify the committed catalogue is current
//
// `--check` is the local rehearsal of the CI drift gate, which regenerates the file and fails on any
// `git diff`.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The TypeScript compiler API is the package's one devDependency, hoisted to the repo root by npm's
// workspaces; `createRequire` resolves it the same way `tsc` itself is resolved.
const require = createRequire(import.meta.url);
/** @type {import("typescript")} */
const ts = require("typescript");

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(PACKAGE_DIR, "src");
const HEADERS_DIR = path.join(PACKAGE_DIR, "dist", "headers");

/**
 * The provenance string written into the catalogue, so a reader of the JSON knows it is generated
 * and where from.
 */
const GENERATED_FROM = "packages/gg-sandbox/src";

/** The one type declaration the catalogue always carries, whatever a run enables. */
const ALWAYS_INCLUDED_TYPE = "ToolError";

/**
 * Print a node without its comments and on one line.
 *
 * The printer is used rather than the raw source text because a type declaration's members carry
 * JSDoc that is written for a developer reading `src/types.ts`, while this output is read by a model
 * inside a system prompt — the declaration has to arrive as a declaration, not as a paragraph.
 */
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** @param {import("typescript").Node} node @param {import("typescript").SourceFile} sourceFile */
function print(node, sourceFile) {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, " ").trim();
}

/** The declaration text as the prompt shows it: no `export`/`declare` keywords, no trailing `;`. */
function declarationText(node, sourceFile) {
  return print(node, sourceFile)
    .replace(/^(?:export\s+)?(?:declare\s+)?/, "")
    .replace(/;$/, "");
}

/**
 * The declaration's own JSDoc, with its markers stripped and its lines joined onto one.
 *
 * Two blocks can end up attached to a declaration and only one of them describes it:
 *
 * - the *last* one is the declaration's own, which is why the last is the one taken;
 * - the *file's leading block* is the module header, and it gets attached to whatever declaration
 *   follows it once declaration emit has elided the type-only imports that stood in between. It is
 *   excluded explicitly, because otherwise an export whose doc was deleted would silently inherit
 *   its module's description and reach a model as a paragraph about the wrong thing — the exact
 *   failure this gate exists to prevent, made invisible.
 *
 * The text is collapsed onto one line because the prompt renders it as one bullet.
 */
function docComment(node, sourceFile) {
  const blocks = ts
    .getJSDocCommentsAndTags(node)
    .filter((block) => ts.isJSDoc(block) && sourceFile.text.slice(0, block.pos).trim() !== "");
  const own = blocks.at(-1);
  if (!own) return "";
  return (ts.getTextOfJSDocComment(own.comment) ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The catalogue itself, read from `src/catalogue.ts`.
 *
 * The source file is transpiled in memory and imported as a data URL rather than read out of
 * `dist/`, so this script depends only on what `tsconfig.headers.json` emits — which is what lets CI
 * run the drift gate without ever building the JavaScript the component is made from.
 */
async function loadCatalogue() {
  const file = path.join(SRC_DIR, "catalogue.ts");
  const source = await readFile(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputText, "utf8").toString("base64")}`;
  return import(url);
}

/** Every `.d.ts` under `dist/headers`, parsed, sorted by path so the output order is stable. */
async function loadHeaders() {
  /** @type {string[]} */
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".d.ts")) files.push(full);
    }
  };
  await walk(HEADERS_DIR).catch(() => {
    throw new Error(
      `no declarations at ${HEADERS_DIR} — run \`tsc -p tsconfig.headers.json\` first ` +
        "(the `signatures` npm script does).",
    );
  });
  files.sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      sourceFile: ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.ES2022,
        /* setParentNodes */ true,
      ),
    })),
  );
}

/**
 * Index the declarations the catalogue can refer to.
 *
 * Functions are keyed by name and carry the file they came from, so a catalogue entry that names the
 * wrong module is caught. Types keep their discovery order — files sorted, statements in source
 * order — which is the order the prompt lists them in.
 */
function index(headers) {
  /** @type {Map<string, { node: any; sourceFile: any; file: string }>} */
  const functions = new Map();
  /** @type {Map<string, { declaration: string; order: number }>} */
  const types = new Map();
  for (const { file, sourceFile } of headers) {
    for (const statement of sourceFile.statements) {
      const name = statement.name?.text;
      if (!name) continue;
      if (ts.isFunctionDeclaration(statement)) {
        if (functions.has(name)) {
          throw new Error(`\`${name}\` is declared in two modules; SDK names must be unique.`);
        }
        functions.set(name, { node: statement, sourceFile, file });
      } else if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)
      ) {
        types.set(name, { declaration: declarationText(statement, sourceFile), order: types.size });
      }
    }
  }
  return { functions, types };
}

/**
 * The declared type names a piece of declaration text refers to, closed transitively.
 *
 * Transitively, because a declaration that names a type the prompt does not also carry is a dangling
 * reference in front of the model: `searchArchive` returns an `ArchiveSearch`, whose declaration is
 * only useful alongside `ArchiveHit`.
 */
function referencedTypes(text, types, seen = new Set()) {
  for (const [name, { declaration }] of types) {
    if (seen.has(name)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    seen.add(name);
    referencedTypes(declaration, types, seen);
  }
  return seen;
}

/** The `{ signature, doc, types }` triple for one catalogued export. */
function reflect(js, expectedFile, { functions, types }) {
  const found = functions.get(js);
  if (!found) {
    throw new Error(`\`${js}\` is in the catalogue but no SDK module exports it.`);
  }
  if (path.basename(found.file) !== expectedFile) {
    throw new Error(
      `\`${js}\` is catalogued in ${expectedFile} but is exported by ${path.basename(found.file)}.`,
    );
  }
  const { node, sourceFile } = found;
  const parameters = node.parameters.map((parameter) => print(parameter, sourceFile)).join(", ");
  const returnType = node.type ? print(node.type, sourceFile) : "void";
  const signature = `${js}(${parameters}): ${returnType}`;
  const doc = docComment(node, sourceFile);
  if (!doc) {
    throw new Error(
      `\`${js}\` has no doc comment. Every catalogued export's JSDoc is shown to a model in the ` +
        "system prompt, so an undocumented one would reach it as a bare signature.",
    );
  }
  return { signature, doc, referenced: referencedTypes(signature, types) };
}

/** Build the whole catalogue. */
async function build() {
  const { TOOL_CATALOGUE, HELPER_CATALOGUE, SESSION_ENTRIES, SESSION_MODULE, OBJECT_FOR_MODULE } =
    await loadCatalogue();
  const declarations = index(await loadHeaders());
  // The API object a module's functions are grouped under in a program's scope. The host groups the
  // catalogue by this to build each object's `list()` directory and to route `readDocs`.
  const objectForModule = (module) => {
    const object = OBJECT_FOR_MODULE[module];
    if (!object) throw new Error(`module \`${module}\` has no API object in OBJECT_FOR_MODULE.`);
    return object;
  };
  const moduleForTool = (tool) => TOOL_CATALOGUE.find((entry) => entry.tool === tool)?.module;

  /** @type {Set<string>} */
  const used = new Set(referencedTypes(ALWAYS_INCLUDED_TYPE, declarations.types));

  const order = (name) => declarations.types.get(name)?.order ?? Number.MAX_SAFE_INTEGER;
  const sorted = (names) => [...names].sort((a, b) => order(a) - order(b));

  // Reflected exactly as a tool is, minus the `tool` field they have no value for: none is a gg tool,
  // none has a name in `ALL_TOOL_NAMES`, and nothing dispatches them. `ending` names the role whose
  // programs each one is bound for, which is what lets the prompt render one group.
  const session = SESSION_ENTRIES.map((entry) => {
    const { signature, doc, referenced } = reflect(
      entry.js,
      `${SESSION_MODULE}.d.ts`,
      declarations,
    );
    for (const name of referenced) used.add(name);
    return {
      js: entry.js,
      object: entry.object,
      ending: entry.ending,
      signature,
      doc,
      types: sorted(referenced),
    };
  });

  const tools = TOOL_CATALOGUE.map((entry) => {
    const { signature, doc, referenced } = reflect(
      entry.js,
      `${entry.module}.d.ts`,
      declarations,
    );
    for (const name of referenced) used.add(name);
    return {
      tool: entry.tool,
      js: entry.js,
      object: objectForModule(entry.module),
      signature,
      doc,
      types: sorted(referenced),
    };
  });

  const helpers = HELPER_CATALOGUE.map((entry) => {
    const { signature, doc, referenced } = reflect(entry.js, "helpers.d.ts", declarations);
    for (const name of referenced) used.add(name);
    const module = moduleForTool(entry.requires);
    if (!module) throw new Error(`helper \`${entry.js}\` requires unknown tool \`${entry.requires}\`.`);
    return {
      requires: entry.requires,
      js: entry.js,
      object: objectForModule(module),
      signature,
      doc,
      types: sorted(referenced),
    };
  });

  const types = sorted(used).map((name) => ({
    name,
    declaration: declarations.types.get(name).declaration,
  }));

  return `${JSON.stringify(
    { generatedFrom: GENERATED_FROM, session, tools, helpers, types },
    null,
    2,
  )}\n`;
}

/** Parse the command line, rejecting anything it does not understand rather than guessing. */
function parseArguments(argv) {
  let out;
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      out = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--check") {
      check = true;
    } else {
      throw new Error(`unknown argument \`${argv[i]}\`; usage: --out <path> [--check]`);
    }
  }
  if (!out) throw new Error("--out <path> is required; usage: --out <path> [--check]");
  return { out: path.resolve(out), check };
}

async function main() {
  const { out, check } = parseArguments(process.argv.slice(2));
  const catalogue = await build();
  if (check) {
    const committed = await readFile(out, "utf8").catch(() => "");
    if (committed !== catalogue) {
      throw new Error(
        `${path.relative(process.cwd(), out)} is stale. Regenerate it with ` +
          "`npm run -w @test-cabinet/gg-sandbox signatures` and commit the result.",
      );
    }
    process.stdout.write(`${path.relative(process.cwd(), out)} is up to date.\n`);
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, catalogue, "utf8");
  const { tools, helpers, types } = JSON.parse(catalogue);
  process.stdout.write(
    `Wrote ${path.relative(process.cwd(), out)} (${tools.length} tools, ` +
      `${helpers.length} helpers, ${types.length} types).\n`,
  );
}

await main().catch((error) => {
  process.stderr.write(`signatures: ${error.message}\n`);
  process.exit(1);
});
