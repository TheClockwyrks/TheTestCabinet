// Verify an npm install against the lockfile in the current directory.
//
// npm treats a platform-specific optional dependency it could not fetch — a
// registry blip while resolving `@rolldown/binding-linux-arm64-gnu`, say — as a
// package that simply does not apply to this host, drops it, and exits zero. The
// tree then looks installed and fails minutes later, in a build or a test run,
// with an error that blames the code rather than the install. This script is the
// check that catches it: every package npm would have placed on this host has to
// be on disk.
//
// "Would have placed" is decided the way npm's own tree builder (arborist)
// decides it, not by reading each lockfile entry on its own. An entry is expected
// when the lockfile's dependency graph reaches it from the project (the root and
// its workspaces) without passing through a package npm leaves out. npm leaves
// out a package the install command's flags omit (dev, optional, peer), a
// package whose `os`/`cpu`/`libc` this host fails, an optional package whose
// `engines.node` the running node fails, every package that requires such an
// excluded package unconditionally, and every package reachable only through one
// of those. An entry nothing reaches (`extraneous`) is pruned by `npm ci`, so it
// is not expected either.
//
// One implementation, run in two places. On the host it verifies the collected
// tree's install (the Rust side embeds this file and runs it with `node`), and in
// the run container it verifies the case's `init` command the same way. It takes
// the install command as its one argument, reads `package-lock.json` from the
// current directory, and prints a single JSON object on stdout:
//
//   {"checked": true, "missing": ["node_modules/…", …]}
//   {"checked": false, "reason": "…"}
//
// It exits zero in both cases; a tree that cannot be checked is a fact the caller
// decides what to do with, not an error. Nothing else is ever printed on stdout.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/// The install command whose flags decide which dependency classes are expected.
/// It is the last argument so the script reads the same whether it is run from a
/// file (`node check.mjs "npm ci"`) or evaluated (`node --input-type=module -e … --
/// "npm ci"`), where node strips the script itself from `argv`.
const installCommand =
  process.argv.length > 1 ? process.argv[process.argv.length - 1] : "";

// ---------------------------------------------------------------------------
// Which dependency classes the install leaves out
// ---------------------------------------------------------------------------

const OMIT_CLASSES = new Set(["dev", "optional", "peer"]);

/// Which of the lockfile's dependency classes the install omits, derived the way
/// npm derives its `omit` config from a command line. Only the flags matter: the
/// command may be a compound shell line such as `npm install && npx playwright
/// install chromium`.
///
/// `--omit=<class>` (repeatable, also `--omit <class>`), `--production` and
/// `--only=prod` (omit dev), and `--no-optional` (omit optional) omit a class. A
/// class named by `--include=<class>` is never omitted, whatever the omit flags
/// say. `NODE_ENV=production`, as a prefix on the command line or in the
/// environment, is npm's default for omitting dev and applies only when no omit
/// flag is given at all.
function omittedClasses(command) {
  const omitted = new Set();
  const included = new Set();
  let explicit = false;
  let nodeEnvProduction = process.env.NODE_ENV === "production";
  const tokens = command.split(/\s+/).filter((token) => token.length > 0);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const valueOf = (flag) => {
      if (token === flag) {
        return tokens[i + 1] ?? "";
      }
      if (token.startsWith(`${flag}=`)) {
        return token.slice(flag.length + 1);
      }
      return null;
    };
    if (token === "NODE_ENV=production") {
      nodeEnvProduction = true;
      continue;
    }
    if (token === "--production" || token === "--prod") {
      omitted.add("dev");
      explicit = true;
      continue;
    }
    if (token === "--no-optional") {
      omitted.add("optional");
      explicit = true;
      continue;
    }
    const only = valueOf("--only");
    if (only !== null) {
      explicit = true;
      if (only === "prod" || only === "production") {
        omitted.add("dev");
      }
      continue;
    }
    const omit = valueOf("--omit");
    if (omit !== null) {
      explicit = true;
      if (OMIT_CLASSES.has(omit)) {
        omitted.add(omit);
      }
      continue;
    }
    const include = valueOf("--include");
    if (include !== null && OMIT_CLASSES.has(include)) {
      included.add(include);
    }
  }
  if (!explicit && nodeEnvProduction) {
    omitted.add("dev");
  }
  for (const name of included) {
    omitted.delete(name);
  }
  return {
    dev: omitted.has("dev"),
    optional: omitted.has("optional"),
    peer: omitted.has("peer"),
  };
}

/// Whether the install leaves this entry out on purpose, from the class flags
/// npm wrote on it (npm's `Node.shouldOmit`).
function omittedByFlags(entry, omitted) {
  return (
    (entry.peer === true && omitted.peer) ||
    (entry.dev === true && omitted.dev) ||
    (entry.optional === true && omitted.optional) ||
    (entry.devOptional === true && omitted.dev && omitted.optional)
  );
}

// ---------------------------------------------------------------------------
// Whether an entry applies to this host: os, cpu, libc, engines
// ---------------------------------------------------------------------------

/// An entry's `os`/`cpu`/`libc` as a list of strings, or `null` when the field
/// is absent or unreadable. npm accepts a bare string as a one-element list.
function platformList(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  return null;
}

/// npm's own list rule (`npm-install-checks`): match none of the negated values
/// (`!win32`) and at least one of the plain values, when there are any; a list of
/// only negations admits anything not negated, and `["any"]` admits everything.
function checkList(value, list) {
  if (list.length === 1 && list[0] === "any") {
    return true;
  }
  let negated = 0;
  let match = false;
  for (const entry of list) {
    const negate = entry.charAt(0) === "!";
    const test = negate ? entry.slice(1) : entry;
    if (negate) {
      negated += 1;
      if (value === test) {
        return false;
      }
    } else {
      match = match || value === test;
    }
  }
  return match || negated === list.length;
}

/// The libc family the way npm derives it, on linux only: the system's `ldd`
/// names the family; failing that, node's own process report says whether the
/// runtime linked against glibc or musl. `null` when neither can tell, which npm
/// treats as satisfying no `libc` list at all; `undefined` off linux, likewise.
let hostLibcFamily;
function hostLibc() {
  if (process.platform !== "linux") {
    return undefined;
  }
  if (hostLibcFamily !== undefined) {
    return hostLibcFamily;
  }
  hostLibcFamily = null;
  let ldd = null;
  try {
    ldd = readFileSync("/usr/bin/ldd", "utf8");
  } catch {
    ldd = null;
  }
  if (ldd !== null) {
    if (ldd.includes("musl")) {
      hostLibcFamily = "musl";
    } else if (ldd.includes("GNU C Library")) {
      hostLibcFamily = "glibc";
    }
    return hostLibcFamily;
  }
  try {
    const originalExclude = process.report.excludeNetwork;
    process.report.excludeNetwork = true;
    const report = process.report.getReport();
    process.report.excludeNetwork = originalExclude;
    if (report.header?.glibcVersionRuntime) {
      hostLibcFamily = "glibc";
    } else if (
      Array.isArray(report.sharedObjects) &&
      report.sharedObjects.some(
        (file) => file.includes("libc.musl-") || file.includes("ld-musl-"),
      )
    ) {
      hostLibcFamily = "musl";
    }
  } catch {
    hostLibcFamily = null;
  }
  return hostLibcFamily;
}

/// npm's `checkPlatform`: whether this host is one the entry's `os`, `cpu` and
/// `libc` admit. An entry naming a `libc` family is refused off linux, where npm
/// knows no family.
function platformOk(entry) {
  const os = platformList(entry.os);
  const cpu = platformList(entry.cpu);
  const libc = platformList(entry.libc);
  if (os !== null && !checkList(process.platform, os)) {
    return false;
  }
  if (cpu !== null && !checkList(process.arch, cpu)) {
    return false;
  }
  if (libc !== null) {
    const family = hostLibc();
    if (!family || !checkList(family, libc)) {
      return false;
    }
  }
  return true;
}

// A version range parser for `engines.node`, covering what node-semver accepts:
// `||` alternatives, hyphen ranges, `^`, `~`, comparators, and partial versions
// with `x`/`*`. Prereleases compare below their release, as npm compares them
// (it checks engines with `includePrerelease`). A range the parser cannot read is
// taken as satisfied, so an odd manifest costs nothing.

function parseVersion(text) {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      text.trim(),
    );
  if (!match) {
    return null;
  }
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    return Math.sign(Number(a) - Number(b));
  }
  if (aNum !== bNum) {
    return aNum ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] !== b.parts[i]) {
      return a.parts[i] < b.parts[i] ? -1 : 1;
    }
  }
  if (a.pre.length === 0 || b.pre.length === 0) {
    return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i += 1) {
    if (a.pre[i] === undefined) {
      return -1;
    }
    if (b.pre[i] === undefined) {
      return 1;
    }
    const order = compareIdentifiers(a.pre[i], b.pre[i]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

const COMPARATOR =
  /(\^|~|<=|>=|<|>|=)?\s*v?([0-9xX*]+(?:\.[0-9xX*]+)?(?:\.[0-9xX*]+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/g;

/// A partial version such as `1`, `1.2.x` or `1.2.3-beta`: the numeric parts
/// given, and the prerelease. `null` for text that is not a version at all.
function parsePartial(text) {
  const match =
    /^([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      text,
    );
  if (!match) {
    return null;
  }
  const parts = [];
  for (const raw of [match[1], match[2], match[3]]) {
    if (raw === undefined || /^[xX*]$/.test(raw)) {
      break;
    }
    if (!/^\d+$/.test(raw)) {
      return null;
    }
    parts.push(Number(raw));
  }
  return { parts, pre: match[4] ? match[4].split(".") : [] };
}

function versionOf(parts, pre = []) {
  return { parts: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre };
}

/// The lower (inclusive) and upper (exclusive) bounds a comparator with a
/// partial version stands for, as node-semver desugars it. Either bound may be
/// `null` (unbounded).
function comparatorBounds(op, partial) {
  const { parts, pre } = partial;
  const [major, minor] = parts;
  const known = parts.length;
  const low = versionOf(parts, pre);
  const nextAbove = () => {
    if (known === 0) {
      return null;
    }
    if (known === 1) {
      return versionOf([major + 1]);
    }
    if (known === 2) {
      return versionOf([major, minor + 1]);
    }
    return null;
  };
  switch (op) {
    case "":
    case "=": {
      if (known === 3) {
        return { low, high: null, exact: low };
      }
      return { low, high: nextAbove() };
    }
    case ">=":
      return { low, high: null };
    case ">": {
      if (known === 3) {
        return { low, high: null, above: true };
      }
      if (known === 0) {
        return { low: null, high: versionOf([0]) };
      }
      return { low: nextAbove(), high: null };
    }
    case "<": {
      if (known === 0) {
        return { low: null, high: versionOf([0]) };
      }
      return { low: null, high: low };
    }
    case "<=": {
      if (known === 3) {
        return { low: null, high: low, inclusiveHigh: true };
      }
      if (known === 0) {
        return { low: null, high: null };
      }
      return { low: null, high: nextAbove() };
    }
    case "~": {
      if (known === 0) {
        return { low: null, high: null };
      }
      if (known === 1) {
        return { low, high: versionOf([major + 1]) };
      }
      return { low, high: versionOf([major, minor + 1]) };
    }
    case "^": {
      if (known === 0) {
        return { low: null, high: null };
      }
      if (known === 1) {
        return { low, high: versionOf([major + 1]) };
      }
      if (major !== 0) {
        return { low, high: versionOf([major + 1]) };
      }
      if (known === 2 || minor !== 0) {
        return { low, high: versionOf([0, minor + 1]) };
      }
      return { low, high: versionOf([0, 0, parts[2] + 1]) };
    }
    default:
      return null;
  }
}

function withinBounds(version, bounds) {
  if (bounds.exact) {
    return compareVersions(version, bounds.exact) === 0;
  }
  if (bounds.low !== null) {
    const order = compareVersions(version, bounds.low);
    if (order < 0 || (order === 0 && bounds.above)) {
      return false;
    }
  }
  if (bounds.high !== null) {
    const order = compareVersions(version, bounds.high);
    if (order > 0 || (order === 0 && !bounds.inclusiveHigh)) {
      return false;
    }
  }
  return true;
}

/// The exclusive upper bound a partial version stands for when it closes a
/// hyphen range: `1.2` means everything below `1.3.0`, `1` everything below
/// `2.0.0`, and a full version is inclusive (`null` here, handled by the caller).
function hyphenUpper(partial) {
  const [major, minor] = partial.parts;
  switch (partial.parts.length) {
    case 0:
      return { low: null, high: null };
    case 1:
      return { low: null, high: versionOf([major + 1]) };
    case 2:
      return { low: null, high: versionOf([major, minor + 1]) };
    default:
      return {
        low: null,
        high: versionOf(partial.parts, partial.pre),
        inclusiveHigh: true,
      };
  }
}

/// Whether `version` satisfies one `||`-free range. `null` when the range could
/// not be read.
function satisfiesSimpleRange(version, text) {
  const range = text.trim();
  if (range === "" || range === "*" || /^[xX]$/.test(range)) {
    return true;
  }
  const hyphen = /^v?(\S+)\s+-\s+v?(\S+)$/.exec(range);
  if (hyphen) {
    const low = parsePartial(hyphen[1]);
    const high = parsePartial(hyphen[2]);
    if (!low || !high) {
      return null;
    }
    return (
      withinBounds(version, comparatorBounds(">=", low)) &&
      withinBounds(version, hyphenUpper(high))
    );
  }
  if (range.replace(COMPARATOR, "").trim() !== "") {
    return null;
  }
  let matched = 0;
  for (const match of range.matchAll(COMPARATOR)) {
    matched += 1;
    const partial = parsePartial(match[2]);
    if (!partial) {
      return null;
    }
    const bounds = comparatorBounds(match[1] ?? "", partial);
    if (!bounds) {
      return null;
    }
    if (!withinBounds(version, bounds)) {
      return false;
    }
  }
  return matched === 0 ? null : true;
}

/// Whether `version` satisfies `range` (`a || b || …`). A range that cannot be
/// read is taken as satisfied.
function satisfies(version, range) {
  let readable = false;
  for (const alternative of String(range).split("||")) {
    const verdict = satisfiesSimpleRange(version, alternative);
    if (verdict === true) {
      return true;
    }
    if (verdict === false) {
      readable = true;
    }
  }
  return !readable;
}

/// npm's `checkEngine` for the one engine the script can see: whether the node
/// running it satisfies the entry's `engines.node`.
function enginesOk(entry) {
  const range = entry.engines?.node;
  if (typeof range !== "string" || range.trim() === "") {
    return true;
  }
  const version = parseVersion(process.version);
  if (!version) {
    return true;
  }
  return satisfies(version, range);
}

// ---------------------------------------------------------------------------
// The dependency graph the lockfile describes
// ---------------------------------------------------------------------------

/// Whether a lockfile path is the project itself or one of its workspaces (or
/// any other linked directory): a source directory the install does not create,
/// whose dependencies — dev ones included — it installs.
function isProjectPath(path) {
  return path === "" || !path.split("/").includes("node_modules");
}

/// The lockfile path that `name`, required from the package at `fromPath`,
/// resolves to: the nearest `node_modules/<name>` walking up from the requiring
/// package, as node itself resolves it. `null` when the lockfile has none.
function resolveDependency(packages, fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate =
      base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) {
      return candidate;
    }
    if (base === "") {
      return null;
    }
    const index = base.lastIndexOf("/node_modules/");
    base = index === -1 ? "" : base.slice(0, index);
  }
}

/// The edges out of the entry at `path`: `{to, optional}` per resolved
/// dependency, where `optional` marks the edges npm's `optionalSet` does not walk
/// back through — an `optionalDependencies` entry, or a peer the manifest marks
/// optional.
function edgesOut(packages, path, entry) {
  const edges = [];
  const seen = new Set();
  const add = (names, optional) => {
    if (!names || typeof names !== "object") {
      return;
    }
    for (const name of Object.keys(names)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const to = resolveDependency(packages, path, name);
      if (to !== null) {
        edges.push({ to, optional });
      }
    }
  };
  const optionalPeers = new Set(
    Object.entries(entry.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta && meta.optional === true)
      .map(([name]) => name),
  );
  // Order matters only for the `optional` mark: a name listed both as a plain
  // and an optional dependency is optional to npm.
  add(entry.optionalDependencies, true);
  add(entry.dependencies, false);
  for (const name of Object.keys(entry.peerDependencies ?? {})) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const to = resolveDependency(packages, path, name);
    if (to !== null) {
      edges.push({ to, optional: optionalPeers.has(name) });
    }
  }
  if (isProjectPath(path)) {
    add(entry.devDependencies, false);
  }
  return edges;
}

/// The lockfile paths the install places on this host, computed the way npm's
/// tree builder does. Every entry is a node; the project and its workspaces are
/// the roots. An optional node this host's platform or node version excludes is
/// inert, together with every node that requires it unconditionally
/// (`optionalSet`); an omitted class is left out by its flags; and a node counts
/// only when the graph reaches it from a root through nodes that count.
function expectedPaths(packages, omitted) {
  const nodes = new Map();
  for (const [path, entry] of Object.entries(packages)) {
    if (entry && typeof entry === "object") {
      nodes.set(path, entry);
    }
  }
  const outgoing = new Map();
  const incoming = new Map();
  for (const [path, entry] of nodes) {
    if (entry.link === true) {
      // A link's dependencies are its target's, and the target is a project path.
      continue;
    }
    const edges = edgesOut(packages, path, entry);
    outgoing.set(path, edges);
    for (const edge of edges) {
      if (!incoming.has(edge.to)) {
        incoming.set(edge.to, []);
      }
      incoming.get(edge.to).push({ from: path, optional: edge.optional });
    }
  }
  const targetOf = (path) => {
    const entry = nodes.get(path);
    if (entry && entry.link === true && typeof entry.resolved === "string") {
      return nodes.has(entry.resolved) ? entry.resolved : null;
    }
    return path;
  };

  // npm's optionalSet: an optional package this host cannot take, plus every
  // package that requires it through a non-optional edge, transitively, is
  // inert and never extracted. A platform npm refuses excludes a package of any
  // class (npm fails the install outright for a required one, so an install that
  // exited zero never placed it); an engine mismatch excludes an optional package
  // only, since a required one is installed with a warning.
  const inert = new Set();
  for (const [path, entry] of nodes) {
    if (isProjectPath(path) || entry.link === true || inert.has(path)) {
      continue;
    }
    if (platformOk(entry) && (entry.optional !== true || enginesOk(entry))) {
      continue;
    }
    const set = new Set([path]);
    for (const member of set) {
      for (const edge of incoming.get(member) ?? []) {
        if (!edge.optional && !isProjectPath(edge.from)) {
          set.add(edge.from);
        }
      }
    }
    for (const member of set) {
      inert.add(member);
    }
  }

  // Reach from the roots through nodes the install keeps.
  const expected = new Set();
  const visited = new Set();
  const stack = [];
  for (const path of nodes.keys()) {
    if (isProjectPath(path)) {
      stack.push(path);
    }
  }
  while (stack.length > 0) {
    const path = stack.pop();
    if (visited.has(path)) {
      continue;
    }
    visited.add(path);
    for (const edge of outgoing.get(path) ?? []) {
      const target = targetOf(edge.to);
      if (target === null || visited.has(target)) {
        continue;
      }
      if (isProjectPath(target)) {
        stack.push(target);
        continue;
      }
      const entry = nodes.get(target);
      if (inert.has(target) || omittedByFlags(entry, omitted)) {
        continue;
      }
      expected.add(target);
      stack.push(target);
    }
  }
  return expected;
}

// ---------------------------------------------------------------------------

function report(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function main() {
  const lockPath = resolve(process.cwd(), "package-lock.json");
  if (!existsSync(lockPath)) {
    report({ checked: false, reason: "no package-lock.json in the tree" });
    return;
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (err) {
    report({
      checked: false,
      reason: `package-lock.json could not be read: ${err.message}`,
    });
    return;
  }
  if (!lock || typeof lock !== "object") {
    report({
      checked: false,
      reason: "package-lock.json is not a JSON object",
    });
    return;
  }
  const version = Number(lock.lockfileVersion);
  if (!(version >= 2) || !lock.packages || typeof lock.packages !== "object") {
    report({
      checked: false,
      reason: `package-lock.json is lockfileVersion ${lock.lockfileVersion ?? "unknown"}, which declares no packages map`,
    });
    return;
  }

  const omitted = omittedClasses(installCommand);
  const missing = [];
  for (const path of expectedPaths(lock.packages, omitted)) {
    let present = false;
    try {
      present = statSync(resolve(process.cwd(), path)).isDirectory();
    } catch {
      present = false;
    }
    if (!present) {
      missing.push(path);
    }
  }
  missing.sort();
  report({ checked: true, missing });
}

main();
