//! Emission machinery shared by the TypeScript and JSON Schema generators.
//!
//! The contract types live in `crates/core` and `crates/backend`
//! and derive both [`ts_rs::TS`] and [`schemars::JsonSchema`] behind their
//! `contract` feature. This module turns those derives into the published
//! artifacts: a TypeScript declaration per type ([`ts_decl`]) and a
//! post-processed JSON Schema document per root type ([`finalize_schemas`]).

use std::collections::HashMap;

use anyhow::{Context, Result};
use schemars::generate::SchemaSettings;
use schemars::{JsonSchema, SchemaGenerator};
use serde_json::{Map, Value};
use ts_rs::{Config, TS};

/// The absolute base URL the published schemas live under. Each schema's `$id`
/// and every cross-schema `$ref` is rooted here, matching the URLs the
/// backend and snapshot schemas reference.
pub const SCHEMA_BASE_URL: &str = "https://docs.testcabinet.ai/schema";

/// The `ts_rs` config used for every binding: large integers (`i64`/`u64`) render
/// as `number`, matching the run-record contract (the values are real run counts,
/// never beyond JS-safe range) rather than `ts_rs`'s `bigint` default.
pub fn ts_config() -> Config {
    Config::new().with_large_int("number")
}

/// One generated TypeScript declaration: its published name, the exported block
/// (JSDoc + `export type …`), and the names of the other contract types it
/// references (so cross-module `import`s can be resolved).
pub struct TsDecl {
    name: String,
    body: String,
    deps: Vec<String>,
}

/// Build the [`TsDecl`] for a type: its JSDoc (from the Rust doc comment) followed
/// by an exported `type` alias. `ts_rs` emits field-level JSDoc inside the
/// declaration and the type-level JSDoc through [`TS::docs`]; we join them and
/// prepend `export`. Prettier (in the generator wrapper) normalizes the ragged
/// whitespace `ts_rs` produces, so it never reaches the committed file.
pub fn ts_decl<T: TS + 'static + ?Sized>(cfg: &Config) -> TsDecl {
    let docs = T::docs().unwrap_or_default();
    TsDecl {
        name: T::ident(cfg),
        // `T::decl` already terminates the alias with `;`.
        body: format!("{docs}export {}\n\n", T::decl(cfg)),
        deps: T::dependencies(cfg)
            .into_iter()
            .map(|dep| dep.ts_name)
            .collect(),
    }
}

/// One generated TypeScript module: a file under `packages/run-record/src/` and
/// the declarations it owns.
pub struct TsModule {
    /// File name under `packages/run-record/src/` (e.g. `index.ts`).
    pub file: &'static str,
    /// The declarations this module defines, in order.
    pub decls: Vec<TsDecl>,
}

/// Finalize every TypeScript module: resolve cross-module imports and prepend the
/// generated header. A type referenced by one module but defined in another is
/// imported from that module by relative path; references within the same module
/// need no import. Returns `(file, content)` pairs ready to write.
pub fn finalize_ts(modules: Vec<TsModule>, header: &str) -> Vec<(&'static str, String)> {
    // Global map: every contract type name → the module file that defines it.
    let mut home: HashMap<&str, &'static str> = HashMap::new();
    for module in &modules {
        for decl in &module.decls {
            home.insert(decl.name.as_str(), module.file);
        }
    }

    modules
        .iter()
        .map(|module| {
            let own: std::collections::HashSet<&str> =
                module.decls.iter().map(|d| d.name.as_str()).collect();
            let body: String = module.decls.iter().map(|d| d.body.as_str()).collect();

            // Group the external types this module references by their defining
            // module. A dependency is imported only if it actually appears in this
            // module's text, so transitive dependencies never become unused
            // imports.
            let mut imports: std::collections::BTreeMap<&str, std::collections::BTreeSet<&str>> =
                std::collections::BTreeMap::new();
            for decl in &module.decls {
                for dep in &decl.deps {
                    let dep = dep.as_str();
                    if own.contains(dep) {
                        continue;
                    }
                    if let Some(&source) = home.get(dep)
                        && source != module.file
                        && mentions(&body, dep)
                    {
                        imports.entry(source).or_default().insert(dep);
                    }
                }
            }

            let mut content = String::from(header);
            for (source, names) in &imports {
                let stem = source.strip_suffix(".ts").unwrap_or(source);
                let names: Vec<&str> = names.iter().copied().collect();
                content.push_str(&format!(
                    "import type {{ {} }} from \"./{stem}\";\n",
                    names.join(", ")
                ));
            }
            if !imports.is_empty() {
                content.push('\n');
            }
            content.push_str(&body);
            (module.file, content)
        })
        .collect()
}

/// Whether `name` appears in `text` as a whole identifier (not as a substring of a
/// longer identifier), so an import is emitted only for a type that is genuinely
/// referenced.
fn mentions(text: &str, name: &str) -> bool {
    let is_ident = |c: char| c.is_alphanumeric() || c == '_';
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

/// One JSON Schema document to publish: a root type rendered by `schemars`, the
/// repository-relative path it is written to, and the set of type names this
/// document is the canonical home of.
pub struct SchemaDoc {
    /// Path under `apps/docs/public/schema/`, e.g. `core/run-record.schema.json`.
    pub rel_path: &'static str,
    /// The root type's name, when the document's top-level schema is a single named
    /// type other documents may `$ref` (e.g. `RunRecord`). `None` for a document
    /// whose root is anonymous — an array (`active-runs`) or a request/response
    /// envelope nothing else references.
    pub root: Option<&'static str>,
    /// The subtype names this document owns (canonical `$defs`). Any other
    /// referenced type is rewritten to a `$ref` at its owning document's URL.
    pub owns: &'static [&'static str],
    /// The raw `schemars` output for the root type (subtypes under `$defs`).
    pub schema: Value,
}

/// Render a root type's schema with the settings every document shares: draft
/// 2020-12 with subtypes under `$defs`, `Option<T>` as a nullable `type` array,
/// no inlining.
pub fn root_schema<T: JsonSchema>() -> Value {
    let generator = SchemaGenerator::new(SchemaSettings::draft2020_12());
    serde_json::to_value(generator.into_root_schema_for::<T>())
        .expect("a schemars schema always serializes to JSON")
}

/// Where a type's canonical schema lives: the owning document's path and whether
/// the type is that document's root (referenced with no fragment) or a `$def`.
struct Owner {
    rel_path: &'static str,
    is_root: bool,
}

/// The absolute `$ref` URL for a type owned by another document: the document URL
/// for a root type, or a `#/$defs/<Name>` fragment for a subtype.
fn ref_url(owner: &Owner, name: &str) -> String {
    if owner.is_root {
        format!("{SCHEMA_BASE_URL}/{}", owner.rel_path)
    } else {
        format!("{SCHEMA_BASE_URL}/{}#/$defs/{name}", owner.rel_path)
    }
}

/// Finalize every schema document: build the global type-ownership map, then for
/// each document stamp `$id`, drop the `$defs` entries owned by *other* documents,
/// and rewrite every `$ref` to point at its owning document (a cross-document URL
/// when foreign, `#/$defs/...` when local). Returns `(rel_path, value)` pairs
/// ready to serialize.
pub fn finalize_schemas(docs: Vec<SchemaDoc>) -> Result<Vec<(&'static str, Value)>> {
    // Build the global ownership map and reject any type claimed by two documents
    // — that would make its canonical `$ref` ambiguous.
    let mut owner: HashMap<&'static str, Owner> = HashMap::new();
    for doc in &docs {
        let mut claim = |name: &'static str, is_root: bool| -> Result<()> {
            if let Some(prev) = owner.insert(
                name,
                Owner {
                    rel_path: doc.rel_path,
                    is_root,
                },
            ) {
                anyhow::bail!(
                    "type `{name}` is owned by both `{}` and `{}`",
                    prev.rel_path,
                    doc.rel_path
                );
            }
            Ok(())
        };
        if let Some(root) = doc.root {
            claim(root, true)?;
        }
        for name in doc.owns {
            claim(name, false)?;
        }
    }

    let mut out = Vec::with_capacity(docs.len());
    for doc in docs {
        let value = finalize_one(&doc, &owner)
            .with_context(|| format!("finalizing schema `{}`", doc.rel_path))?;
        out.push((doc.rel_path, value));
    }
    Ok(out)
}

fn finalize_one(doc: &SchemaDoc, owner: &HashMap<&'static str, Owner>) -> Result<Value> {
    let mut root = doc
        .schema
        .as_object()
        .cloned()
        .context("a root schema is always a JSON object")?;

    // Stamp the document identity. schemars 1.x already emits `$schema`
    // (draft 2020-12), so only `$id` is added here.
    root.insert(
        "$id".into(),
        Value::String(format!("{SCHEMA_BASE_URL}/{}", doc.rel_path)),
    );

    // schemars emits its subtype map under `$defs`. Drop the entries owned by
    // *another* document (those become cross-document `$ref`s). A subtype that is
    // local to this document — owned here, or shared by no one — stays inline.
    if let Some(Value::Object(defs)) = root.remove("$defs") {
        let kept: Map<String, Value> = defs
            .into_iter()
            .filter(|(name, _)| !is_foreign(name, doc, owner))
            .collect();
        if !kept.is_empty() {
            root.insert("$defs".into(), Value::Object(kept));
        }
    }

    // Rewrite every `$ref` in the document.
    let mut value = Value::Object(root);
    rewrite_refs(&mut value, doc, owner);
    Ok(value)
}

/// Whether `name` is canonically owned by a *different* document than `doc` — the
/// test for both dropping its local `$defs` copy and rewriting its `$ref` to a
/// cross-document URL. A name absent from the ownership map is document-local
/// (e.g. each API document's own `RunSummary`) and is never foreign.
fn is_foreign(name: &str, doc: &SchemaDoc, owner: &HashMap<&'static str, Owner>) -> bool {
    owner.get(name).is_some_and(|o| o.rel_path != doc.rel_path)
}

/// Recursively rewrite `$ref` strings. `schemars` emits `#/$defs/<Name>`;
/// a type owned by another document becomes that document's absolute URL, and
/// everything else (this document's own subtypes) becomes a local `#/$defs/`
/// reference.
fn rewrite_refs(value: &mut Value, doc: &SchemaDoc, owner: &HashMap<&'static str, Owner>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(reference)) = map.get("$ref")
                && let Some(name) = reference.strip_prefix("#/$defs/")
            {
                let rewritten = match owner.get(name) {
                    Some(target) if target.rel_path != doc.rel_path => ref_url(target, name),
                    _ => format!("#/$defs/{name}"),
                };
                map.insert("$ref".into(), Value::String(rewritten));
            }
            for child in map.values_mut() {
                rewrite_refs(child, doc, owner);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_refs(item, doc, owner);
            }
        }
        _ => {}
    }
}
