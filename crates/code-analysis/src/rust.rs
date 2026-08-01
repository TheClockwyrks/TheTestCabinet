//! The Rust front end, through `syn`.
//!
//! It answers the same questions the [TypeScript front end](crate::typescript) does, scored
//! through the same [`ComplexityScorer`], and it deliberately mirrors that front end's
//! *questions* rather than enumerating Rust's features: `unwrap`/`expect` density is the
//! analogue of `any` (papering over the type system), and clone density is a proxy for
//! fighting the borrow checker instead of designing ownership.
//!
//! # `syn` is a recursive-descent parser over untrusted input too
//!
//! Everything the [module docs on `caps`](crate::caps) say about `oxc` applies here
//! unchanged, and the calibration is done per front end for exactly that reason: the two
//! parsers have different frame sizes, so one measured figure cannot speak for both. The
//! shared derivation is sized against the hungrier of the two.
//!
//! # Module paths, not file paths
//!
//! A Rust `use` names a module path, not a file, so resolving it needs the crate's own
//! module tree. That resolution lives in [`graph`](crate::graph), which has the whole file
//! list; this front end only reports the paths it saw.

use proc_macro2::Span;
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{
    Expr, ExprIf, File, ImplItemFn, Item, ItemFn, ItemTrait, Signature, TraitItemFn, UseTree,
    Visibility,
};

use crate::facts::{ComplexityScorer, FileFacts, FunctionFacts, ImportFacts, is_test_path};

/// Parse `source` and report what it holds.
///
/// Returns `None` when the file does not parse. `syn` is all-or-nothing — there is no error
/// recovery — so a produced tree with one mid-edit file loses that file's figures and keeps
/// the rest, which is the same posture the TypeScript side takes.
pub fn analyze(path: &str, source: &str) -> Option<FileFacts> {
    let file: File = syn::parse_file(source).ok()?;
    let mut visitor = RustVisitor::new(path);
    visitor.count_lints(source);
    visitor.visit_file(&file);
    Some(visitor.finish())
}

/// One function currently being scored.
struct OpenFunction {
    name: String,
    line: u32,
    lines: u32,
    parameters: u32,
    exported: bool,
    scorer: ComplexityScorer,
}

/// The walk's state.
struct RustVisitor {
    facts: FileFacts,
    open: Vec<OpenFunction>,
    /// The prefix of the `use` tree currently being flattened, so
    /// `use crate::{a::b, c}` reports `crate::a::b` and `crate::c`.
    use_prefix: Vec<String>,
    /// Whether the item being walked is inside a `pub` boundary.
    exporting: bool,
}

impl RustVisitor {
    fn new(path: &str) -> Self {
        Self {
            facts: FileFacts {
                is_test: is_test_path(path),
                ..FileFacts::default()
            },
            open: Vec::new(),
            use_prefix: Vec::new(),
            exporting: false,
        }
    }

    fn finish(self) -> FileFacts {
        self.facts
    }

    fn score(&mut self, score: impl FnOnce(&mut ComplexityScorer)) {
        if let Some(open) = self.open.last_mut() {
            score(&mut open.scorer);
        }
    }

    fn note_identifier(&mut self, name: &str) {
        *self.facts.identifiers.entry(name.to_string()).or_insert(0) += 1;
    }

    /// `#[allow(…)]` is written as an attribute and attributes hang off items rather than
    /// forming a walkable node of their own, so the suppression counter reads the text.
    ///
    /// Deliberately textual: the alternative is visiting every attribute of every item kind
    /// `syn` has, to count a figure whose whole purpose is "how often did the model tell the
    /// compiler to be quiet".
    fn count_lints(&mut self, source: &str) {
        self.facts.rust.suppressed_lints =
            source.matches("#[allow(").count() as u32 + source.matches("#![allow(").count() as u32;
    }

    fn open_function(&mut self, name: String, span: Span, signature: &Signature, exported: bool) {
        self.score(ComplexityScorer::enter_nesting);
        let (line, lines) = span_lines(span);
        if !signature.generics.params.is_empty() {
            self.facts.rust.generic_items += 1;
        }
        self.open.push(OpenFunction {
            name,
            line,
            lines,
            parameters: signature.inputs.len() as u32,
            exported,
            scorer: ComplexityScorer::new(),
        });
    }

    fn close_function(&mut self) {
        let Some(open) = self.open.pop() else { return };
        let (cyclomatic, cognitive, max_nesting, exits) = open.scorer.finish();
        self.facts.functions.push(FunctionFacts {
            name: open.name,
            line: open.line,
            lines: open.lines,
            cyclomatic,
            cognitive,
            max_nesting,
            parameters: open.parameters,
            exits,
            exported: open.exported,
        });
        self.score(ComplexityScorer::leave);
    }

    /// Walk an `if` chain by hand, so `else if` reads as a flat ladder rung — the same
    /// treatment, for the same reason, as the TypeScript side.
    fn visit_if_chain(&mut self, expression: &ExprIf, is_else_if: bool) {
        if is_else_if {
            self.score(ComplexityScorer::enter_else_if);
        } else {
            self.score(ComplexityScorer::enter_branch);
        }
        self.visit_expr(&expression.cond);
        self.visit_block(&expression.then_branch);
        self.score(ComplexityScorer::leave);

        match expression.else_branch.as_ref().map(|(_, branch)| &**branch) {
            None => {}
            Some(Expr::If(nested)) => self.visit_if_chain(nested, true),
            Some(other) => {
                self.score(ComplexityScorer::else_clause);
                self.score(ComplexityScorer::enter_nesting);
                self.visit_expr(other);
                self.score(ComplexityScorer::leave);
            }
        }
    }

    /// Flatten one `use` tree into the module paths it names.
    fn flatten_use(&mut self, tree: &UseTree) {
        match tree {
            UseTree::Path(path) => {
                self.use_prefix.push(path.ident.to_string());
                self.flatten_use(&path.tree);
                self.use_prefix.pop();
            }
            UseTree::Group(group) => {
                for item in &group.items {
                    self.flatten_use(item);
                }
            }
            UseTree::Name(name) => self.record_use(&name.ident.to_string()),
            UseTree::Rename(rename) => self.record_use(&rename.ident.to_string()),
            // `use foo::*` is Rust's barrel: the names it brings in are referenced through
            // it, exactly as an `export * from` re-export is in TypeScript.
            UseTree::Glob(_) => {
                let path = self.use_prefix.join("::");
                self.facts.imports.push(ImportFacts {
                    specifier: path,
                    reexport: true,
                });
            }
        }
    }

    fn record_use(&mut self, leaf: &str) {
        let mut segments = self.use_prefix.clone();
        segments.push(leaf.to_string());
        self.facts.imports.push(ImportFacts {
            specifier: segments.join("::"),
            reexport: false,
        });
        // The leaf of a `use` is a reference to the item it names, which is what lets a
        // symbol imported but used only through a macro still count.
        self.note_identifier(leaf);
    }

    /// Whether `visibility` exports the item, and fold it into the public/total ratio.
    fn record_item_visibility(&mut self, visibility: &Visibility) -> bool {
        self.facts.rust.items += 1;
        let public = !matches!(visibility, Visibility::Inherited);
        if public {
            self.facts.rust.public_items += 1;
        }
        public
    }
}

impl<'ast> Visit<'ast> for RustVisitor {
    fn visit_item(&mut self, item: &'ast Item) {
        // Track the `pub` boundary so a function's `exported` flag is the item's own
        // visibility, and count the item for the public ratio.
        let exported = match item {
            Item::Fn(function) => self.record_item_visibility(&function.vis),
            Item::Struct(item) => self.record_item_visibility(&item.vis),
            Item::Enum(item) => self.record_item_visibility(&item.vis),
            Item::Trait(item) => self.record_item_visibility(&item.vis),
            Item::Type(item) => self.record_item_visibility(&item.vis),
            Item::Const(item) => self.record_item_visibility(&item.vis),
            Item::Static(item) => self.record_item_visibility(&item.vis),
            Item::Mod(item) => self.record_item_visibility(&item.vis),
            Item::Union(item) => self.record_item_visibility(&item.vis),
            _ => self.exporting,
        };
        if let Some(name) = item_name(item) {
            if exported {
                self.facts.exports.push(name.clone());
            }
            self.note_identifier(&name);
        }
        if matches!(item, Item::Impl(inner) if inner.unsafety.is_some())
            || matches!(item, Item::Fn(inner) if inner.sig.unsafety.is_some())
        {
            self.facts.rust.unsafe_items += 1;
        }
        let outer = std::mem::replace(&mut self.exporting, exported);
        syn::visit::visit_item(self, item);
        self.exporting = outer;
    }

    fn visit_item_fn(&mut self, function: &'ast ItemFn) {
        let exported = self.exporting;
        let is_test = function
            .attrs
            .iter()
            .any(|attribute| attribute.path().is_ident("test"));
        if is_test {
            self.facts.test_functions += 1;
            self.facts.is_test = true;
        }
        self.open_function(
            function.sig.ident.to_string(),
            function.span(),
            &function.sig,
            exported,
        );
        syn::visit::visit_item_fn(self, function);
        self.close_function();
    }

    fn visit_impl_item_fn(&mut self, function: &'ast ImplItemFn) {
        let exported = !matches!(function.vis, Visibility::Inherited);
        if function
            .attrs
            .iter()
            .any(|attribute| attribute.path().is_ident("test"))
        {
            self.facts.test_functions += 1;
            self.facts.is_test = true;
        }
        self.open_function(
            function.sig.ident.to_string(),
            function.span(),
            &function.sig,
            exported,
        );
        syn::visit::visit_impl_item_fn(self, function);
        self.close_function();
    }

    fn visit_trait_item_fn(&mut self, function: &'ast TraitItemFn) {
        // A trait method with a default body is a function like any other; one without is a
        // signature, and scoring it would report a stream of complexity-1 functions that
        // nobody wrote a body for.
        if function.default.is_none() {
            syn::visit::visit_trait_item_fn(self, function);
            return;
        }
        self.open_function(
            function.sig.ident.to_string(),
            function.span(),
            &function.sig,
            true,
        );
        syn::visit::visit_trait_item_fn(self, function);
        self.close_function();
    }

    fn visit_item_trait(&mut self, item: &'ast ItemTrait) {
        self.facts.rust.traits += 1;
        syn::visit::visit_item_trait(self, item);
    }

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        self.flatten_use(&item.tree);
        syn::visit::visit_item_use(self, item);
    }

    /// A `mod name;` **is** an edge, and the most important one in a Rust tree.
    ///
    /// Rust's module tree is built out of these declarations, not out of `use` — a crate
    /// root that says `mod render;` and nothing else still owns `src/render.rs`. Without
    /// them the graph sees only the handful of files a `use crate::…` happens to name, and
    /// every other file in the crate reads as an orphan: the graph would report a
    /// well-layered crate as almost entirely dead code.
    ///
    /// A `#[path = "…"]` attribute names the file directly, which is how this repository's
    /// sibling `.test.rs` files are attached. Those are emitted as the path they name, and
    /// the resolver tells the two forms apart by shape.
    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        if item.content.is_none() {
            let attributed = item.attrs.iter().find_map(|attribute| {
                if !attribute.path().is_ident("path") {
                    return None;
                }
                match &attribute.meta {
                    syn::Meta::NameValue(pair) => match &pair.value {
                        syn::Expr::Lit(literal) => match &literal.lit {
                            syn::Lit::Str(text) => Some(text.value()),
                            _ => None,
                        },
                        _ => None,
                    },
                    _ => None,
                }
            });
            self.facts.imports.push(ImportFacts {
                specifier: attributed.unwrap_or_else(|| format!("self::{}", item.ident)),
                reexport: false,
            });
        }
        syn::visit::visit_item_mod(self, item);
    }

    fn visit_expr_if(&mut self, expression: &'ast ExprIf) {
        self.visit_if_chain(expression, false);
    }

    fn visit_expr(&mut self, expression: &'ast Expr) {
        match expression {
            Expr::While(_) | Expr::ForLoop(_) | Expr::Loop(_) => {
                self.score(ComplexityScorer::enter_branch);
                syn::visit::visit_expr(self, expression);
                self.score(ComplexityScorer::leave);
                return;
            }
            Expr::Match(_) => {
                self.score(ComplexityScorer::enter_switch);
                syn::visit::visit_expr(self, expression);
                self.score(ComplexityScorer::leave);
                return;
            }
            Expr::Binary(binary) => {
                if matches!(binary.op, syn::BinOp::And(_) | syn::BinOp::Or(_)) {
                    // The run continues only through a directly-nested operator of the same
                    // kind, so `a && b && c` scores one cognitive point and `a && b || c`
                    // scores two.
                    // `syn::BinOp` carries no `PartialEq` without the `extra-traits`
                    // feature, and the question here is only whether the operator is the
                    // *same kind*, which the discriminant answers exactly.
                    let operator = std::mem::discriminant(&binary.op);
                    let starts = !matches!(
                        &*binary.left,
                        Expr::Binary(inner) if std::mem::discriminant(&inner.op) == operator
                    );
                    self.score(|scorer| scorer.boolean_operator(starts));
                }
            }
            Expr::Try(_) => {
                // Rust's `?` is both a decision (the expression may stop early) and an exit.
                self.score(ComplexityScorer::decision);
                self.score(ComplexityScorer::exit);
            }
            Expr::Return(_) => self.score(ComplexityScorer::exit),
            Expr::Unsafe(_) => self.facts.rust.unsafe_items += 1,
            Expr::MethodCall(call) => {
                let method = call.method.to_string();
                match method.as_str() {
                    "unwrap" => self.facts.rust.unwrap_calls += 1,
                    "expect" => self.facts.rust.expect_calls += 1,
                    "clone" => self.facts.rust.clone_calls += 1,
                    _ => {}
                }
                self.note_identifier(&method);
            }
            Expr::Path(path) => {
                if let Some(last) = path.path.segments.last() {
                    let name = last.ident.to_string();
                    self.note_identifier(&name);
                }
            }
            Expr::Field(field) => {
                if let syn::Member::Named(name) = &field.member {
                    let name = name.to_string();
                    self.note_identifier(&name);
                }
            }
            Expr::Closure(closure) => {
                self.open_function(
                    "<closure>".to_string(),
                    closure.span(),
                    &closure_signature(),
                    false,
                );
                // The closure's own parameter count is not in a `Signature`, so it is
                // patched in after the fact.
                if let Some(open) = self.open.last_mut() {
                    open.parameters = closure.inputs.len() as u32;
                }
                syn::visit::visit_expr(self, expression);
                self.close_function();
                return;
            }
            _ => {}
        }
        syn::visit::visit_expr(self, expression);
    }

    /// Macro invocations, from wherever they appear.
    ///
    /// Overridden on `Macro` rather than on `Expr::Macro` because a macro invocation
    /// *ending in a semicolon* is a `Stmt::Macro`, not an expression — which is how
    /// `panic!("…");` and `todo!();` are almost always written, so matching only the
    /// expression form would have counted approximately none of them.
    ///
    /// A macro's token stream is not parsed, so nothing inside one is counted: an
    /// `assert_eq!(a.unwrap(), b)` contributes a panic site and no `unwrap`. Parsing
    /// arbitrary macro input is not possible in general — the tokens need not be Rust — and
    /// the alternative of a textual scan would double-count the tokens `syn` already sees.
    fn visit_macro(&mut self, invocation: &'ast syn::Macro) {
        if let Some(name) = invocation.path.get_ident().map(|id| id.to_string()) {
            match name.as_str() {
                // Assertion macros are deliberately **not** counted. In this corpus they
                // live overwhelmingly in test code, where an assertion firing is the test
                // working rather than the program choosing to abort — counting them would
                // make the figure a proxy for how many tests the model wrote, which is
                // already its own metric.
                "panic" | "unreachable" => self.facts.rust.panic_sites += 1,
                "todo" | "unimplemented" => self.facts.rust.todo_macros += 1,
                _ => {}
            }
        }
        syn::visit::visit_macro(self, invocation);
    }

    fn visit_arm(&mut self, arm: &'ast syn::Arm) {
        // A wildcard arm adds no path — control reaches it when nothing else matched — so
        // it is the `default:` of a `match` and scores like one.
        if !matches!(arm.pat, syn::Pat::Wild(_)) {
            self.score(ComplexityScorer::case_arm);
        }
        if arm.guard.is_some() {
            self.score(ComplexityScorer::decision);
        }
        syn::visit::visit_arm(self, arm);
    }
}

/// An empty signature, so a closure can share [`RustVisitor::open_function`] with the three
/// real function forms. Its parameter count is patched in by the caller, which is the only
/// field a closure has that a `Signature` would carry.
fn closure_signature() -> Signature {
    syn::parse_quote!(
        fn __closure()
    )
}

/// The name an item declares, when it declares one.
fn item_name(item: &Item) -> Option<String> {
    Some(match item {
        Item::Fn(inner) => inner.sig.ident.to_string(),
        Item::Struct(inner) => inner.ident.to_string(),
        Item::Enum(inner) => inner.ident.to_string(),
        Item::Trait(inner) => inner.ident.to_string(),
        Item::Type(inner) => inner.ident.to_string(),
        Item::Const(inner) => inner.ident.to_string(),
        Item::Static(inner) => inner.ident.to_string(),
        Item::Mod(inner) => inner.ident.to_string(),
        Item::Union(inner) => inner.ident.to_string(),
        _ => return None,
    })
}

/// A span's 1-based start line and the number of lines it spans.
///
/// `proc-macro2`'s `span-locations` feature is what makes this work at all: without it a
/// span parsed outside a proc-macro invocation reports line 0 for everything, and the whole
/// symbol table would collapse onto one line.
fn span_lines(span: Span) -> (u32, u32) {
    let start = span.start().line.max(1) as u32;
    let end = (span.end().line as u32).max(start);
    (start, end - start + 1)
}

#[cfg(test)]
#[path = "rust.test.rs"]
mod tests;
