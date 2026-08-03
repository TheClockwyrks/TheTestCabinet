//! TypeScript in, JavaScript out — in process, in microseconds.
//!
//! A model writes TypeScript because that is the language its tools are declared in and the
//! language it writes best; the sandbox's guest evaluates JavaScript. Something has to erase the
//! types, and the only acceptable something is a library call: a `tsc` or `esbuild` subprocess on
//! the turn path would cost more than the whole rest of a program's execution and would drag Node
//! into a run container that has no reason to contain one. `oxc` strips a representative program in
//! ~0.2 ms.
//!
//! # Stripped, not checked — but early errors are still caught here
//!
//! Nothing here type-*checks*. `interface Entry { … }` is erased, `const x: Entry[] = …` becomes
//! `const x = …`, and a call that passes a string where a number was declared runs anyway — it is
//! the SDK's run-time argument validation, not a compiler, that catches it. The system prompt says
//! this in as many words, because a model that believes its types were checked writes different
//! (worse) code than one that knows they were not.
//!
//! What *is* checked is the layer below types: ECMAScript's **early errors** — a `const` declared
//! twice, a `let` shadowing a parameter, a duplicate binding in a destructuring pattern. Those are
//! not type errors and not parse errors; they are scope errors the guest's `new Function` raises at
//! **construction** time, before a single statement runs. Left to the guest they arrive with no
//! location at all, because the shim's line recovery reads a stack frame from *inside* the
//! constructed function and a construction-time throw has none. Real models met exactly that: two
//! concatenated drafts produced `SyntaxError: redeclaration of const root` with no file, no line and
//! no excerpt, and only recovered because the message happened to name the identifier. Checking here
//! costs one extra pass over a tree that is already built (the transformer needs the same scope
//! analysis) and hands the model the same located diagnostic every other transpile failure carries.
//!
//! # Statements that cannot run
//!
//! A program's top level is a function body, so a top-level `return` ends it: everything after it is
//! dead. That is legal JavaScript, so nothing refuses it — but a model that pasted a second draft
//! after the first one's `return` would otherwise be told "your program ran to completion" about a
//! reply whose second half never executed. [`Transpiled::unreachable`] is what makes that visible,
//! and disclosure is the whole of the fix: the program still runs exactly as written.
//!
//! # Why some perfectly valid TypeScript is refused here
//!
//! A program is evaluated as the *body of a function*, against a scope of injected tool functions.
//! Module syntax has no meaning in that setting, and finding that out inside the guest is far worse
//! than being told here: a dynamic `import()` is (measured) an opaque wasm trap at
//! `path_filestat_get`, and top-level `await` yields a bare `SyntaxError` with no explanation of
//! why the sandbox has no promises. Refusing them here costs no engine work at all and hands the
//! model a sentence it can act on.
//!
//! # The parser recurses, so the input is bounded and the stack is deep
//!
//! `oxc`'s parser is recursive descent with **no depth guard**: one stack frame per level of
//! grammatical nesting. A stack overflow is not a catchable panic — it is `fatal runtime error:
//! stack overflow` and `SIGABRT`, which would take down the whole gg process (the run, its subagent
//! tree, its worktrees) over one degenerate response. A model that repeats a bracket in a
//! generation loop produces exactly that shape, so the program text is untrusted input and is
//! bounded before it is parsed.
//!
//! Three measures together, each load-bearing, all measured on this machine against `oxc` 0.141:
//!
//! 1. [`MAX_PROGRAM_BYTES`] bounds how many levels the source can possibly ask for at all — the
//!    parser recurses at most once per token, and a token is at least one byte.
//! 2. [`MAX_NESTING_DEPTH`] bounds the **bracket** shapes, which are both the ones a degenerate
//!    generation actually produces and the most expensive per level (~3.4 KiB of stack for each
//!    `{a:`, against ~1.3 KiB for each `!`). Without it, 64 KiB of `(` would ask for 64,000 levels.
//! 3. [`PARSER_STACK_BYTES`] gives the parse a stack sized against what 1 and 2 still allow — the
//!    bracket-free shapes, whose worst measured appetite is a chain of postfix `!` at ~1.2 KiB of
//!    stack per byte of source.
//!
//! The three leave every shape measured at better than 3× margin, in the `dev` profile whose frames
//! are the fatter ones. The alternative — growing the stack alone — is not a fix: any fixed stack
//! has a threshold, and the bound has to be on the input because the input is what is untrusted.

use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{ModuleDeclaration, Program, Statement};
use oxc::codegen::Codegen;
use oxc::diagnostics::{LabeledSpan, OxcDiagnostic};
use oxc::parser::{ParseOptions, Parser, ParserReturn};
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};
use oxc::transformer::{TransformOptions, Transformer};

/// The virtual path diagnostics are labelled with. Never read from disk — a program has no file.
const VIRTUAL_SOURCE_PATH: &str = "program.ts";

/// The most bytes of TypeScript the sandbox will parse.
///
/// 64 KiB is around sixteen hundred lines — far more than a model emits in one response, and close
/// to what most providers' output ceilings let it emit at all. A program is an *orchestration over
/// the tools*, not a place to carry a large document inline, and the message a program over this
/// size gets says so.
///
/// The cap is not a matter of taste, though: it is what bounds how deeply the parser can be made to
/// recurse. Recursive descent takes at most one level per token and a token is at least one byte,
/// so a source of *n* bytes can ask for at most *n* levels — which is what makes
/// [`PARSER_STACK_BYTES`] sizeable at all.
const MAX_PROGRAM_BYTES: usize = 65_536;

/// The deepest `(`, `[` or `{` nesting the sandbox will parse.
///
/// Real programs nest fewer than ten levels; 200 is twenty times that and still five times under
/// the shallowest measured overflow. Measured on a 2 MiB stack (what `spawn_blocking` gives the
/// sandbox), `oxc` 0.141 aborts at **985** levels of `{a:` , **1,005** of `` `${ ``, **1,131** of
/// `(` and **3,684** of `{` — the bracket shapes are both the cheapest to write and the most
/// expensive to parse, at up to ~2.1 KiB of stack each.
///
/// They are also the shape a degenerate generation actually produces: `return ((((…1…))));` is
/// what a model emits when a repetition loop runs away, and `[[[[…]]]]` is one bracket-repetition
/// bug from the same place.
const MAX_NESTING_DEPTH: u32 = 200;

/// The stack `oxc` is given to parse, transform and generate on — 128× what the sandbox's own
/// blocking thread has.
///
/// With the program capped at [`MAX_PROGRAM_BYTES`] and its bracket nesting at
/// [`MAX_NESTING_DEPTH`], what remains are the bracket-*free* recursions the nesting scan cannot
/// see at all: chains of postfix `!`, prefix `!`, `.b`, `?:`, unary `-`, `as any`, `<any>`, `new`.
/// The hungriest of those measured is a chain of postfix non-null assertions, at **1,261 bytes of
/// stack per byte of source**; a program of 64 KiB of them therefore needs ~83 MiB, and the bracket
/// nesting the cap still permits adds ~0.7 MiB on top. 256 MiB leaves better than 3× margin over
/// every shape measured.
///
/// **That figure is the `dev` profile's**, deliberately: an unoptimised frame is up to ~16× fatter
/// than an optimised one (the same chain costs 80 bytes per source byte in `release`), the test
/// suite runs unoptimised, and the margin has to hold for the build a developer runs as well as the
/// one a run container gets. `the_hungriest_programs_the_caps_admit_still_transpile` is what keeps
/// this honest: it parses each worst-case shape at the size cap, so a drift between the caps and
/// this number fails the suite rather than a run.
///
/// It costs a thread: ~48 µs to spawn and join — flat in the stack size, because the stack is
/// *reserved* rather than committed and untouched pages never fault in — against a ~226 µs
/// type-strip and a turn measured in seconds.
const PARSER_STACK_BYTES: usize = 256 * 1024 * 1024;

/// A program that type-stripped cleanly: the JavaScript to run, and what the strip observed about
/// the program on the way past.
///
/// The observation rides with the JavaScript rather than being recovered later because it is a fact
/// about the **model's source**, in the model's own coordinates, and the only place both the tree
/// and that source exist together is inside the strip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transpiled {
    /// The JavaScript the guest evaluates.
    pub js: String,
    /// Top-level statements the program wrote that cannot execute, when it wrote any. See
    /// [`UnreachableTail`].
    pub unreachable: Option<UnreachableTail>,
}

/// Top-level statements a program wrote **after** a statement that ends it — code that provably
/// never runs.
///
/// This is not an error and nothing is refused: dead code after a `return` is legal JavaScript, and
/// a program is entitled to it. It exists because of what it is a symptom of. A model that drafts
/// two programs and pastes the second after the first produces exactly this shape, and without a
/// word about it gg reports "your program ran to completion" over a reply whose second half — the
/// half that wrote the deliverable and ended the run — never executed. Round 1 proved that silent
/// discard is the one failure a model cannot recover from, so gg counts what did not run and says
/// so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreachableTail {
    /// How many top-level statements followed it that could have done something. Hoisted `function`
    /// declarations and erased type-only declarations are excluded: the first are in scope before
    /// the first statement runs, and the second do not exist at run time at all, so calling either
    /// "did not run" would be false.
    pub statements: usize,
    /// The 1-based line of the first such statement, in the **program's** coordinates.
    pub line: usize,
    /// The first such statement's own source text, trimmed and capped at [`MAX_EXCERPT_CHARS`] —
    /// what lets a model recognise the half of its reply that never ran without counting lines.
    pub excerpt: String,
}

/// Type-strip `src` from TypeScript into the JavaScript the sandbox's guest evaluates.
///
/// Parsed with `allow_return_outside_function` because the guest evaluates a program as the BODY of
/// `new Function(...names, source)`, whose body legally contains a top-level `return`. Parsed as an
/// ordinary module that `return` is a syntax error and a perfectly good program dies before it
/// runs; this aligns the host's parse with the guest's execution semantics.
///
/// [`TransformOptions::default`] strips types with no `env` target, so nothing is downlevelled: the
/// target is a modern embedded engine, and downlevelling would only cost time and bloat what that
/// engine has to parse. Plain JavaScript therefore passes through essentially unchanged, so a model
/// that ignores the word "TypeScript" in the prompt still runs.
///
/// The two size guards run first and cost one pass over the text: a program that is too long or too
/// deeply nested is refused with an explanation, because the parser it would otherwise be handed to
/// recurses without a depth guard (see the [module docs](self)).
pub fn transpile_ts(src: &str) -> Result<Transpiled, TranspileError> {
    if src.len() > MAX_PROGRAM_BYTES {
        return Err(TranspileError::Unsupported(oversized_message(src.len())));
    }
    let deepest = nesting_depth(src);
    if deepest > MAX_NESTING_DEPTH {
        return Err(TranspileError::Unsupported(over_nested_message(deepest)));
    }
    strip_types_on_a_deep_stack(src)
}

/// Run `work` on a thread with [`PARSER_STACK_BYTES`] of stack, and hand back exactly what it
/// returned.
///
/// The whole pipeline runs there, not only the parse: the transformer and the code generator walk
/// the same tree the parser built, so they recurse to the same depth. It is generic over the work
/// because the [module](self::modules) pass runs a second parse over the same untrusted source and
/// needs exactly the same stack.
///
/// Two failures of the thread itself, and why each is handled the way it is. A thread that cannot be
/// *started* is a machine out of threads or address space, which `std::thread::spawn` itself panics
/// on — and a panic here is contained, arriving at the loop's `spawn_blocking` join as a failed
/// turn, which is precisely the outcome a stack overflow does *not* give us. And a panic *inside*
/// `oxc` is re-raised on this thread rather than translated into a model-facing error, so the extra
/// thread changes nothing about how a defect in the transpiler surfaces.
fn on_a_deep_stack<T: Send>(work: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        let parser = std::thread::Builder::new()
            .stack_size(PARSER_STACK_BYTES)
            .spawn_scoped(scope, work)
            .expect("the sandbox's parser thread can be started");
        match parser.join() {
            Ok(produced) => produced,
            Err(panic) => std::panic::resume_unwind(panic),
        }
    })
}

/// [`strip_types`] on the deep stack — the program path's whole pipeline.
fn strip_types_on_a_deep_stack(src: &str) -> Result<Transpiled, TranspileError> {
    on_a_deep_stack(|| strip_types(src))
}

/// The `oxc` pipeline itself: parse, reject what the sandbox cannot run, strip the types, print.
///
/// Always called on the deep stack [`strip_types_on_a_deep_stack`] provides; it is a separate
/// function only so the thread mechanics and the compiler pipeline are each readable on their own.
fn strip_types(src: &str) -> Result<Transpiled, TranspileError> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, src, SourceType::ts())
        .with_options(ParseOptions {
            allow_return_outside_function: true,
            ..ParseOptions::default()
        })
        .parse();

    if !parsed.diagnostics.is_empty() {
        return Err(TranspileError::Parse(located(src, &parsed.diagnostics)));
    }
    if let Some(unsupported) = unsupported_feature(&parsed) {
        return Err(TranspileError::Unsupported(unsupported.to_string()));
    }

    let mut program = parsed.program;
    // Observed while the tree still spans the MODEL's source: after the transform the spans point
    // into a program the model never wrote.
    let unreachable = unreachable_tail(src, &program);
    // The transformer needs the program's resolved scopes to rename what it must; building them
    // here (rather than letting the transformer do it) is how oxc's API is shaped — and asking the
    // same pass to check ECMAScript's early errors costs one flag, because the scope analysis that
    // finds a duplicate binding is the analysis it is doing anyway.
    let analysed = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .build(&program);
    if !analysed.diagnostics.is_empty() {
        return Err(TranspileError::EarlyError(located(
            src,
            &analysed.diagnostics,
        )));
    }
    let scoping = analysed.semantic.into_scoping();
    let transformed = Transformer::new(
        &allocator,
        Path::new(VIRTUAL_SOURCE_PATH),
        &TransformOptions::default(),
    )
    .build_with_scoping(scoping, &mut program);
    if !transformed.diagnostics.is_empty() {
        return Err(TranspileError::Transform(located(
            src,
            &transformed.diagnostics,
        )));
    }

    Ok(Transpiled {
        js: Codegen::new().build(&program).code,
        unreachable,
    })
}

/// The top-level statements `program` wrote after a statement that ends it, if it wrote any.
///
/// # What counts as ending the program
///
/// One shape: a top-level [`ReturnStatement`](Statement::ReturnStatement). It has to be
/// **unconditional** and a direct child of the program body — a `return` inside an `if`, a loop or a
/// block is a conditional exit and says nothing about what follows it.
///
/// A top-level [`finish`](super::FINISH_FUNCTION) call is deliberately **not** one, and used to be. It sets
/// a flag in the agent's context and returns like any other call, so the statements after it run
/// exactly as written; calling them unreachable would be false, and telling a model its `finish`
/// killed the rest of its program would teach it a rule this sandbox no longer has.
///
/// # What counts as not running
///
/// Everything after it **except** hoisted `function` declarations (in scope before the first
/// statement runs, so they are not dead), erased type-only declarations (`interface`, `type`, which
/// do not exist at run time at all), and empty statements. A `class` is *not* excluded: class
/// declarations are not hoisted into existence, so one after a `return` really is unreachable.
fn unreachable_tail(src: &str, program: &Program<'_>) -> Option<UnreachableTail> {
    let index = program
        .body
        .iter()
        .position(|statement| matches!(statement, Statement::ReturnStatement(_)))?;
    let mut dead = program.body[index + 1..]
        .iter()
        .filter(|statement| would_have_run(statement));
    let first = dead.next()?;
    let statements = 1 + dead.count();
    let span = first.span();
    let (line, _, _) = line_column(src, span.start as usize);
    Some(UnreachableTail {
        statements,
        line,
        excerpt: excerpt(&src[span.start as usize..(span.end as usize).min(src.len())]),
    })
}

/// Whether a statement placed after a terminator would have done something had it been reached.
///
/// `false` for the three kinds that are not dead even where they sit: a hoisted `function`
/// declaration (bound before the first statement runs), a type-only declaration (erased entirely by
/// the strip, so it never existed at run time), and an empty statement (a stray `;`, which a model
/// that ends its program with `return x;;` would otherwise be told "did not run").
fn would_have_run(statement: &Statement<'_>) -> bool {
    !matches!(
        statement,
        Statement::FunctionDeclaration(_)
            | Statement::EmptyStatement(_)
            | Statement::TSInterfaceDeclaration(_)
            | Statement::TSTypeAliasDeclaration(_)
    )
}

/// Why a program could not be turned into runnable JavaScript.
///
/// Every variant is **recoverable and model-facing** — the model wrote something it can fix, is
/// told exactly what, and writes another program next turn. None of them is a run-ending failure,
/// and none of them costs any engine work: a program that does not compile never reaches the
/// component at all.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TranspileError {
    /// The program is not valid TypeScript. Carries every parser diagnostic, [located in the
    /// program's own coordinates](located) and joined, so the model sees the same located list a
    /// compiler would show it rather than only the first thing that went wrong — and, critically,
    /// sees *where*.
    #[error("{0}")]
    Parse(String),
    /// The program parses, but breaks one of ECMAScript's **early errors**: a `const` declared
    /// twice, a `let` shadowing a parameter, a duplicate name in a destructuring pattern. Carries
    /// the same [located](located) rendering as a parse error.
    ///
    /// Its own variant rather than folded into [`Parse`](Self::Parse) because it is a different
    /// mistake with a different cause: a parse error is a typo, an early error is almost always two
    /// programs in one reply, and telling the two apart in the telemetry is how that shows up as a
    /// rate rather than as anecdote. Left to the guest it would arrive at `new Function` with no
    /// location at all (see the [module docs](self)), which is the failure this variant exists to
    /// remove.
    #[error("{0}")]
    EarlyError(String),
    /// The types could not be stripped. Distinct from [`Parse`](Self::Parse) because it is not the
    /// model's syntax that failed but the transform over it — a distinction worth keeping when one
    /// of the two starts happening and the other does not.
    #[error("{0}")]
    Transform(String),
    /// The program asks for something the sandbox will not run it with, and is refused with an
    /// explanation of what to write instead.
    ///
    /// Two families share this variant because they share that shape. One is a **feature with no
    /// implementation** — `import`, `export`, a dynamic `import()`, a top-level `await`. The other
    /// is a program **past the parser's bounds**: longer than [`MAX_PROGRAM_BYTES`] or nested
    /// deeper than [`MAX_NESTING_DEPTH`], where refusing it is what keeps an unguarded recursive
    /// descent from overflowing the stack (see the [module docs](self)). In both cases the program
    /// is syntactically fine and the model is told precisely what to change.
    #[error("{0}")]
    Unsupported(String),
}

/// The guidance for a program the sandbox will not even parse because of its size.
///
/// It names the number rather than saying "too long", and it says what to do instead, because the
/// model that hits this is usually inlining a document it should be writing out in pieces.
fn oversized_message(bytes: usize) -> String {
    format!(
        "Your program is {bytes} bytes long, and the sandbox parses at most {MAX_PROGRAM_BYTES}. A \
         program orchestrates the tools; it is not the place to carry a large document inline. \
         Write large content out in pieces, or split the work across turns."
    )
}

/// The guidance for a program nested deeper than the parser is given room for.
///
/// It says *why* — a bounded stack — because "too deeply nested" with no reason invites a model to
/// try the same program again, and it says what this almost always is, because a program at this
/// depth is virtually never one somebody meant to write.
fn over_nested_message(deepest: u32) -> String {
    format!(
        "Your program nests brackets {deepest} levels deep, and the sandbox parses at most \
         {MAX_NESTING_DEPTH}. It parses on a bounded stack, so a program this deeply nested is \
         refused rather than risking the run. Flatten it — nesting this deep is almost always a \
         repeated bracket rather than something you meant to write."
    )
}

/// The deepest `(`/`[`/`{` nesting anywhere in `src`, from one linear pass over its bytes.
///
/// Deliberately **context-free**: it counts brackets inside string literals, template literals,
/// regular expressions and comments as though they were code. Lexing those properly would need the
/// very parser this guard protects — and worse, the one genuinely ambiguous case (`/` as division
/// or as the start of a regex) can only be resolved with parser context, so a "smart" scanner that
/// guessed wrong would *under*-count and let the overflow through. Counting everything can only
/// over-count, which at a cap twenty times what real code nests means a false refusal is a
/// theoretical concern with a message that tells the model exactly what to do.
///
/// The counter saturates at zero on a closing bracket so that unbalanced closers (a string like
/// `")))"`) cannot push it negative and mask real nesting that follows.
///
/// Scanning bytes rather than characters is safe: the six ASCII brackets never occur inside a
/// multi-byte UTF-8 sequence.
fn nesting_depth(src: &str) -> u32 {
    let mut depth: u32 = 0;
    let mut deepest: u32 = 0;
    for byte in src.bytes() {
        match byte {
            b'(' | b'[' | b'{' => {
                depth = depth.saturating_add(1);
                deepest = deepest.max(depth);
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

/// The guidance for a program that used `import` or `export` as a statement. The keyword is named
/// because the two are different mistakes with the same answer, and a model correcting the wrong
/// one wastes a turn.
fn module_syntax_message(keyword: &str) -> String {
    format!(
        "Your program used `{keyword}`. The sandbox has no module system: every tool you may call \
         is already in scope as a function, and there is nothing else to import. Remove the \
         import and call the tools directly."
    )
}

/// The guidance for a dynamic `import()`, which the guest would otherwise turn into an opaque trap.
const DYNAMIC_IMPORT_MESSAGE: &str = "Your program used a dynamic `import()`. The sandbox has no module system and no loader — the \
     tools already in scope are everything your program can reach.";

/// The guidance for a top-level `await`, which is what a model reaches for when it assumes the
/// tools are asynchronous.
const TOP_LEVEL_AWAIT_MESSAGE: &str = "Your program used top-level `await`. The sandbox is synchronous: every tool function returns \
     its value directly. Remove `await` (and any `async`).";

/// The unsupported feature this program used, if any, as the sentence to hand the model.
///
/// Two sources are combined because neither alone is sufficient. A **flat scan of the top-level
/// statements** names the exact keyword (`import` vs `export`) but sees neither of the other two
/// cases. The parser's **module record**, populated during the parse at no extra cost, counts
/// dynamic imports and reports whether module syntax was used at all — and (measured) it is that
/// second flag, not any await-specific signal, which a top-level `await` sets, because a top-level
/// `await` is what makes a source a module. So: a statement hit names its keyword; otherwise a
/// dynamic import; otherwise module syntax with no module statement in sight, which leaves only
/// top-level `await`.
fn unsupported_feature(parsed: &ParserReturn<'_>) -> Option<String> {
    if let Some(keyword) = module_keyword(&parsed.program) {
        return Some(module_syntax_message(keyword));
    }
    if !parsed.module_record.dynamic_imports.is_empty() {
        return Some(DYNAMIC_IMPORT_MESSAGE.to_string());
    }
    if parsed.module_record.has_module_syntax {
        return Some(TOP_LEVEL_AWAIT_MESSAGE.to_string());
    }
    None
}

/// The module keyword a top-level statement used, if one did.
///
/// A flat scan of `program.body` is enough — module declarations are only legal at the top level,
/// so there is nothing for a visitor to find deeper — and it is what lets the message name the
/// keyword the model actually wrote.
fn module_keyword(program: &Program<'_>) -> Option<&'static str> {
    program.body.iter().find_map(|statement| {
        statement
            .as_module_declaration()
            .map(|declaration| match declaration {
                ModuleDeclaration::ImportDeclaration(_) => "import",
                ModuleDeclaration::ExportAllDeclaration(_)
                | ModuleDeclaration::ExportDefaultDeclaration(_)
                | ModuleDeclaration::ExportNamedDeclaration(_)
                | ModuleDeclaration::TSExportAssignment(_)
                | ModuleDeclaration::TSNamespaceExportDeclaration(_) => "export",
            })
    })
}

/// Every diagnostic, **located in the program's own coordinates** and joined.
///
/// All of them are kept rather than only the first: a model that fixes one syntax error and is then
/// told about the next has spent two turns on one program.
///
/// # Why not `Display`
///
/// [`OxcDiagnostic`]'s `Display` prints its `message` and nothing else, so the obvious rendering
/// hands a model `Expected a semicolon or an implicit semicolon after a statement, but found none`
/// — a true sentence about a program it cannot find the place in. Real models met exactly that: one
/// glued prose to its closing fence, the extractor read the prose as program text, and the model
/// received the byte-identical unlocated diagnostic twice and re-emitted the same mistake, because
/// nothing in the message pointed at the line that was not its code. The span the parser already
/// attached is the whole fix: the line, the column, and the source line itself turn an
/// uninterpretable sentence into one whose cause is visible in it.
fn located(src: &str, diagnostics: &[OxcDiagnostic]) -> String {
    diagnostics
        .iter()
        .map(|diagnostic| locate(src, diagnostic))
        .collect::<Vec<_>>()
        .join("; ")
}

/// One diagnostic as `line L, column C: message | the source line`, or bare when it carries no
/// span at all — with every further span it labelled appended as `; and at line L, column C (note)
/// | the source line`.
///
/// The excerpt is what makes the location *checkable* by a model that cannot see line numbers in
/// its own message: quoting the offending line lets it recognise text it did not write (a closing
/// fence, a paragraph of prose) without counting lines in a block it emitted from memory.
///
/// The extra spans matter for exactly one diagnostic, and it is the one that cost a real session:
/// a redeclaration labels **both** the first binding and the second, and a model shown only the
/// first is being pointed at the half of its reply that is correct.
fn locate(src: &str, diagnostic: &OxcDiagnostic) -> String {
    let message = diagnostic.message.as_ref();
    let mut labels = ordered_labels(diagnostic);
    let Some(first) = labels.next() else {
        return message.to_string();
    };
    let mut rendered = format!("{}: {message}", place(src, first));
    if let Some(text) = excerpt_at(src, first) {
        rendered.push_str(&format!(" | {text}"));
    }
    // Every remaining label, each with the sentence `oxc` attached to it. A redeclaration — the
    // early error this pipeline exists to catch — carries exactly two: where the name was first
    // bound, and where it could not be bound again. Rendering only the first would point the model
    // at the half of its reply that is correct.
    for label in labels {
        rendered.push_str(&format!("; and at {}", place(src, label)));
        if let Some(note) = label.label() {
            rendered.push_str(&format!(" ({note})"));
        }
        if let Some(text) = excerpt_at(src, label) {
            rendered.push_str(&format!(" | {text}"));
        }
    }
    rendered
}

/// One label's position as `line L, column C`.
fn place(src: &str, label: &LabeledSpan) -> String {
    let (line, column, _) = line_column(src, label.offset() as usize);
    format!("line {line}, column {column}")
}

/// The source line one label falls on, [capped](excerpt) — or `None` for a blank line, which
/// [`locate`] renders as no excerpt at all rather than as a dangling separator.
fn excerpt_at(src: &str, label: &LabeledSpan) -> Option<String> {
    let (_, _, text) = line_column(src, label.offset() as usize);
    let text = excerpt(text);
    (!text.is_empty()).then_some(text)
}

/// A diagnostic's labels, the one it marked **primary** first and the rest in source order.
///
/// `oxc` attaches spans with `with_label`, which does not mark anything primary, so for a parse
/// error this is simply "the labels as given". The primary check is there because a diagnostic that
/// *does* distinguish one label means the one it distinguished, and that is the location the
/// message belongs beside.
fn ordered_labels(diagnostic: &OxcDiagnostic) -> impl Iterator<Item = &LabeledSpan> {
    let primary = diagnostic.labels.iter().position(LabeledSpan::primary);
    primary
        .and_then(|index| diagnostic.labels.get(index))
        .into_iter()
        .chain(
            diagnostic
                .labels
                .iter()
                .enumerate()
                .filter(move |(index, _)| Some(*index) != primary)
                .map(|(_, label)| label),
        )
}

/// The 1-based line and column of byte `offset` in `src`, and the whole line it falls on.
///
/// Both counts are 1-based because that is what every editor, every compiler and every model's
/// training data means by "line 5, column 1". The column counts *characters* rather than bytes, for
/// the same reason: a program with an emoji in a string literal would otherwise be given a column
/// that lands nowhere a human or a model would look.
///
/// An offset past the end of the source, or one landing inside a multi-byte character, is walked
/// back to the nearest boundary rather than panicking: this is a diagnostic path, and a slicing
/// panic here would turn a recoverable model mistake into a lost turn.
fn line_column(src: &str, offset: usize) -> (usize, usize, &str) {
    let mut offset = offset.min(src.len());
    while !src.is_char_boundary(offset) {
        offset -= 1;
    }
    let start = src[..offset].rfind('\n').map_or(0, |index| index + 1);
    let line = src[..start].matches('\n').count() + 1;
    let column = src[start..offset].chars().count() + 1;
    let end = src[start..]
        .find('\n')
        .map_or(src.len(), |index| start + index);
    (line, column, &src[start..end])
}

/// How much of the offending source line the diagnostic quotes.
///
/// A program is one line more often than it should be — a model that minifies its output, or one
/// whose whole program is a single `return` of a large literal — and a diagnostic that pasted 64 KiB
/// back into the context window would cost far more than it explains.
const MAX_EXCERPT_CHARS: usize = 120;

/// The source line as the diagnostic quotes it: trimmed, and capped at [`MAX_EXCERPT_CHARS`].
///
/// A blank line yields an empty string, which [`locate`] renders as no excerpt at all rather than
/// as a dangling separator.
fn excerpt(line: &str) -> String {
    let line = line.trim();
    if line.chars().count() <= MAX_EXCERPT_CHARS {
        return line.to_string();
    }
    let kept: String = line.chars().take(MAX_EXCERPT_CHARS).collect();
    format!("{kept}…")
}

#[path = "transpile.modules.rs"]
mod modules;

pub use modules::transpile_module;

#[cfg(test)]
#[path = "transpile.test.rs"]
mod tests;
