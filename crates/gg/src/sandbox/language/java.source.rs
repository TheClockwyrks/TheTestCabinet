//! **What gg puts around a model's Java before javac sees it: nothing.**
//!
//! A program on this arm is a whole Java compilation unit — the `import` lines the model wrote and
//! the `public static void main(String[])` it declared, in a class it declared. gg writes no
//! prologue, no epilogue, no entry point and no import into that file, so `javac` reads the bytes
//! the model sent and every diagnostic, every stack frame and every location is already in the
//! model's own coordinates. There is nothing here to subtract.
//!
//! # The one convention, and what enforces it
//!
//! The file is [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) and the class gg's generated entry class calls is
//! [`PROGRAM_CLASS`]. Java has no way to ask "whatever class this file declares": a compilation unit
//! is named by its own public type and a caller names the type it calls. So a program declares
//! `Program` with a `main`, exactly as a Rust program declares `fn main` — and the two ways of
//! getting it wrong are both **javac's own located diagnostics** rather than gg's opinion:
//!
//! * a `public class Something` in `Program.java` is `class Something is public, should be declared
//!   in a file named Something.java`, at the model's own line;
//! * a class named anything else, or one with no `main`, leaves gg's entry class unable to resolve
//!   `Program.main`, which [`compile`](super::compile) turns into a refusal that quotes the
//!   convention back — a shape refusal shown to the model rather than reported as a toolchain
//!   failure.
//!
//! # What is left in this file
//!
//! The names a compile is written under, and the **code module** wrapper. A code module is
//! [outside the authorship rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/): its
//! author writes a class *body*, because a namespace of functions is what `lib.<key>` binds and a
//! Java function is a method of a class. [`wrap_module`] is what puts that body in a `public` class
//! of package [`MODULE_PACKAGE`], and it adds **no line at all** — the package declaration and the
//! class header share the author's own first line, so the module's line *n* is line *n* of the file
//! and no diagnostic is moved by anything.
//!
//! What that class is *reached* by is nowhere in this file, because it is nothing gg writes: the
//! module is compiled on its own and its classes are handed to the program's compile as a
//! **classpath entry**, which is how this arm's own SDK jar reaches a program. The program writes
//! `lib.csvTools.parse(…)` or its own `import lib.csvTools;`, and gg writes neither.
//!
//! # Why a lexer rather than a regular expression
//!
//! Because the input is untrusted text a model wrote, and `import ` at the start of a line inside a
//! text block is not an import. [`Lexer`] is the smallest thing that can tell code from a string,
//! a character literal, a comment and a text block — the same reading the
//! [healing dialect](super::healing) makes of a reply, arrived at independently because that one
//! runs on text that is not yet known to be a program while this one runs on text about to be
//! handed to javac.
//!
//! Everything it does is a **byte** comparison rather than a slice of the source, and that is not a
//! style: the scan walks one byte at a time, so `&source[at..]` panics on any index that is not a
//! character boundary. A single `é` in a string, a comment or an identifier would have taken the
//! turn down with a slice index error rather than reaching javac. Every delimiter it looks for is
//! ASCII, and an ASCII byte never appears inside a multi-byte UTF-8 sequence, so byte comparisons
//! find exactly what string comparisons would.

use super::super::{ModuleExport, ModuleExportKind, PrepareError, PrepareFailure};

/// The class a program declares, and the one gg's entry class calls `main` on.
pub(super) const PROGRAM_CLASS: &str = "Program";

/// The package every code module is compiled into, and the first segment of the name a program
/// writes to reach one: `lib.csvTools.parse(…)`.
///
/// A package rather than a class holding them all, because a package is what a **classpath entry**
/// can carry. Each module is compiled on its own into a directory of class files, and that directory
/// is handed to the program's compile the way this arm's SDK jar is: it declares no name, and the
/// program reaches the class in full or under an `import` line it wrote itself.
///
/// The class in it is named by the module's own binding key, so `lib.csvTools` is the whole of what
/// a program has to know and the key it was given is the name it types.
pub(super) const MODULE_PACKAGE: &str = "lib";

/// The class a code module is **checked** under at the read that binds it, before any program has
/// named a key for it.
pub(super) const MODULE_CHECK_CLASS: &str = "Module";

/// A code module's body, wrapped into a compilation unit javac will read, and the names its
/// namespace offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Wrapped {
    /// The whole `.java` file.
    pub source: String,
    /// What the module's namespace offers, in source order.
    pub exports: Vec<ModuleExport>,
}

/// Wrap a code [skill](crate::skills)'s or [memory](crate::memories)'s **module** — a class body —
/// into a compilation unit under `class`, and say what its namespace will offer.
///
/// Its `public static` methods become the namespace and everything else is the module's own
/// business, which is the visibility rule a Java author already writes.
///
/// **Nothing gg writes here takes a line.** The package declaration and the imports the author wrote
/// are lifted to the front of the file — each import blanked where it stood — and the class header
/// goes on the front of the author's own first line, so the file has exactly as many lines as the
/// module did and every one of them is where its author put it. There is no offset for any
/// diagnostic to be moved back by, which is what
/// [rule D11](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) asks of a location.
///
/// The class is `public` because a program in another package reaches it, and `final` because
/// nothing extends it: what a program is handed is a directory of compiled classes on its own
/// classpath, and a name it writes itself.
pub(super) fn wrap_module(source: &str, class: &str) -> Result<Wrapped, PrepareFailure> {
    let (body, imports) = hoist(source)?;
    refuse_wrapper_name(&body, class)?;
    let exports = exports(&body);
    if exports.is_empty() {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            "this module offers nothing: gg binds a code module's `public static` methods at \
             `lib.<key>`, and there are none. Declare at least one, as \
             `public static String greet(String who) { … }`."
                .to_string(),
        )));
    }
    let mut header = format!("package {MODULE_PACKAGE}; ");
    for line in &imports {
        header.push_str(line);
        header.push(' ');
    }
    header.push_str(&format!("public final class {class} {{ "));
    Ok(Wrapped {
        source: format!("{header}{}}}\n", terminated(&body)),
        exports,
    })
}

/// Refuse a module body that writes the name of the class gg wraps it in, at the author's own line.
///
/// # Why this is a refusal and not a curiosity
///
/// A module body is compiled **twice under two different class names**: under
/// [`MODULE_CHECK_CLASS`] at the read that binds it, before any key exists, and under its **binding
/// key** in every program that uses it. Every declaration Java has means the same thing
/// under both names except one — a *constructor*, which is a method with no return type whose name
/// is the class's. So `Module() { }` is a constructor at the read and
/// `invalid method declaration; return type required` in a program, and it was the read that said
/// yes. Measured: the module then took down every program the agent wrote from then on, which is
/// exactly the state [`compile_module`](super::compile::compile_module) exists to prevent.
///
/// The check is the class's simple name **anywhere in code**, not the constructor shape alone,
/// because an expression naming the class (`Module.helper()`) diverges the same way and for the
/// same reason. A module's author cannot know the name gg gives the class, so a body that writes it
/// is a body that meant something else.
fn refuse_wrapper_name(body: &str, class: &str) -> Result<(), PrepareFailure> {
    let code = Lexer::new(body).code_mask();
    let bytes = body.as_bytes();
    let mut start = 0usize;
    for (number, line) in body.split_inclusive('\n').enumerate() {
        for (offset, _) in line.match_indices(class) {
            let at = start + offset;
            let before = at.checked_sub(1).map(|byte| bytes[byte]);
            let after = bytes.get(at + class.len()).copied();
            // A whole identifier, and not the last segment of a qualified name: `a.b.Module` names
            // somebody else's type under either wrapper and diverges from nothing.
            let bounded = !before.is_some_and(|byte| is_identifier_byte(byte) || byte == b'.')
                && !after.is_some_and(is_identifier_byte);
            if bounded && code.get(at).copied().unwrap_or(false) {
                return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                    "line {}: gg names the class a code module's body is compiled into, and this \
                     compile names it `{class}`. Take `{class}` out — a module's own declarations \
                     reach each other by name, and a constructor is never called.",
                    number + 1,
                ))));
            }
        }
        start += line.len();
    }
    Ok(())
}

/// A body that ends in exactly one newline, so the brace that closes it is on its own line and the
/// body has as many lines as the module did — no more.
fn terminated(body: &str) -> String {
    match body.ends_with('\n') {
        true => body.to_string(),
        false => format!("{body}\n"),
    }
}

// ---------------------------------------------------------------------------------------------
// The import hoist
// ---------------------------------------------------------------------------------------------

/// Lift every `import` a **code module** declares to the front of the file, leaving a blank line
/// where each stood.
///
/// A module's author writes a class body, and inside a class body an `import` is a syntax error. So
/// they are moved rather than refused, which is part of the wrapper D5 admits. Blanking rather than
/// deleting is what keeps every later line where the author put it, and the header shares the
/// author's first line so that nothing moves at all.
///
/// A `package` declaration is refused instead of moved: a module is one anonymous compilation unit
/// and there is nowhere for a package to be.
///
/// It is **not** applied to a program. A program is a whole compilation unit and writes its imports
/// where Java puts them.
fn hoist(source: &str) -> Result<(String, Vec<String>), PrepareFailure> {
    let code = Lexer::new(source).code_mask();
    let mut body = String::with_capacity(source.len());
    let mut imports = Vec::new();
    let mut at = 0usize;
    for (number, line) in source.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let trimmed = line.trim();
        // Only a line that *starts* in code is a candidate: the first byte of `import` inside a text
        // block is masked out, and so is a commented-out one.
        let offset = line.len() - line.trim_start().len();
        if !code.get(start + offset).copied().unwrap_or(false) {
            body.push_str(line);
            continue;
        }
        if let Some(rest) = keyword(trimmed, "package") {
            return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
                "line {}: a gg code module is one compilation unit with no package, so \
                 `package {}` has nowhere to go. Remove it; every name you declare is already \
                 visible to the rest of the module.",
                number + 1,
                rest.trim_end_matches(';').trim(),
            ))));
        }
        match keyword(trimmed, "import").filter(|_| trimmed.ends_with(';')) {
            Some(_) => {
                imports.push(trimmed.to_string());
                // The line's own terminator is kept, so the body has exactly as many lines as the
                // module did.
                body.push_str(match line.ends_with('\n') {
                    true => "\n",
                    false => "",
                });
            }
            None => body.push_str(line),
        }
    }
    Ok((body, imports))
}

/// The rest of `line` when it opens with `word` followed by whitespace — `None` otherwise, so
/// `importantThing()` is not read as an `import`.
fn keyword<'a>(line: &'a str, word: &str) -> Option<&'a str> {
    line.strip_prefix(word)
        .filter(|rest| rest.starts_with(char::is_whitespace))
}

// ---------------------------------------------------------------------------------------------
// The export scan
// ---------------------------------------------------------------------------------------------

/// The names a module's class body offers: every `public static` method of it, in source order.
///
/// What counts as a method is a declaration at the class body's own level whose modifier run holds
/// both `public` and `static` and which reaches an identifier immediately followed by `(` before it
/// reaches `=`, `;` or a body — so a `public static final int LIMIT = 3;` is a field and is not one,
/// and a constructor (whose name is the class's) is not a member a namespace can offer.
///
/// A **reading** rather than a rewriting: nothing is inserted, because a program reaches an export
/// by naming it. What this produces is the list the module's author is *told* the namespace holds.
///
/// The type names each declaration writes are read off the same span, in return position and in
/// parameter position, which is what an agent's `docViewTypes` flags open beside the function.
fn exports(body: &str) -> Vec<ModuleExport> {
    let lines: Vec<&str> = body.lines().collect();
    Lexer::new(body)
        .declarations()
        .iter()
        .filter_map(|declaration| {
            let name = declaration.exported_method()?;
            let span = body.get(declaration.start..declaration.end)?;
            let written = span.trim();
            // The line its first token stands on, which is where its documentation is written above.
            let line = body[..declaration.start].matches('\n').count();
            // Where the method's name stands in the quoted declaration, which is the span with
            // whatever the trim took off the front of it discounted.
            let leading = span.len() - span.trim_start().len();
            let signature = Signature::read(
                written,
                (declaration.name_at - declaration.start).saturating_sub(leading),
            );
            Some(ModuleExport {
                name,
                // Every name here is a `public static` method: a field is not one and neither is a
                // nested type, because [`Declaration::exported_method`] reports neither.
                kind: ModuleExportKind::Function,
                declaration: written.to_string(),
                doc: super::super::comments::block_doc(&lines, line)
                    .or_else(|| super::super::comments::line_doc(&lines, line, &["///", "//"])),
                returns: signature.returns,
                parameters: signature.parameters,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// The types a declaration writes
// ---------------------------------------------------------------------------------------------

/// The type names one method declaration writes, in the two positions a documentation view asks
/// about.
///
/// Java writes a type in both positions, so this arm answers both — an arm whose declarations carry
/// no types is the one that leaves them empty. What is recorded is what the author *wrote*, reduced
/// to identifiers: `java.util.List<Row>` is `List` and `Row`, because both are names a view can be
/// opened under and neither is a name the author has to have qualified the same way twice.
#[derive(Debug, Default, PartialEq, Eq)]
struct Signature {
    /// The names written in return position.
    returns: Vec<String>,
    /// The names written in parameter position, in source order.
    parameters: Vec<String>,
}

impl Signature {
    /// Read `declaration`, whose method name starts at `name_at`.
    ///
    /// Everything before the name is modifiers, annotations, type parameters and the return type;
    /// everything inside the parentheses that open at the name is the parameter list. Both are
    /// found by position rather than by searching for a keyword, because the scan that produced the
    /// declaration already knows where its name is and a second reading could disagree with the
    /// first.
    fn read(declaration: &str, name_at: usize) -> Self {
        let Some(before) = declaration.get(..name_at) else {
            return Self::default();
        };
        let mut signature = Self {
            returns: named(returned(before)),
            parameters: Vec::new(),
        };
        let Some(open) = declaration[name_at..].find('(').map(|at| at + name_at) else {
            return signature;
        };
        // `get` rather than an index: a declaration whose parameter list never closes is a module
        // javac is about to refuse, and reading it must not take the turn down before it can.
        let list = declaration
            .get(open + 1..enclosed(declaration, open))
            .unwrap_or_default();
        for parameter in split_parameters(list) {
            for name in named(declared_type(parameter)) {
                if !signature.parameters.contains(&name) {
                    signature.parameters.push(name);
                }
            }
        }
        signature
    }
}

/// The return type of a declaration, given everything written in front of the method's name.
///
/// Annotations, modifiers and a `<T>` type-parameter block are consumed in the order Java writes
/// them; what is left is the type. A declaration with nothing left is a constructor, which the
/// export scan does not reach.
fn returned(before: &str) -> &str {
    let mut rest = before.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix('@') {
            let after = after.trim_start_matches(is_type_char).trim_start();
            rest = match after.starts_with('(') {
                true => after[closing(after, '(', ')')..].trim_start(),
                false => after,
            };
            continue;
        }
        if rest.starts_with('<') {
            rest = rest[closing(rest, '<', '>')..].trim_start();
            continue;
        }
        let word = rest.split(char::is_whitespace).next().unwrap_or("");
        if !word.is_empty() && MODIFIERS.contains(&word) {
            rest = rest[word.len()..].trim_start();
            continue;
        }
        return rest.trim_end();
    }
}

/// Whether a character may stand in a written type name — an identifier's own characters and the
/// `.` that qualifies one.
fn is_type_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '$' || character == '.'
}

/// Every modifier Java writes in front of a method's return type. `default` is here for the
/// declaration shapes a module body may not use but may still be scanned for; the rest are the ones
/// an export carries.
const MODIFIERS: [&str; 10] = [
    "public",
    "protected",
    "private",
    "static",
    "final",
    "abstract",
    "native",
    "synchronized",
    "strictfp",
    "default",
];

/// One parameter's declared type: everything before the name it binds.
///
/// The name is the last identifier, so `T... values` is `T...` and `java.util.List<Row> rows` is
/// `java.util.List<Row>`. An annotation or a `final` in front of it is dropped by the same reading
/// that drops a modifier from a return type, since [`named`] keeps only identifiers and neither is
/// a type.
fn declared_type(parameter: &str) -> &str {
    let parameter = parameter.trim();
    match parameter.rfind(|ch: char| ch.is_whitespace()) {
        Some(at) => parameter[..at].trim(),
        None => parameter,
    }
}

/// A parameter list split at the commas that separate parameters, ignoring the ones inside a
/// generic argument list or a nested annotation.
fn split_parameters(list: &str) -> Vec<&str> {
    let mut parameters = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (at, character) in list.char_indices() {
        match character {
            '<' | '(' | '[' => depth += 1,
            '>' | ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                parameters.push(&list[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parameters.push(&list[start..]);
    parameters
        .into_iter()
        .filter(|parameter| !parameter.trim().is_empty())
        .collect()
}

/// The identifiers a type expression names, each reduced to the last segment of its qualified name
/// and listed once.
///
/// `java.util.Map<String, java.util.List<Row>>` is `Map`, `String`, `List` and `Row`. The wildcard
/// keywords are dropped because they name nothing; a type variable and a primitive are kept,
/// because they are names the declaration writes and resolving one is the documentation surface's
/// business rather than this scan's.
fn named(written: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for word in written.split(|character: char| !is_type_char(character)) {
        // The last segment that is a name at all, so `java.util.List` is `List` and the trailing
        // dots of a varargs `T...` are not read as a segment of their own.
        let Some(name) = word.split('.').rfind(|part| !part.is_empty()) else {
            continue;
        };
        if matches!(name, "extends" | "super" | "final")
            || name.starts_with(|character: char| character.is_ascii_digit())
        {
            continue;
        }
        if !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// Where the run opened by `open` at the start of `text` closes, as a byte offset past its closer.
///
/// Nesting is counted, so `<Map<String, Row>>` closes at its own last `>`. An unbalanced run closes
/// at the end of the text, which is a declaration javac will refuse anyway.
fn closing(text: &str, open: char, close: char) -> usize {
    let mut depth = 0i32;
    for (at, character) in text.char_indices() {
        if character == open {
            depth += 1;
        } else if character == close {
            depth -= 1;
            if depth == 0 {
                return at + character.len_utf8();
            }
        }
    }
    text.len()
}

/// Where the parameter list opening at `open` in `declaration` closes, as the offset of its `)`.
fn enclosed(declaration: &str, open: usize) -> usize {
    open + closing(&declaration[open..], '(', ')').saturating_sub(1)
}

/// One member declaration found at the top level of a class body.
#[derive(Debug, PartialEq, Eq)]
struct Declaration {
    /// Its tokens, up to and including the one that decided what it is.
    tokens: Vec<String>,
    /// Whether an identifier was immediately followed by `(` — which is what makes it a method
    /// rather than a field.
    call: Option<String>,
    /// Where that identifier begins, so the [signature reading](Signature::read) can tell the
    /// return type in front of it from the parameter list behind it without searching for either.
    name_at: usize,
    /// Where it begins: the first byte of its first token, which is its annotation's `@` where it
    /// carries one, so that the documentation above it is found above the whole declaration.
    start: usize,
    /// Where it ends: the `{` that opens its body or the `;` that stands in for one, so that
    /// `body[start..end]` is the declaration and nothing else.
    end: usize,
}

impl Declaration {
    /// The name this declares, if it is a method a module's namespace may offer.
    fn exported_method(&self) -> Option<String> {
        let name = self.call.as_ref()?;
        let modifiers = |word: &str| self.tokens.iter().any(|token| token == word);
        // A constructor has the class's name and no return type. gg names the class rather than the
        // author, so a constructor is told from a method by the absence of a return type: a method
        // declaration's modifier run always carries at least one token before the name.
        (modifiers("public") && modifiers("static")).then(|| name.clone())
    }
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// The smallest reading of Java that can tell **code** from everything that merely looks like it.
///
/// It answers two questions and no others: which bytes are code (so a line that opens with `import`
/// inside a text block is not an import), and where each member declaration of a class body begins
/// (so its name can be read off). It is not a parser and does not try to be — javac is downstream of
/// it and is what actually reads the module.
struct Lexer<'a> {
    /// The source.
    source: &'a str,
    /// Its bytes.
    bytes: &'a [u8],
}

impl<'a> Lexer<'a> {
    /// Read `source`.
    fn new(source: &'a str) -> Self {
        Self {
            source,
            bytes: source.as_bytes(),
        }
    }

    /// One `bool` per byte: `true` where the byte is code rather than a string, a character literal,
    /// a text block or a comment.
    fn code_mask(&self) -> Vec<bool> {
        let mut mask = vec![true; self.bytes.len()];
        self.walk(|at, len, _| {
            for byte in mask.iter_mut().skip(at).take(len) {
                *byte = false;
            }
        });
        mask
    }

    /// Every member declaration at the outermost level of a class body.
    fn declarations(&self) -> Vec<Declaration> {
        let mut spans: Vec<(usize, usize)> = Vec::new();
        self.walk(|at, len, _| spans.push((at, at + len)));

        let mut declarations = Vec::new();
        let mut depth = 0usize;
        let mut current: Option<Declaration> = None;
        let mut at = 0usize;
        // The spans arrive in order and this scan only ever moves forward, so the next one to
        // consider is the next one in the list. A search per byte would be quadratic in the size of
        // a module, and a code skill is a file an author wrote rather than a line.
        let mut span = 0usize;
        while at < self.bytes.len() {
            while span < spans.len() && spans[span].1 <= at {
                span += 1;
            }
            if let Some((start, end)) = spans.get(span)
                && at >= *start
            {
                at = *end;
                continue;
            }
            let byte = self.bytes[at];
            match byte {
                b'{' | b';' | b'}' => {
                    if byte == b'{' || depth == 0 {
                        // A declaration ends at its body, its terminator, or the end of the class.
                        if let Some(mut declaration) = current.take()
                            && depth == 0
                        {
                            declaration.end = at;
                            declarations.push(declaration);
                        }
                    }
                    match byte {
                        b'{' => depth += 1,
                        b'}' => depth = depth.saturating_sub(1),
                        _ => {}
                    }
                    at += 1;
                }
                b'@' if depth == 0 => {
                    // An annotation is part of the declaration it decorates, so the declaration
                    // starts where the annotation does.
                    current.get_or_insert(Declaration {
                        tokens: Vec::new(),
                        call: None,
                        name_at: at,
                        start: at,
                        end: at,
                    });
                    at += 1;
                }
                b'=' if depth == 0 => {
                    // A field initialiser: whatever follows is a value, not a declaration.
                    current = None;
                    at = self.skip_to_semicolon(at, &spans);
                }
                _ if depth == 0 && is_identifier_start(byte) => {
                    let end = self.identifier_end(at);
                    let word = &self.source[at..end];
                    let declaration = current.get_or_insert(Declaration {
                        tokens: Vec::new(),
                        call: None,
                        name_at: at,
                        start: at,
                        end: at,
                    });
                    // An identifier immediately followed by `(` is the method's own name; the ones
                    // before it are modifiers, annotations and the return type.
                    if declaration.call.is_none() && self.bytes.get(end) == Some(&b'(') {
                        declaration.call = Some(word.to_string());
                        declaration.name_at = at;
                    }
                    declaration.tokens.push(word.to_string());
                    at = end;
                }
                _ => at += 1,
            }
        }
        declarations
    }

    /// Where the identifier starting at `at` ends.
    fn identifier_end(&self, at: usize) -> usize {
        let mut end = at;
        while end < self.bytes.len() && is_identifier_byte(self.bytes[end]) {
            end += 1;
        }
        end
    }

    /// Past the next `;` that is code, from `at`.
    fn skip_to_semicolon(&self, at: usize, spans: &[(usize, usize)]) -> usize {
        let mut scan = at + 1;
        while scan < self.bytes.len() {
            if let Some((_, end)) = spans
                .iter()
                .find(|(start, end)| scan >= *start && scan < *end)
            {
                scan = *end;
                continue;
            }
            if self.bytes[scan] == b';' {
                return scan;
            }
            scan += 1;
        }
        self.bytes.len()
    }

    /// Call `found` for every run of bytes that is **not** code, with its offset, its length and
    /// what it was.
    ///
    /// # Why this compares bytes rather than slicing the source
    ///
    /// Because `at` walks one **byte** at a time and a model's Java is not ASCII. `&source[at..]`
    /// panics unless `at` falls on a character boundary, so a single `é` — in a string, in a
    /// comment, in an identifier, anywhere — would take the whole turn down with a slice index
    /// error rather than reaching javac. Every delimiter this looks for is ASCII, and an ASCII byte
    /// never appears inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a
    /// string comparison would and cannot panic on the way.
    fn walk(&self, mut found: impl FnMut(usize, usize, Skipped)) {
        let mut at = 0usize;
        while at < self.bytes.len() {
            if self.matches(at, b"//") {
                let end = self.find(at, b"\n").unwrap_or(self.bytes.len());
                found(at, end - at, Skipped::Comment);
                at = end;
                continue;
            }
            if self.matches(at, b"/*") {
                let end = self
                    .find(at + 2, b"*/")
                    .map_or(self.bytes.len(), |end| end + 2);
                found(at, end - at, Skipped::Comment);
                at = end;
                continue;
            }
            // A text block first: `"""` also starts with `"`, and reading it as an empty string
            // followed by one would put its whole body back in the code.
            if self.matches(at, b"\"\"\"") {
                let end = self.quoted_end(at + 3, b"\"\"\"");
                found(at, end - at, Skipped::Text);
                at = end;
                continue;
            }
            if self.matches(at, b"\"") {
                let end = self.quoted_end(at + 1, b"\"");
                found(at, end - at, Skipped::Text);
                at = end;
                continue;
            }
            if self.matches(at, b"'") {
                let end = self.quoted_end(at + 1, b"'");
                found(at, end - at, Skipped::Text);
                at = end;
                continue;
            }
            at += 1;
        }
    }

    /// Whether `needle`'s bytes stand at `at`.
    fn matches(&self, at: usize, needle: &[u8]) -> bool {
        self.bytes.len() >= at + needle.len() && &self.bytes[at..at + needle.len()] == needle
    }

    /// Where `needle` next stands at or after `from`.
    fn find(&self, from: usize, needle: &[u8]) -> Option<usize> {
        (from..=self.bytes.len().saturating_sub(needle.len())).find(|at| self.matches(*at, needle))
    }

    /// Where a quoted run that opened at `from` ends, past its closing `terminator`.
    ///
    /// Honours `\` escapes, so `"a\""` is one string. An unterminated one runs to the end of the
    /// source, which is a module javac will refuse anyway — and refusing it *here* would replace
    /// javac's located diagnostic with gg's opinion.
    fn quoted_end(&self, from: usize, terminator: &[u8]) -> usize {
        let mut at = from;
        while at < self.bytes.len() {
            if self.bytes[at] == b'\\' {
                at += 2;
                continue;
            }
            if self.matches(at, terminator) {
                return at + terminator.len();
            }
            at += 1;
        }
        self.bytes.len()
    }
}

/// What a run of non-code bytes was. Carried for the reader rather than branched on: the two callers
/// want "not code" and nothing finer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Skipped {
    /// A `//` or `/* */` comment.
    Comment,
    /// A string, a character literal or a text block.
    Text,
}

/// Whether a byte may start a Java identifier. ASCII only: a Unicode identifier is legal Java and is
/// simply never a keyword or a modifier, which is all this reading is used to decide.
fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$'
}

/// Whether a byte may continue one.
fn is_identifier_byte(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}

#[cfg(test)]
#[path = "java.source.test.rs"]
mod tests;
