//! The module graph: one node per authored source file, edges from resolved intra-tree
//! imports.
//!
//! This is where the "did the model think about layering?" signal lives, and one of its
//! figures — **import cycles** — is invisible to every other metric here.
//!
//! # Resolution is hand-rolled, and that is the honest description
//!
//! Neither front end performs type inference and neither runs a module resolver, so every
//! edge is resolved by rewriting a specifier into a candidate path and asking whether the
//! tree holds it. That handles the shapes this corpus actually produces — relative imports,
//! extensionless imports, `index` barrels, TypeScript's `.js`-for-`.ts` convention, Rust's
//! `mod.rs`/`name.rs` pair — and it cannot see a dynamic `import()`, a path alias declared
//! in `tsconfig.json`, or anything a bundler config rewires. Everything downstream of it is
//! labelled approximate in the metric catalog rather than in a sentence.
//!
//! Rust crate roots are discovered by **parsing `Cargo.toml` directly**, never by shelling
//! out to `cargo`, which resolves the dependency graph and therefore needs the registry.
//!
//! # HTML gets a pass of its own
//!
//! Every end-to-end case in this corpus is a bundler project whose real entry point is
//! named from HTML and is otherwise invisible to an import walk. Without the extra pass the
//! entire application reads as orphaned — the single most misleading result the graph could
//! produce.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use test_cabinet_core::CodeLanguage;

use crate::facts::FileFacts;
use crate::walk::FileRole;

/// One file as the graph sees it.
pub struct GraphInput<'a> {
    /// Path relative to the tree root.
    pub path: &'a str,
    /// What the walk decided it was.
    pub role: FileRole,
    /// What the front end found, when one parsed it.
    pub facts: Option<&'a FileFacts>,
    /// The file's text, for the roles that are read rather than parsed (HTML, manifests).
    pub source: Option<&'a str>,
}

/// The resolved graph.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModuleGraph {
    /// Nodes, as indices into the input slice — only the files a front end parsed are
    /// nodes; HTML, manifests and data files contribute edges and entry points but are not
    /// modules.
    pub nodes: Vec<usize>,
    /// Deduplicated `(from, to)` edges, as indices into the input slice.
    pub edges: BTreeSet<(usize, usize)>,
    /// Outgoing edge count per input index.
    pub fan_out: BTreeMap<usize, u32>,
    /// Incoming edge count per input index.
    pub fan_in: BTreeMap<usize, u32>,
    /// Files an entry point **declared**: an HTML `<script src>` target, or a crate root.
    ///
    /// Only declared entries. A tree that names none has an empty set rather than a guessed
    /// one, because "this tree declares its entry points" and "this tree happens to have a
    /// module nothing imports" are different facts and conflating them is what made the
    /// orphan figure meaningless.
    pub entry_points: BTreeSet<usize>,
    /// Files nothing imports and no entry point names — dead modules the model wrote and
    /// abandoned.
    ///
    /// Deliberately **not** transitive reachability. A library has no entry point to be
    /// reachable *from*, so a reachability definition reports every one of its files as
    /// dead the moment a single stray HTML file suppresses the fallback that would have
    /// seeded its roots. "Nothing imports this, and nothing declares it" is weaker, but it
    /// means the same thing in a bundler project and in a library, which is the property a
    /// cross-case metric needs.
    pub orphans: BTreeSet<usize>,
    /// The longest shortest-path from an entry point, in edges.
    pub max_depth: u32,
    /// Distinct external packages imported.
    pub external_packages: BTreeSet<String>,
    /// Strongly connected components of more than one node, each sorted.
    pub cycles: Vec<Vec<usize>>,
    /// The subset of [`edges`](Self::edges) that came from a wholesale re-export
    /// (`export * from …`, `use foo::*`).
    ///
    /// Tracked separately because a barrel is the single biggest source of false
    /// "unreferenced export" reports: a name re-exported by a barrel is referenced by that
    /// barrel even though the barrel never writes the name down.
    pub reexport_edges: BTreeSet<(usize, usize)>,
}

/// Build the graph over `files`.
pub fn build(files: &[GraphInput<'_>]) -> ModuleGraph {
    let index = PathIndex::new(files);
    let crates = CrateIndex::new(files);
    let mut graph = ModuleGraph {
        nodes: (0..files.len())
            .filter(|position| matches!(files[*position].role, FileRole::Source(_)))
            .collect(),
        ..ModuleGraph::default()
    };

    for (position, file) in files.iter().enumerate() {
        match file.role {
            FileRole::Source(language) => {
                let Some(facts) = file.facts else { continue };
                for import in &facts.imports {
                    match language {
                        CodeLanguage::TypeScript => {
                            match index.resolve_typescript(file.path, &import.specifier) {
                                Some(target) => {
                                    graph.add_edge(position, target, import.reexport);
                                }
                                None => graph.note_external(&import.specifier),
                            }
                        }
                        CodeLanguage::Rust => {
                            match crates.resolve(&index, file.path, &import.specifier) {
                                Resolution::Intra(target) => {
                                    graph.add_edge(position, target, import.reexport);
                                }
                                Resolution::External(package) => graph.note_external(&package),
                                Resolution::Local => {}
                            }
                        }
                    }
                }
            }
            FileRole::Html => {
                if let Some(source) = file.source {
                    for target in html_scripts(source)
                        .iter()
                        .filter_map(|src| index.resolve_typescript(file.path, src))
                    {
                        graph.entry_points.insert(target);
                    }
                }
            }
            FileRole::Manifest | FileRole::Data => {}
        }
    }

    graph.entry_points.extend(crates.roots.iter().copied());
    graph.compute_reachability();
    graph.cycles = strongly_connected(&graph.nodes, &graph.edges);
    graph
}

impl ModuleGraph {
    fn add_edge(&mut self, from: usize, to: usize, reexport: bool) {
        if from == to {
            // A self-import is a resolution artifact (an `index.ts` that re-exports its own
            // directory), never a layering fact.
            return;
        }
        if reexport {
            self.reexport_edges.insert((from, to));
        }
        if self.edges.insert((from, to)) {
            *self.fan_out.entry(from).or_insert(0) += 1;
            *self.fan_in.entry(to).or_insert(0) += 1;
        }
    }

    fn note_external(&mut self, specifier: &str) {
        // Node subpath imports (`three/examples/jsm/…`) and scoped packages both name the
        // package in their first one or two segments.
        let mut segments = specifier.split('/');
        let Some(first) = segments.next() else { return };
        let package = if first.starts_with('@') {
            match segments.next() {
                Some(second) => format!("{first}/{second}"),
                None => first.to_string(),
            }
        } else {
            first.to_string()
        };
        if !package.is_empty() {
            self.external_packages.insert(package);
        }
    }

    /// Name the orphans, and measure the graph's depth.
    ///
    /// Depth is a breadth-first walk from every **root** — the declared entry points plus
    /// every module nothing imports — because a library's top-level API module is a root
    /// whether or not anything declares it, and starting only from declared entries would
    /// report a depth of zero for a tree that is ten layers deep.
    fn compute_reachability(&mut self) {
        let mut outgoing: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (from, to) in &self.edges {
            outgoing.entry(*from).or_default().push(*to);
        }

        let unimported: BTreeSet<usize> = self
            .nodes
            .iter()
            .copied()
            .filter(|node| self.fan_in.get(node).copied().unwrap_or(0) == 0)
            .collect();
        self.orphans = unimported.difference(&self.entry_points).copied().collect();

        let mut seen: BTreeMap<usize, u32> = BTreeMap::new();
        let mut queue: VecDeque<usize> = VecDeque::new();
        for root in self.entry_points.union(&unimported) {
            seen.insert(*root, 0);
            queue.push_back(*root);
        }
        while let Some(node) = queue.pop_front() {
            let depth = seen[&node];
            self.max_depth = self.max_depth.max(depth);
            for next in outgoing.get(&node).into_iter().flatten() {
                if !seen.contains_key(next) {
                    seen.insert(*next, depth + 1);
                    queue.push_back(*next);
                }
            }
        }
    }
}

/// Tarjan's algorithm, written **iteratively**.
///
/// The recursive formulation is one stack frame per graph node, and this graph is built
/// from untrusted input: a tree of twenty thousand modules in one chain would overflow the
/// stack, which — as everywhere else in this crate — is `SIGABRT` rather than a catchable
/// panic. The iterative form moves that depth onto the heap, so the graph needs none of the
/// [parse-thread machinery](crate::caps).
///
/// Returns only components of more than one node — a single node is not a cycle, and a
/// self-edge is never added.
fn strongly_connected(nodes: &[usize], edges: &BTreeSet<(usize, usize)>) -> Vec<Vec<usize>> {
    let mut outgoing: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (from, to) in edges {
        outgoing.entry(*from).or_default().push(*to);
    }

    let mut index_of: BTreeMap<usize, u32> = BTreeMap::new();
    let mut low_link: BTreeMap<usize, u32> = BTreeMap::new();
    let mut on_stack: BTreeSet<usize> = BTreeSet::new();
    let mut component_stack: Vec<usize> = Vec::new();
    let mut next_index: u32 = 0;
    let mut components: Vec<Vec<usize>> = Vec::new();

    for root in nodes {
        if index_of.contains_key(root) {
            continue;
        }
        // Each frame is (node, how many of its successors have been dealt with).
        let mut frames: Vec<(usize, usize)> = vec![(*root, 0)];
        index_of.insert(*root, next_index);
        low_link.insert(*root, next_index);
        next_index += 1;
        component_stack.push(*root);
        on_stack.insert(*root);

        while let Some((node, cursor)) = frames.pop() {
            let successors = outgoing.get(&node).map(Vec::as_slice).unwrap_or(&[]);
            if cursor < successors.len() {
                let next = successors[cursor];
                frames.push((node, cursor + 1));
                if let std::collections::btree_map::Entry::Vacant(slot) = index_of.entry(next) {
                    slot.insert(next_index);
                    low_link.insert(next, next_index);
                    next_index += 1;
                    component_stack.push(next);
                    on_stack.insert(next);
                    frames.push((next, 0));
                } else if on_stack.contains(&next) {
                    let candidate = index_of[&next];
                    let current = low_link[&node];
                    low_link.insert(node, current.min(candidate));
                }
                continue;
            }
            // Every successor is done: fold this node's low-link into its parent's, then
            // close a component if this node is its root.
            if let Some((parent, _)) = frames.last().copied() {
                let child = low_link[&node];
                let current = low_link[&parent];
                low_link.insert(parent, current.min(child));
            }
            if low_link[&node] == index_of[&node] {
                let mut component = Vec::new();
                while let Some(member) = component_stack.pop() {
                    on_stack.remove(&member);
                    component.push(member);
                    if member == node {
                        break;
                    }
                }
                if component.len() > 1 {
                    component.sort_unstable();
                    components.push(component);
                }
            }
        }
    }
    components.sort();
    components
}

/// Every path in the tree, for candidate lookup.
struct PathIndex {
    positions: BTreeMap<String, usize>,
}

impl PathIndex {
    fn new(files: &[GraphInput<'_>]) -> Self {
        Self {
            positions: files
                .iter()
                .enumerate()
                .map(|(position, file)| (file.path.to_string(), position))
                .collect(),
        }
    }

    fn get(&self, path: &str) -> Option<usize> {
        self.positions.get(path).copied()
    }

    /// Resolve a TypeScript/JavaScript specifier written in `from` against the tree.
    ///
    /// Only relative and root-absolute specifiers resolve; a bare specifier is an external
    /// package and is reported as one.
    fn resolve_typescript(&self, from: &str, specifier: &str) -> Option<usize> {
        let base = if let Some(rest) = specifier.strip_prefix('/') {
            rest.to_string()
        } else if specifier.starts_with("./") || specifier.starts_with("../") {
            join_relative(parent_of(from), specifier)?
        } else {
            return None;
        };

        // TypeScript's ESM convention is to write `./thing.js` for a file that is
        // `./thing.ts` on disk, so a `.js` specifier is retried as its TypeScript source
        // before it is given up on.
        let stems: Vec<String> = match base.rsplit_once('.') {
            Some((stem, "js" | "mjs" | "cjs" | "jsx")) => vec![base.clone(), stem.to_string()],
            _ => vec![base.clone()],
        };
        const EXTENSIONS: [&str; 8] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
        for stem in &stems {
            if let Some(position) = self.get(stem) {
                return Some(position);
            }
            for extension in EXTENSIONS {
                if let Some(position) = self.get(&format!("{stem}.{extension}")) {
                    return Some(position);
                }
            }
            for extension in EXTENSIONS {
                if let Some(position) = self.get(&format!("{stem}/index.{extension}")) {
                    return Some(position);
                }
            }
        }
        None
    }
}

/// How a Rust `use` path resolved.
enum Resolution {
    /// An edge to another file in the tree.
    Intra(usize),
    /// A package outside the tree.
    External(String),
    /// Something inside the same file — a `self::` path, a `use` of a local item — which is
    /// neither an edge nor an external dependency.
    Local,
}

/// The tree's own crates, and where each one's root module lives.
struct CrateIndex {
    /// Crate name → the directory its `src/` sits under.
    directories: BTreeMap<String, String>,
    /// Input positions of every crate root (`src/lib.rs`, `src/main.rs`).
    roots: BTreeSet<usize>,
}

impl CrateIndex {
    fn new(files: &[GraphInput<'_>]) -> Self {
        let index = PathIndex::new(files);
        let mut directories = BTreeMap::new();
        let mut roots = BTreeSet::new();
        for file in files.iter() {
            if file.role != FileRole::Manifest || !file.path.ends_with("Cargo.toml") {
                continue;
            }
            let Some(source) = file.source else { continue };
            let Some(name) = manifest_package_name(source) else {
                continue;
            };
            let directory = parent_of(file.path).to_string();
            for root in ["src/lib.rs", "src/main.rs"] {
                let path = join_segments(&directory, root);
                if let Some(position) = index.get(&path) {
                    roots.insert(position);
                }
            }
            // A crate's `use` paths are written with underscores where its package name has
            // hyphens, so both spellings are indexed.
            directories.insert(name.replace('-', "_"), directory.clone());
            directories.insert(name, directory);
        }
        Self { directories, roots }
    }

    /// Resolve a Rust module path written in `from`.
    ///
    /// A `#[path = "…"]` module declaration names a file rather than a module path, and is
    /// told apart by shape: a specifier that ends in `.rs` or holds a `/` is a path.
    ///
    /// It resolves against the **directory the declaring file is in**, which is `#[path]`'s
    /// own rule and is deliberately *not* the module directory an implicit `mod name;`
    /// would use. That difference is what makes this repository's sibling `foo.test.rs`
    /// convention resolve: `#[path = "agent.test.rs"] mod tests;` inside `src/agent.rs`
    /// names `src/agent.test.rs`, not `src/agent/agent.test.rs`.
    fn resolve(&self, index: &PathIndex, from: &str, path: &str) -> Resolution {
        if path.ends_with(".rs") || path.contains('/') {
            return match join_relative(parent_of(from), path).and_then(|joined| index.get(&joined))
            {
                Some(position) => Resolution::Intra(position),
                None => Resolution::Local,
            };
        }
        let mut segments: Vec<&str> = path.split("::").filter(|part| !part.is_empty()).collect();
        if segments.is_empty() {
            return Resolution::Local;
        }
        let (base, rest) = match segments[0] {
            "self" => (module_dir(from), segments.split_off(1)),
            "super" => (
                parent_of(&module_dir(from)).to_string(),
                segments.split_off(1),
            ),
            "crate" => match self.crate_source_root(from) {
                Some(root) => (root, segments.split_off(1)),
                None => return Resolution::Local,
            },
            first => match self.directories.get(first) {
                Some(directory) => (join_segments(directory, "src"), segments.split_off(1)),
                // `std`, `core` and `alloc` are the language, not a dependency.
                None if matches!(first, "std" | "core" | "alloc") => return Resolution::Local,
                None => return Resolution::External(first.to_string()),
            },
        };
        // A `use` names an *item*, so the module is every segment but the last — and the
        // last segment may itself be a module (`use crate::render;`), which is why both are
        // tried.
        for take in [rest.len(), rest.len().saturating_sub(1)] {
            let module = rest[..take].join("/");
            let stem = if module.is_empty() {
                base.clone()
            } else {
                join_segments(&base, &module)
            };
            for candidate in [format!("{stem}.rs"), format!("{stem}/mod.rs")] {
                if let Some(position) = index.get(&candidate) {
                    return Resolution::Intra(position);
                }
            }
        }
        Resolution::Local
    }

    /// The `src/` directory of the crate `path` belongs to, by longest matching prefix.
    fn crate_source_root(&self, path: &str) -> Option<String> {
        self.directories
            .values()
            .filter(|directory| directory.is_empty() || path.starts_with(&format!("{directory}/")))
            .max_by_key(|directory| directory.len())
            .map(|directory| join_segments(directory, "src"))
    }
}

/// The `[package] name` of a `Cargo.toml`, if it declares one.
fn manifest_package_name(source: &str) -> Option<String> {
    let manifest: toml::Value = toml::from_str(source).ok()?;
    Some(manifest.get("package")?.get("name")?.as_str()?.to_string())
}

/// The `src` of every `<script>` tag in `source`.
///
/// A byte scan rather than an HTML parser: the question is which files the page names, the
/// answer is a quoted attribute value, and pulling in a parser to read it would be the only
/// dependency in this crate that is not a language front end.
fn html_scripts(source: &str) -> Vec<String> {
    let lower = source.to_ascii_lowercase();
    let mut found = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = lower[cursor..].find("<script") {
        let start = cursor + offset;
        let end = lower[start..]
            .find('>')
            .map(|length| start + length)
            .unwrap_or(lower.len());
        let tag = &source[start..end];
        if let Some(src) = attribute(tag, "src") {
            found.push(src);
        }
        cursor = end.max(start + 1);
    }
    found
}

/// The value of `name` in an HTML tag's text, single- or double-quoted.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let at = lower.find(&format!("{name}="))?;
    let rest = &tag[at + name.len() + 1..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value = &rest[1..];
    let end = value.find(quote)?;
    Some(value[..end].to_string())
}

/// The directory of `path`, or the empty string for a file at the tree root.
fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(head, _)| head).unwrap_or("")
}

/// The directory a Rust file's **child modules** live in.
///
/// Rust's two module-file conventions put it in two places. A `mod.rs` (and a crate root)
/// owns the directory it sits in; any other `foo.rs` owns the sibling directory `foo/`. A
/// `mod bar;` written in `src/agent.rs` therefore names `src/agent/bar.rs`, not
/// `src/bar.rs`, and resolving it against the plain parent directory would silently find
/// the wrong file — or, more often, none at all, orphaning the whole subtree.
fn module_dir(path: &str) -> String {
    let parent = parent_of(path);
    let name = path.rsplit('/').next().unwrap_or(path);
    match name {
        "mod.rs" | "lib.rs" | "main.rs" => parent.to_string(),
        _ => {
            let stem = name.strip_suffix(".rs").unwrap_or(name);
            join_segments(parent, stem)
        }
    }
}

/// Join `tail` onto `base`, tolerating an empty `base`.
fn join_segments(base: &str, tail: &str) -> String {
    if base.is_empty() {
        tail.to_string()
    } else {
        format!("{base}/{tail}")
    }
}

/// Resolve `specifier` (which starts `./` or `../`) against `base`, normalising away `.`
/// and `..`. Returns `None` if it climbs above the tree root, which no legitimate intra-tree
/// import does.
fn join_relative(base: &str, specifier: &str) -> Option<String> {
    let mut segments: Vec<&str> = if base.is_empty() {
        Vec::new()
    } else {
        base.split('/').collect()
    };
    for part in specifier.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    Some(segments.join("/"))
}

#[cfg(test)]
#[path = "graph.test.rs"]
mod tests;
