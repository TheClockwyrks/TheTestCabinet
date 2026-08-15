//! Turning a **code module** — the code half of a [skill](crate::skills) or a
//! [memory](crate::memories) — into the JavaScript the guest binds at `lib.<key>`.
//!
//! A module is authored, or written by a model, as an ordinary TypeScript file with `export`s. The
//! guest has no module system and never will: it evaluates a program as the body of a `new
//! Function`, and it evaluates a module exactly the same way. So something has to turn *"a file with
//! exports"* into *"a function body that returns its namespace"*, and this is it.
//!
//! # The rewrite, and why it is textual
//!
//! [`prepare_module`] parses the source **as a module** (so `export` is legal), collects the names
//! it exports, blanks the `export` keywords **with spaces**, and hands the result to the ordinary
//! [program pipeline](super::prepare_program). Then it appends one generated line:
//!
//! ```js
//! return { parseCsv, toRows };
//! ```
//!
//! Blanking rather than re-printing is the whole trick. Every later byte keeps its offset, so the
//! line and column a parse error, an early error or a run-time throw reports are the line and column
//! of the file the author actually wrote. Rebuilding the tree and printing it would move every
//! statement and hand the author a diagnostic pointing at a file nobody has.
//!
//! # What a module exports
//!
//! Whatever it says it exports — and, if it says nothing, everything it declares. The forgiving arm
//! exists because a file that declares three functions and exports none is a file whose author meant
//! all three: refusing it, or binding an empty object, would be a rule that only ever catches
//! someone out. Both halves are one sentence in the prompt and one sentence in the docs.
//!
//! Type-only declarations (`interface`, `type`) are not exported, because they do not exist at run
//! time. `export type { T }` is likewise dropped.
//!
//! # What is refused
//!
//! `import` in any form, `export … from`, `export *`, `export default`, a dynamic `import()`, and
//! top-level `await` — the same set a program is refused, for the same reason, in the same voice.
//! There is no loader to resolve a specifier against and no event loop to await on; a module is
//! `lib.<key>`, not a package. `export default` is refused specifically because a namespace is made
//! of names and a default has none.

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Declaration, ExportNamedDeclaration, Expression, ModuleExportName, Program, Statement,
    VariableDeclaration,
};
use oxc::parser::{Parser, ParserReturn};
use oxc::span::{GetSpan, SourceType};

use crate::sandbox::language::{PrepareError, PrepareFailure, PreparedModule};

use super::{
    MAX_NESTING_DEPTH, located, nesting_depth, on_a_deep_stack, over_nested_message, strip_types,
};

/// The guidance for module syntax a code module cannot use either — `import`, `export … from`,
/// `export *`. A module is a file gg binds at `lib.<key>`, not a package with dependencies.
fn cross_module_message(keyword: &str) -> String {
    format!(
        "This code module used `{keyword}`, which reaches for another file. There is no module \
         loader: a module is evaluated on its own, against the same gg functions your programs \
         call. Export what this file defines and nothing else."
    )
}

/// The guidance for `export default`, which has no name to bind in a namespace.
const DEFAULT_EXPORT_MESSAGE: &str = "This code module used `export default`. Its exports are reached by name (`lib.<key>.parseCsv`), \
     so a default export would have nothing to be called. Give it a name and export that.";

/// The guidance for a dynamic `import()` inside a module.
const DYNAMIC_IMPORT_MESSAGE: &str = "This code module used a dynamic `import()`. There is no module system and no loader — the gg \
     functions already in scope are everything it can reach.";

/// The guidance for top-level `await`, which a module has no more of than a program does.
const TOP_LEVEL_AWAIT_MESSAGE: &str = "This code module used top-level `await`. The sandbox is synchronous: every gg function returns \
     its value directly. Remove `await` (and any `async`).";

/// Prepare a code module into the function body the guest evaluates: type-stripped JavaScript
/// ending in the `return { … }` that makes its exports the value of evaluating it.
///
/// The nesting guard runs first and on the **original** source, exactly as it does for a program: a
/// module is untrusted input whoever wrote it, and the parser below it recurses without a depth
/// guard. Length is not guarded, here either — a module of any size is prepared, on a stack sized
/// for it.
pub fn prepare_module(src: &str) -> Result<PreparedModule, PrepareFailure> {
    let deepest = nesting_depth(src);
    if deepest > MAX_NESTING_DEPTH {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            over_nested_message(deepest),
        )));
    }

    // One trip to the deep stack for both parses: the plan's and the strip's. They recurse to the
    // same depth over the same source, and paying for the thread twice would buy nothing. Blanking
    // the `export` keywords preserves the source's length exactly, so the stack sized for `src` is
    // the stack the strip's parse of the blanked text needs too.
    on_a_deep_stack(src, || {
        let plan = plan_module(src)?;
        let stripped = strip_types(&plan.blanked)?;
        Ok(PreparedModule {
            source: format!("{}{}", stripped.source, plan.epilogue()),
            exports: plan.names(),
        })
    })
}

/// What the module pass decided: the source with every `export` keyword blanked, and the entries the
/// generated `return` hands back.
struct ModulePlan {
    /// The original source with the export syntax replaced by spaces — byte-for-byte the same
    /// length, so every diagnostic below still locates itself in the author's own file.
    blanked: String,
    /// The object-literal entries the epilogue is built from, in source order and deduplicated.
    /// Usually a bare name; a renaming export is `exported: local`.
    exports: Vec<String>,
}

impl ModulePlan {
    /// The names the namespace really offers — an entry's key, which for a renaming export is the
    /// half in front of the colon. This is what the model is told it can call.
    fn names(&self) -> Vec<String> {
        self.exports
            .iter()
            .map(|entry| {
                entry
                    .split_once(':')
                    .map_or(entry.as_str(), |(exported, _)| exported.trim())
                    .to_string()
            })
            .collect()
    }

    /// The generated `return { … };` appended to the type-stripped body.
    ///
    /// A module that exports nothing at all still returns an object rather than `undefined`: the
    /// guest binds whatever comes back, and an empty namespace is a truthful answer where `undefined`
    /// would look like a module that failed to load.
    fn epilogue(&self) -> String {
        format!("\nreturn {{ {} }};\n", self.exports.join(", "))
    }
}

/// Parse `src` as a module, refuse what a module may not do, and work out both halves of the plan.
fn plan_module(src: &str) -> Result<ModulePlan, PrepareError> {
    let allocator = Allocator::default();
    // Parsed as a module — no `allow_return_outside_function` — because `export` is the whole point
    // and a top-level `return` in a file that is about to be given a generated one is a mistake
    // worth the parser's own "Illegal return statement".
    let parsed = Parser::new(&allocator, src, SourceType::ts()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(PrepareError::Syntax(located(src, &parsed.diagnostics)));
    }
    if let Some(unsupported) = unsupported_in_module(&parsed) {
        return Err(PrepareError::Unsupported(unsupported));
    }

    let mut blanks: Vec<(usize, usize)> = Vec::new();
    let mut exported: Vec<String> = Vec::new();
    let mut declared: Vec<String> = Vec::new();

    for statement in &parsed.program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                collect_export(export, &mut blanks, &mut exported);
            }
            _ => {
                if let Some(declaration) = statement.as_declaration() {
                    collect_declared(declaration, &mut declared);
                }
            }
        }
    }

    // Everything an `export` named is also a declaration of this file, so the fallback arm sees the
    // whole top level whichever way the author wrote it.
    declared.extend(exported.iter().cloned());
    let mut exports = if exported.is_empty() {
        declared
    } else {
        exported
    };
    exports.dedup();

    Ok(ModulePlan {
        blanked: blank(src, &blanks),
        exports,
    })
}

/// Record one `export` statement: what it exports, and the bytes that have to stop saying `export`.
///
/// Two shapes reach here, and they are blanked differently. `export <declaration>` keeps its
/// declaration and loses only the keyword in front of it — the bytes from the statement's start to
/// the declaration's start, which is exactly `export` and the whitespace after it. A specifier-only
/// `export { a, b };` declares nothing at all, so the whole statement goes.
///
/// `export type { T }` and `export interface T {}` are dropped without being exported: a type does
/// not exist at run time, so a namespace entry for one would be `undefined`.
fn collect_export(
    export: &ExportNamedDeclaration<'_>,
    blanks: &mut Vec<(usize, usize)>,
    exported: &mut Vec<String>,
) {
    if export.export_kind.is_type() {
        blanks.push((export.span.start as usize, export.span.end as usize));
        return;
    }
    match &export.declaration {
        Some(declaration) => {
            blanks.push((
                export.span.start as usize,
                declaration.span().start as usize,
            ));
            collect_declared(declaration, exported);
        }
        None => {
            blanks.push((export.span.start as usize, export.span.end as usize));
            for specifier in &export.specifiers {
                if specifier.export_kind.is_type() {
                    continue;
                }
                // The name the namespace gets is the EXPORTED one: `export { rows as toRows }` binds
                // `lib.<key>.toRows`. The local name is what the generated object literal would have
                // to say, which is why a renaming export is emitted as `exported: local` below.
                let (Some(local), Some(exported_name)) = (
                    export_name(&specifier.local),
                    export_name(&specifier.exported),
                ) else {
                    continue;
                };
                exported.push(if local == exported_name {
                    local.to_string()
                } else {
                    format!("{exported_name}: {local}")
                });
            }
        }
    }
}

/// The identifier a `local`/`exported` half of an export specifier names, or `None` for the string
/// form (`export { a as "not an identifier" }`), which a namespace reached with `lib.<key>.name`
/// could not offer anyway.
fn export_name<'a>(name: &'a ModuleExportName<'a>) -> Option<&'a str> {
    match name {
        ModuleExportName::IdentifierName(ident) => Some(ident.name.as_str()),
        ModuleExportName::IdentifierReference(ident) => Some(ident.name.as_str()),
        ModuleExportName::StringLiteral(_) => None,
    }
}

/// Record the run-time names a declaration binds. Type-only declarations bind nothing: they are
/// erased before the guest ever sees them.
fn collect_declared(declaration: &Declaration<'_>, names: &mut Vec<String>) {
    match declaration {
        Declaration::VariableDeclaration(variable) => collect_variable(variable, names),
        Declaration::FunctionDeclaration(function) => {
            if let Some(id) = &function.id {
                names.push(id.name.to_string());
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(id) = &class.id {
                names.push(id.name.to_string());
            }
        }
        // A TypeScript `enum` is erased into a real object by the transformer, so it is a value.
        Declaration::TSEnumDeclaration(declaration) => {
            names.push(declaration.id.name.to_string());
        }
        // `interface` / `type` / `namespace` / `import x = require(…)`: nothing at run time.
        _ => {}
    }
}

/// Every identifier a `const`/`let`/`var` binds, destructuring included — `const { a, b } = x`
/// exports both.
fn collect_variable(variable: &VariableDeclaration<'_>, names: &mut Vec<String>) {
    for declarator in &variable.declarations {
        for identifier in declarator.id.get_binding_identifiers() {
            names.push(identifier.name.to_string());
        }
    }
}

/// `src` with every recorded byte range replaced by an ASCII space.
///
/// Byte-for-byte, deliberately: the ranges come from the parse and are therefore char-boundary
/// aligned, so filling them with spaces leaves valid UTF-8 of the identical length — which is the
/// property every later diagnostic's line and column depends on.
fn blank(src: &str, blanks: &[(usize, usize)]) -> String {
    let mut bytes = src.as_bytes().to_vec();
    for (start, end) in blanks {
        for byte in &mut bytes[*start..*end] {
            *byte = b' ';
        }
    }
    String::from_utf8(bytes).expect("blanking whole spans with ASCII spaces preserves UTF-8")
}

/// The module syntax a code module still may not use, as the sentence to hand whoever wrote it.
///
/// Read off the same two sources the program path reads: a flat scan of the top level names the
/// exact keyword, and the parser's module record catches the two shapes no statement shows.
fn unsupported_in_module(parsed: &ParserReturn<'_>) -> Option<String> {
    if let Some(message) = refused_statement(&parsed.program) {
        return Some(message);
    }
    if !parsed.module_record.dynamic_imports.is_empty() {
        return Some(DYNAMIC_IMPORT_MESSAGE.to_string());
    }
    if parsed.program.body.iter().any(statement_awaits) {
        return Some(TOP_LEVEL_AWAIT_MESSAGE.to_string());
    }
    None
}

/// The refusal a top-level statement earns, if one does. Module declarations are only legal at the
/// top level, so a flat scan sees every one there is.
fn refused_statement(program: &Program<'_>) -> Option<String> {
    program.body.iter().find_map(|statement| match statement {
        Statement::ImportDeclaration(_) => Some(cross_module_message("import")),
        Statement::ExportAllDeclaration(_) => Some(cross_module_message("export *")),
        Statement::ExportDefaultDeclaration(_) => Some(DEFAULT_EXPORT_MESSAGE.to_string()),
        Statement::ExportNamedDeclaration(export) if export.source.is_some() => {
            Some(cross_module_message("export … from"))
        }
        Statement::TSExportAssignment(_) => Some(cross_module_message("export =")),
        Statement::TSNamespaceExportDeclaration(_) => Some(cross_module_message("export as")),
        _ => None,
    })
}

/// Whether one top-level statement is a top-level `await`.
///
/// Deliberately shallow — it catches the two shapes a model actually writes (`await something();`
/// and `const x = await something();`), which is what the module parse accepts and the function-body
/// parse below it would reject with a far worse sentence. An `await` deeper than the top level is
/// inside an `async` function, which is a different mistake the guest reports with its own location.
fn statement_awaits(statement: &Statement<'_>) -> bool {
    fn awaits(expression: &Expression<'_>) -> bool {
        matches!(expression, Expression::AwaitExpression(_))
    }
    match statement {
        Statement::ExpressionStatement(statement) => awaits(&statement.expression),
        Statement::VariableDeclaration(declaration) => declaration
            .declarations
            .iter()
            .any(|declarator| declarator.init.as_ref().is_some_and(awaits)),
        _ => false,
    }
}

#[cfg(test)]
#[path = "typescript.modules.test.rs"]
mod tests;
