//! Module resolution: what a program may import, what the SDK may import, and what neither may.
//!
//! This is the whole reason the ECMAScript arms left their previous engine. A program is a **module**
//! here — `Module::declare(ctx, "program.js", program)` over the model's own bytes — so every name it
//! uses is reached through an `import` line it wrote, which is what
//! `apps/docs/src/content/docs/gg/responses-as-code/invariants.md` requires and what the incumbent
//! could not do at any setting.
//!
//! # The four namespaces
//!
//! | specifier | what it is | who may import it |
//! | --- | --- | --- |
//! | `gg` | the whole SDK: one namespace per family, plus `ToolError` | anybody |
//! | `gg:<family>` | one family on its own (`gg:files`, `gg:views`) | anybody |
//! | `lib:<name>` | a code module from a code skill or a code memory the agent read | anybody |
//! | `sdk:<path>` | the SDK's own emitted files, and how its relative imports resolve | the SDK |
//! | `test-cabinet:gg/<interface>` | the raw membrane, one native module per WIT interface | the SDK |
//!
//! The last two are refused to a program, and the refusal is a message rather than a bare failure.
//! Not for safety — the capability gate is the host's, and every one of those calls would be checked
//! there exactly as an SDK call is — but because they are not the surface the catalogue describes.
//! A model shown `gg.files.readFile` and allowed to reach `test-cabinet:gg/files` has two spellings
//! of one call, one of which nothing documents.
//!
//! # `gg:<family>` and `sdk:gg/<family>.js` are ONE module
//!
//! `gg:files` resolves *to* `sdk:gg/files.js` rather than declaring a second copy, so a program and
//! the SDK share one module instance. Two instances would mean two `ToolError` classes, and the
//! `error instanceof ToolError` a program writes to narrow a `catch` would be false for an error the
//! SDK threw.

use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::module::Declared;
use rquickjs::{Ctx, Error, Module, Result};

use crate::membrane::declare_membrane;
use crate::sdk::SDK_SOURCES;

/// The name a model's program is compiled under.
///
/// It is the model's own file: nothing is prepended and nothing is appended, so line 1 column 1 of
/// what the model sent is line 1 column 1 here, and every frame the engine reports is already in the
/// model's coordinates. There is no offset anywhere in this guest — see ruling D11.
pub const PROGRAM: &str = "program.js";

/// The aggregate module, which is what `import { files } from "gg"` reaches.
pub const AGGREGATE: &str = "gg";

/// The scheme a code module is filed under.
const LIB: &str = "lib:";

/// The scheme the SDK's own emitted files are filed under.
const SDK: &str = "sdk:";

/// The package the membrane's interfaces live in, which the SDK imports by their full specifiers.
const MEMBRANE: &str = "test-cabinet:gg/";

/// Resolve a specifier against the module that wrote it.
pub struct GgResolver;

impl Resolver for GgResolver {
    fn resolve(
        &mut self,
        ctx: &Ctx<'_>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'_>>,
    ) -> Result<String> {
        match resolve(base, name) {
            Ok(resolved) => Ok(resolved),
            Err(message) => Err(loading(ctx, name, &message)),
        }
    }
}

/// The resolution itself, as a pure function, so it is testable without an engine.
pub fn resolve(base: &str, name: &str) -> std::result::Result<String, String> {
    let internal = base == AGGREGATE || base.starts_with(SDK);

    if name.starts_with("./") || name.starts_with("../") {
        if !internal {
            return Err(format!(
                "a relative import is how gg's own SDK reaches its parts; a program reaches gg by \
                 importing \"gg\" or \"gg:<family>\", not {name:?}"
            ));
        }
        return join(base, name);
    }

    if name == AGGREGATE {
        return Ok(AGGREGATE.to_string());
    }
    if let Some(family) = name.strip_prefix("gg:") {
        let target = format!("{SDK}gg/{family}.js");
        return match SDK_SOURCES.iter().any(|(specifier, _)| *specifier == target) {
            true => Ok(target),
            false => Err(format!(
                "gg has no {family:?} family; the families are {}",
                families().join(", ")
            )),
        };
    }
    if name.starts_with(LIB) {
        return Ok(name.to_string());
    }
    if name.starts_with(SDK) || name.starts_with(MEMBRANE) {
        return match internal {
            true => Ok(name.to_string()),
            false => Err(format!(
                "{name:?} is gg's own plumbing and is not the surface a program is documented \
                 against; import \"gg\" or \"gg:<family>\" instead"
            )),
        };
    }

    Err(format!(
        "there is no {name:?} to import. A program reaches gg with \"gg\" (or one family, \
         \"gg:<family>\": {}) and its own loaded code with \"lib:<name>\"; this sandbox has no \
         package registry and no filesystem module resolution",
        families().join(", ")
    ))
}

/// Every family name `gg:<family>` accepts, for a message that answers the question it raises.
pub fn families() -> Vec<&'static str> {
    SDK_SOURCES
        .iter()
        .filter_map(|(specifier, _)| {
            specifier
                .strip_prefix("sdk:gg/")
                .and_then(|rest| rest.strip_suffix(".js"))
        })
        .collect()
}

/// Resolve a relative specifier against an `sdk:` base, by ordinary path arithmetic.
fn join(base: &str, name: &str) -> std::result::Result<String, String> {
    let base = base.strip_prefix(SDK).unwrap_or(base);
    let mut segments: Vec<&str> = base.split('/').collect();
    // The base's own file name is not a directory.
    segments.pop();
    for segment in name.split('/') {
        match segment {
            "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(format!("{name:?} climbs above the SDK's own directory"));
                }
            }
            other => segments.push(other),
        }
    }
    Ok(format!("{SDK}{}", segments.join("/")))
}

/// Declare the module a resolved specifier names.
pub struct GgLoader {
    /// The code modules this turn was given, by the `lib:<name>` specifier each is reached under.
    modules: Vec<(String, String)>,
    /// The aggregate module's source, composed once from the baked SDK.
    aggregate: String,
}

impl GgLoader {
    /// Build a loader over the code modules this turn was handed.
    pub fn new(modules: Vec<(String, String)>) -> Self {
        Self {
            modules: modules
                .into_iter()
                .map(|(name, source)| (format!("{LIB}{name}"), source))
                .collect(),
            aggregate: aggregate_source(),
        }
    }
}

impl Loader for GgLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> Result<Module<'js, Declared>> {
        if let Some(declared) = declare_membrane(ctx, name) {
            return declared;
        }
        if name == AGGREGATE {
            return Module::declare(ctx.clone(), name, self.aggregate.clone());
        }
        if let Some((_, source)) = SDK_SOURCES.iter().find(|(specifier, _)| *specifier == name) {
            return Module::declare(ctx.clone(), name, *source);
        }
        if let Some((_, source)) = self.modules.iter().find(|(specifier, _)| specifier == name) {
            return Module::declare(ctx.clone(), name, source.clone());
        }
        if let Some(missing) = name.strip_prefix(LIB) {
            return Err(loading(
                ctx,
                name,
                &match self.modules.is_empty() {
                    true => format!(
                        "this agent has loaded no code skills or code memories, so there is no \
                         {missing:?} to import"
                    ),
                    false => format!(
                        "this agent has loaded no {missing:?}; it has {}",
                        self.modules
                            .iter()
                            .map(|(specifier, _)| specifier.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                },
            ));
        }
        Err(Error::new_loading(name))
    }
}

/// The `gg` module: one namespace per family, and `ToolError` beside them.
///
/// Composed from the baked SDK rather than written down, so a family gg grows is importable the
/// moment its declarations land. `core` is re-exported twice on purpose — as a namespace, because
/// `gg.core.ToolError` is the name a documentation view of the error type is opened by, and as the
/// bare `ToolError`, because `catch (error) { if (error instanceof ToolError) … }` is the shape the
/// prompt teaches and a qualified name in a `catch` reads as ceremony.
fn aggregate_source() -> String {
    let mut source = String::new();
    for family in families() {
        source.push_str(&format!("export * as {family} from \"gg:{family}\";\n"));
    }
    source.push_str("export { ToolError } from \"gg:core\";\n");
    source
}

/// A module-loading failure carrying a sentence, rather than the bare specifier the engine would
/// otherwise report.
fn loading(ctx: &Ctx<'_>, name: &str, message: &str) -> Error {
    rquickjs::Exception::throw_message(ctx, &format!("cannot import {name}: {message}"))
}
