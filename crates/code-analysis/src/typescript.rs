//! The TypeScript front end: TypeScript, TSX, JavaScript and JSX through `oxc`.
//!
//! Everything here is **syntactic**. The front end performs no type inference, so there is
//! no implicit-`any` detection and no "is this cast actually unsound". For the question
//! being asked — *did the model annotate its own API?* — that is arguably the better
//! definition, and it makes the two languages symmetric, which is what keeps a
//! cross-language comparison honest.
//!
//! # What is hand-walked and why
//!
//! The bulk of the walk is `oxc`'s generated [`Visit`], driven through `enter_node` so one
//! `match` covers every counter. Three constructs are overridden instead, each because the
//! generated walk cannot see the thing the score depends on:
//!
//! - **`if` chains**, because `else if` must score as a flat rung of a ladder rather than
//!   as an `if` nested inside another (see [`ComplexityScorer::enter_else_if`]).
//! - **Logical expressions**, because "a boolean sequence scores once" needs the *parent*
//!   operator, which a node-at-a-time walk does not carry.
//! - **Functions**, because a function is the unit every complexity figure is attributed
//!   to, and opening one has to nest the enclosing one.
//!
//! # The parse never happens on this thread
//!
//! [`analyze`] is always called through [`caps::parse_guarded`](crate::caps::parse_guarded),
//! which is what makes an unguarded recursive-descent parser safe to point at model-written
//! source. The tree walk is inside the same guarded call as the parse, deliberately: the
//! walk recurses to the same depth the parse did, so running it outside would move the
//! overflow rather than remove it.

use oxc::allocator::Allocator;
use oxc::ast::AstKind;
use oxc::ast::ast::{
    ArrowFunctionExpression, BindingPattern, Declaration, ExportDefaultDeclaration,
    ExportNamedDeclaration, Expression, Function, IfStatement, LogicalExpression, MethodDefinition,
    Program, PropertyKey, Statement, VariableDeclaration,
};
use oxc::ast_visit::{Visit, walk};
use oxc::parser::{ParseOptions, Parser};
use oxc::span::{SourceType, Span};
use oxc::syntax::operator::LogicalOperator;
use oxc::syntax::scope::ScopeFlags;

use crate::facts::{ComplexityScorer, FileFacts, FunctionFacts, ImportFacts, is_test_path};

/// Parse `source` (named by `path`, which selects the dialect) and report what it holds.
///
/// Returns `None` when the parse produced diagnostics: a file that does not parse has no
/// honest function count, and reporting a partial tree's figures as if they were the file's
/// would be worse than recording it as unparsable.
pub fn analyze(path: &str, source: &str) -> Option<FileFacts> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type)
        .with_options(ParseOptions {
            // A produced tree is not always a clean one — a file may be mid-edit when the
            // session ended. Recovering gives figures for the parts that did parse rather
            // than none at all; `panicked` below is the hard failure.
            allow_return_outside_function: true,
            ..ParseOptions::default()
        })
        .parse();
    if parsed.panicked {
        return None;
    }

    let mut visitor = TypeScriptVisitor::new(path, source);
    visitor.count_comments(&parsed.program);
    visitor.visit_program(&parsed.program);
    Some(visitor.finish())
}

/// Byte offset → 1-based line, precomputed once per file.
///
/// A binary search over line starts, rather than counting newlines per span: a file with a
/// thousand functions would otherwise re-scan its own text a thousand times.
struct LineIndex {
    starts: Vec<u32>,
}

impl LineIndex {
    fn new(source: &str) -> Self {
        let mut starts = vec![0];
        for (offset, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                starts.push(offset as u32 + 1);
            }
        }
        Self { starts }
    }

    fn line(&self, offset: u32) -> u32 {
        match self.starts.binary_search(&offset) {
            Ok(index) => index as u32 + 1,
            Err(index) => index as u32,
        }
    }

    fn span_lines(&self, span: Span) -> (u32, u32) {
        let start = self.line(span.start);
        let end = self.line(span.end.saturating_sub(1)).max(start);
        (start, end - start + 1)
    }
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
struct TypeScriptVisitor<'s> {
    lines: LineIndex,
    source: &'s str,
    facts: FileFacts,
    open: Vec<OpenFunction>,
    /// The operator of the logical expression directly above the node being visited, when
    /// there is one. `None` breaks the sequence, which is what makes `a && f(b && c)` two
    /// sequences rather than one.
    parent_logical: Option<LogicalOperator>,
    /// Set while visiting an `export` declaration's subtree, so the functions and classes
    /// inside it are marked exported without a second pass.
    exporting: bool,
    /// The name a `MethodDefinition` or a `const f = () => …` binding is about to give the
    /// function it wraps. Anonymous functions are the norm in this corpus, and a symbol
    /// table full of `<anonymous>` is useless.
    pending_name: Option<String>,
}

impl<'s> TypeScriptVisitor<'s> {
    fn new(path: &str, source: &'s str) -> Self {
        Self {
            lines: LineIndex::new(source),
            source,
            facts: FileFacts {
                is_test: is_test_path(path),
                ..FileFacts::default()
            },
            open: Vec::new(),
            parent_logical: None,
            exporting: false,
            pending_name: None,
        }
    }

    fn finish(self) -> FileFacts {
        self.facts
    }

    /// Apply `score` to the innermost open function, if any. Top-level statements belong to
    /// no function and are deliberately unscored: the unit of complexity here is a
    /// function.
    fn score(&mut self, score: impl FnOnce(&mut ComplexityScorer)) {
        if let Some(open) = self.open.last_mut() {
            score(&mut open.scorer);
        }
    }

    fn note_identifier(&mut self, name: &str) {
        *self.facts.identifiers.entry(name.to_string()).or_insert(0) += 1;
    }

    /// Comments are not AST nodes, so the suppression counter reads the parser's sorted
    /// comment list directly. `@ts-nocheck` and friends are what a model reaches for when
    /// the compiler disagrees with it, which is exactly the signal wanted.
    fn count_comments(&mut self, program: &Program<'_>) {
        const SUPPRESSIONS: [&str; 4] = [
            "@ts-ignore",
            "@ts-expect-error",
            "@ts-nocheck",
            "eslint-disable",
        ];
        for comment in &program.comments {
            let text = comment.span.source_text(self.source);
            if SUPPRESSIONS.iter().any(|marker| text.contains(marker)) {
                self.facts.typescript.suppression_comments += 1;
            }
        }
    }

    /// Open a function, nesting the one that encloses it.
    fn open_function(&mut self, name: String, span: Span, parameters: u32, exported: bool) {
        // A function declared inside another makes the outer one harder to read, so the
        // outer scorer nests even though the inner one is scored separately.
        self.score(ComplexityScorer::enter_nesting);
        let (line, lines) = self.lines.span_lines(span);
        self.open.push(OpenFunction {
            name,
            line,
            lines,
            parameters,
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

    /// The name to give a function that has none of its own.
    fn take_pending_name(&mut self, fallback: &str) -> String {
        self.pending_name
            .take()
            .unwrap_or_else(|| fallback.to_string())
    }

    /// Walk an `if` chain by hand, so `else if` reads as a flat ladder rung.
    fn visit_if_chain(&mut self, statement: &IfStatement<'_>, is_else_if: bool) {
        if is_else_if {
            self.score(ComplexityScorer::enter_else_if);
        } else {
            self.score(ComplexityScorer::enter_branch);
        }
        self.visit_expression(&statement.test);
        self.visit_statement(&statement.consequent);
        self.score(ComplexityScorer::leave);

        match statement.alternate.as_ref() {
            None => {}
            Some(Statement::IfStatement(nested)) => self.visit_if_chain(nested, true),
            Some(other) => {
                // A trailing `else` is a flat cognitive point — the `if` already paid for
                // the branch — and its body nests.
                self.score(ComplexityScorer::else_clause);
                self.score(ComplexityScorer::enter_nesting);
                self.visit_statement(other);
                self.score(ComplexityScorer::leave);
            }
        }
    }

    /// Record an import, and whether it is a wholesale re-export.
    fn note_import(&mut self, specifier: &str, reexport: bool) {
        self.facts.imports.push(ImportFacts {
            specifier: specifier.to_string(),
            reexport,
        });
    }

    /// Names an exported declaration introduces.
    fn export_names(&mut self, declaration: &Declaration<'_>) {
        match declaration {
            Declaration::FunctionDeclaration(function) => {
                if let Some(id) = &function.id {
                    self.facts.exports.push(id.name.to_string());
                }
            }
            Declaration::ClassDeclaration(class) => {
                if let Some(id) = &class.id {
                    self.facts.exports.push(id.name.to_string());
                }
            }
            Declaration::VariableDeclaration(declaration) => self.export_bindings(declaration),
            Declaration::TSTypeAliasDeclaration(alias) => {
                self.facts.exports.push(alias.id.name.to_string());
            }
            Declaration::TSInterfaceDeclaration(interface) => {
                self.facts.exports.push(interface.id.name.to_string());
            }
            Declaration::TSEnumDeclaration(enumeration) => {
                self.facts.exports.push(enumeration.id.name.to_string());
            }
            _ => {}
        }
    }

    fn export_bindings(&mut self, declaration: &VariableDeclaration<'_>) {
        for declarator in &declaration.declarations {
            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                self.facts.exports.push(id.name.to_string());
            }
        }
    }
}

impl<'a> Visit<'a> for TypeScriptVisitor<'_> {
    /// One `match` for every counter that needs nothing but the node itself.
    fn enter_node(&mut self, kind: AstKind<'a>) {
        match kind {
            // ---- complexity: the nesting branches --------------------------------
            AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::CatchClause(_)
            | AstKind::ConditionalExpression(_) => self.score(ComplexityScorer::enter_branch),
            AstKind::SwitchStatement(_) => self.score(ComplexityScorer::enter_switch),
            AstKind::SwitchCase(case) => {
                // `default:` adds no path — control reaches it when nothing else matched.
                if case.test.is_some() {
                    self.score(ComplexityScorer::case_arm);
                }
            }
            // An optional chain is a decision (the expression may stop early) but nothing
            // extra for the reader to hold.
            AstKind::ChainExpression(_) => self.score(ComplexityScorer::decision),
            AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_) => {
                self.score(ComplexityScorer::exit);
            }

            // ---- type discipline -------------------------------------------------
            AstKind::TSAnyKeyword(_) => self.facts.typescript.any_occurrences += 1,
            AstKind::TSUnknownKeyword(_) => self.facts.typescript.unknown_occurrences += 1,
            AstKind::TSNonNullExpression(_) => self.facts.typescript.non_null_assertions += 1,
            AstKind::TSAsExpression(expression) => {
                // `as const` is an assertion of intent, not of type: it narrows a literal
                // rather than overriding the checker, and counting it would punish the
                // one cast that is always safe.
                if !matches!(&expression.type_annotation, oxc::ast::ast::TSType::TSTypeReference(reference)
                    if reference.type_name.get_identifier_reference().is_some_and(|id| id.name == "const"))
                {
                    self.facts.typescript.assertion_casts += 1;
                }
            }
            AstKind::TSTypeAssertion(_) => self.facts.typescript.assertion_casts += 1,
            AstKind::TSInterfaceDeclaration(_)
            | AstKind::TSTypeAliasDeclaration(_)
            | AstKind::TSEnumDeclaration(_) => self.facts.typescript.type_declarations += 1,

            // ---- imports and exports ---------------------------------------------
            AstKind::ImportDeclaration(declaration) => {
                self.note_import(declaration.source.value.as_str(), false);
            }
            AstKind::ExportAllDeclaration(declaration) => {
                self.note_import(declaration.source.value.as_str(), true);
            }
            AstKind::ExportSpecifier(specifier) => {
                self.facts
                    .exports
                    .push(specifier.exported.name().to_string());
            }

            // ---- identifiers, for approximate cross-file references ---------------
            AstKind::IdentifierReference(id) => {
                let name = id.name.to_string();
                self.note_identifier(&name);
            }
            AstKind::IdentifierName(id) => {
                // Static member property names, which is how a namespace import
                // (`import * as ns` then `ns.render`) becomes visible at all.
                let name = id.name.to_string();
                self.note_identifier(&name);
            }

            // ---- tests -----------------------------------------------------------
            AstKind::CallExpression(call) => {
                if let Expression::Identifier(callee) = &call.callee
                    && matches!(callee.name.as_str(), "it" | "test")
                {
                    self.facts.test_functions += 1;
                    self.facts.is_test = true;
                }
            }
            _ => {}
        }
    }

    fn leave_node(&mut self, kind: AstKind<'a>) {
        if matches!(
            kind,
            AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::CatchClause(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::SwitchStatement(_)
        ) {
            self.score(ComplexityScorer::leave);
        }
    }

    // `if` chains are walked by hand; see `visit_if_chain`.
    fn visit_if_statement(&mut self, statement: &IfStatement<'a>) {
        self.visit_if_chain(statement, false);
    }

    fn visit_logical_expression(&mut self, expression: &LogicalExpression<'a>) {
        let starts_sequence = self.parent_logical != Some(expression.operator);
        self.score(|scorer| scorer.boolean_operator(starts_sequence));

        let outer = self.parent_logical;
        for side in [&expression.left, &expression.right] {
            // The run continues only through a directly-nested logical expression. Passing
            // through a call or an index resets it, so `a && f(b && c)` is two sequences.
            self.parent_logical =
                matches!(side, Expression::LogicalExpression(_)).then_some(expression.operator);
            self.visit_expression(side);
        }
        self.parent_logical = outer;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let name = function
            .id
            .as_ref()
            .map(|id| id.name.to_string())
            .unwrap_or_else(|| self.take_pending_name("<anonymous>"));
        let exported = self.exporting;
        let parameters = function.params.items.len() as u32;
        self.record_signature(
            parameters,
            function
                .params
                .items
                .iter()
                .filter(|item| item.type_annotation.is_some())
                .count() as u32,
            function.return_type.is_some(),
            exported,
        );
        self.open_function(name, function.span, parameters, exported);
        walk::walk_function(self, function, flags);
        self.close_function();
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let name = self.take_pending_name("<anonymous>");
        let exported = self.exporting;
        let parameters = arrow.params.items.len() as u32;
        self.record_signature(
            parameters,
            arrow
                .params
                .items
                .iter()
                .filter(|item| item.type_annotation.is_some())
                .count() as u32,
            arrow.return_type.is_some(),
            exported,
        );
        self.open_function(name, arrow.span, parameters, exported);
        walk::walk_arrow_function_expression(self, arrow);
        self.close_function();
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        self.pending_name = match &method.key {
            PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
            PropertyKey::PrivateIdentifier(id) => Some(format!("#{}", id.name)),
            _ => None,
        };
        walk::walk_method_definition(self, method);
    }

    fn visit_variable_declaration(&mut self, declaration: &VariableDeclaration<'a>) {
        for declarator in &declaration.declarations {
            // Name the arrow before descending into it, so `const draw = () => …` reports
            // `draw` rather than `<anonymous>`.
            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                self.pending_name = Some(id.name.to_string());
            }
            self.visit_variable_declarator(declarator);
            self.pending_name = None;
        }
    }

    fn visit_export_named_declaration(&mut self, declaration: &ExportNamedDeclaration<'a>) {
        if let Some(source) = &declaration.source {
            // `export { a } from './b'` is a barrel: the names are referenced here even
            // though nothing in this file uses them.
            self.note_import(source.value.as_str(), true);
        }
        if let Some(inner) = &declaration.declaration {
            self.export_names(inner);
        }
        let outer = std::mem::replace(&mut self.exporting, true);
        walk::walk_export_named_declaration(self, declaration);
        self.exporting = outer;
    }

    fn visit_export_default_declaration(&mut self, declaration: &ExportDefaultDeclaration<'a>) {
        self.facts.exports.push("default".to_string());
        self.pending_name = Some("<default>".to_string());
        let outer = std::mem::replace(&mut self.exporting, true);
        walk::walk_export_default_declaration(self, declaration);
        self.exporting = outer;
    }
}

impl TypeScriptVisitor<'_> {
    /// Fold one function's signature into the annotation ratios.
    fn record_signature(
        &mut self,
        parameters: u32,
        annotated_parameters: u32,
        annotated_return: bool,
        exported: bool,
    ) {
        let typescript = &mut self.facts.typescript;
        typescript.parameters += parameters;
        typescript.annotated_parameters += annotated_parameters;
        typescript.functions += 1;
        typescript.annotated_returns += u32::from(annotated_return);
        if exported {
            typescript.exported_functions += 1;
            typescript.exported_annotated_returns += u32::from(annotated_return);
        }
    }
}

#[cfg(test)]
#[path = "typescript.test.rs"]
mod tests;
