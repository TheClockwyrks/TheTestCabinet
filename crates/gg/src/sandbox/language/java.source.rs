//! **What gg does to a model's Java before javac sees it** — the wrapper, the import hoist and the
//! export scan, all of them lexical and all of them line-preserving.
//!
//! # Why any of this is needed
//!
//! Java has no loose statements and no top-level functions. A compilation unit is imports and then
//! type declarations, and the only place a statement may appear is inside a member. So a reply that
//! is a *sequence of statements* — which is what a program is on every other arm, and what a
//! cross-language study needs it to stay — has to be put somewhere, and where it is put is
//! [`wrap_program`]: the body of a `static` method of a class gg declares.
//!
//! That has one consequence a model has to live with, and it is a property of Java rather than of
//! gg. A helper type declared inside a method body is a **local** class, record, interface or enum —
//! legal since Java 16, and able to hold `static` members since Java 16 too — but a local
//! declaration may not carry an access modifier, so `public class Helper {}` inside a program is
//! `modifier public not allowed here` and `class Helper {}` is fine. It is a located compile error
//! the model can act on, which is the band it belongs in; the alternative (hoisting a declaration
//! out of the body into the class) would move its lines and make every diagnostic after it point
//! somewhere the model did not write.
//!
//! # Line preservation is the whole design constraint
//!
//! A diagnostic is only worth handing back if it names the line the model wrote. So everything here
//! either adds lines **before** the body — a fixed shift every diagnostic is moved back by — or
//! rewrites within a line. Nothing inserts or removes a line inside the body:
//!
//! * an `import` the model wrote is copied into the header and **blanked where it stood**, so the
//!   lines after it do not move;
//! * `@JSExport` is inserted *inline* before a module's exported method, never on a line of its own.
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

use super::super::{PrepareError, PrepareFailure};

/// The class a program's statements become the body of a method of.
pub(super) const PROGRAM_CLASS: &str = "Program";

/// The method a program's statements become the body of.
pub(super) const PROGRAM_METHOD: &str = "ggBody";

/// The class a code module's members become.
pub(super) const MODULE_CLASS: &str = "Module";

/// The name the module's namespace is exported to JavaScript under, and the value evaluating a
/// prepared module hands back.
pub(super) const MODULE_GLOBAL: &str = "GgModule";

/// The class gg generates to hold the entry point and the catch chain.
pub(super) const ENTRY_CLASS: &str = "GgEntry";

/// The imports every program and every module gets without asking.
///
/// Generous on purpose, and the same list for both. Java resolves an unimported type only when it is
/// written out in full, so a model that has to say `java.util.stream.Collectors` in every program is
/// a model spending its reply on ceremony no Java author would type — every one of these is in the
/// first import block of ordinary Java. Anything outside them is still reachable, fully qualified or
/// through an `import` the model writes itself, which [`hoist`] lifts into this same header.
const DEFAULT_IMPORTS: [&str; 9] = [
    "gg.*",
    "java.util.*",
    "java.util.function.*",
    "java.util.stream.*",
    "java.math.*",
    "java.time.*",
    "java.time.format.*",
    "java.text.*",
    "java.util.regex.*",
];

/// How gg's own **API objects** reach a program: as a static import of the fields that hold them.
///
/// This is what makes `fs.readFile("main.java")` an ordinary method call on an ordinary object,
/// which is [the seam's first rule](https://docs.testcabinet.ai/gg/program-languages/) — a
/// namespaced binding rather than a dispatcher — spelled the way Java spells reaching a library:
/// an `import`, resolved by javac against a jar on the classpath.
///
/// A static import rather than fields gg declares in the wrapper, because a **code module** is a
/// class body and a field gg wrote into it would be a member the author did not write — and would
/// shadow, or be shadowed by, one they did. An import is outside the body in both shapes.
///
/// Its names are gg's, not the classlib's, so a program that declares its own `view` shadows it
/// exactly as it would shadow any other static import — which is Java's own rule and not one gg
/// invented for this.
const SURFACE_IMPORT: &str = "import static gg.Gg.*;";

/// A model's source, wrapped into a compilation unit javac will read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Wrapped {
    /// The whole `.java` file.
    pub source: String,
    /// How many lines gg put in front of the model's first line. Every diagnostic located in this
    /// file is moved back by it, so the coordinate names the line of the reply the model wrote.
    pub shift: usize,
    /// The names a module's namespace offers, in source order. Empty for a program.
    pub exports: Vec<String>,
}

/// Wrap a model's **program** — a sequence of statements — into a compilation unit.
///
/// The statements become the body of `Program.ggBody`, which `throws Throwable` so that a program
/// calling something that declares a checked exception does not have to write a `try` around it. A
/// Java author would put a `throws` on `main`; gg puts it here, and the
/// [entry class](super::compile) is what turns whatever comes out into something the guest reports.
pub(super) fn wrap_program(source: &str) -> Result<Wrapped, PrepareFailure> {
    let (body, imports) = hoist(source)?;
    let mut header = header_lines(&imports);
    header.push(format!("public final class {PROGRAM_CLASS} {{"));
    header.push(format!(
        "    static void {PROGRAM_METHOD}() throws Throwable {{"
    ));
    Ok(Wrapped {
        source: format!("{}\n{}    }}\n}}\n", header.join("\n"), terminated(&body)),
        // The header's lines, plus the newline that ends the last of them and starts the model's
        // first — which is what makes this the number to subtract from a 1-based line.
        shift: header.len(),
        exports: Vec::new(),
    })
}

/// Wrap a code [skill](crate::skills)'s or [memory](crate::memories)'s **module** — a class body —
/// into a compilation unit, and say what its namespace will offer.
///
/// A module is a class body rather than a statement sequence because a namespace of functions is
/// what `lib.<key>` binds, and a Java function is a method of a class. Its `public static` methods
/// become the namespace and everything else is the module's own business, which is the visibility
/// rule a Java author already writes. Each exported method has `@JSExport` inserted **inline**, so
/// TeaVM emits it onto the namespace object without a line moving.
pub(super) fn wrap_module(source: &str) -> Result<Wrapped, PrepareFailure> {
    let (body, imports) = hoist(source)?;
    let (body, exports) = mark_exports(&body);
    if exports.is_empty() {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(
            "this module offers nothing: gg binds a code module's `public static` methods at \
             `lib.<key>`, and there are none. Declare at least one, as \
             `public static String greet(String who) { … }`."
                .to_string(),
        )));
    }
    let mut header = header_lines(&imports);
    header.push("import org.teavm.jso.JSClass;".to_string());
    header.push("import org.teavm.jso.JSExport;".to_string());
    header.push(format!("@JSClass(name = \"{MODULE_GLOBAL}\")"));
    header.push(format!("public final class {MODULE_CLASS} {{"));
    Ok(Wrapped {
        source: format!("{}\n{}}}\n", header.join("\n"), terminated(&body)),
        shift: header.len(),
        exports,
    })
}

/// A body that ends in exactly one newline, so the brace that closes it is on its own line and the
/// body has as many lines as the reply did — no more.
fn terminated(body: &str) -> String {
    match body.ends_with('\n') {
        true => body.to_string(),
        false => format!("{body}\n"),
    }
}

/// The import block every wrapped unit opens with: gg's own, then the model's own.
fn header_lines(hoisted: &[String]) -> Vec<String> {
    let mut header: Vec<String> = DEFAULT_IMPORTS
        .iter()
        .map(|name| format!("import {name};"))
        .collect();
    header.push(SURFACE_IMPORT.to_string());
    header.extend(hoisted.iter().cloned());
    header
}

// ---------------------------------------------------------------------------------------------
// The import hoist
// ---------------------------------------------------------------------------------------------

/// Lift every `import` the source declares into the header, leaving a blank line where each stood.
///
/// A model writing Java writes imports — it is the first thing a Java file has — and inside a method
/// body an `import` is a syntax error on every turn. So they are moved rather than refused. Blanking
/// rather than deleting is what keeps every later line where the model put it.
///
/// A `package` declaration is refused instead of moved: a program is one anonymous compilation unit,
/// there is nowhere for a package to be, and silently dropping one would leave a model wondering why
/// its own type names did not resolve.
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
                "line {}: a gg program is one compilation unit with no package, so `package {}` \
                 has nowhere to go. Remove it; every name you declare is already visible to the \
                 rest of your program.",
                number + 1,
                rest.trim_end_matches(';').trim(),
            ))));
        }
        match keyword(trimmed, "import").filter(|_| trimmed.ends_with(';')) {
            Some(_) => {
                imports.push(trimmed.to_string());
                // The line's own terminator is kept, so the body has exactly as many lines as the
                // reply did.
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

/// Insert `@JSExport` before every `public static` method of a module's class body, and report their
/// names in source order.
///
/// Inline insertion, because the annotation must not cost a line. What counts as a method is a
/// declaration at the class body's own level whose modifier run holds both `public` and `static` and
/// which reaches an identifier immediately followed by `(` before it reaches `=`, `;` or a body — so
/// a `public static final int LIMIT = 3;` is a field and is left alone, and a constructor (whose name
/// is the class's) is not a member a namespace can offer.
fn mark_exports(body: &str) -> (String, Vec<String>) {
    let declarations = Lexer::new(body).declarations();
    let mut out = String::with_capacity(body.len() + declarations.len() * 11);
    let mut exports = Vec::new();
    let mut copied = 0usize;
    for declaration in declarations {
        let Some(name) = declaration.exported_method() else {
            continue;
        };
        out.push_str(&body[copied..declaration.start]);
        out.push_str("@JSExport ");
        copied = declaration.start;
        exports.push(name);
    }
    out.push_str(&body[copied..]);
    (out, exports)
}

/// One member declaration found at the top level of a class body.
#[derive(Debug, PartialEq, Eq)]
struct Declaration {
    /// The byte offset of its first token.
    start: usize,
    /// Its tokens, up to and including the one that decided what it is.
    tokens: Vec<String>,
    /// Whether an identifier was immediately followed by `(` — which is what makes it a method
    /// rather than a field.
    call: Option<String>,
}

impl Declaration {
    /// The name this declares, if it is a method a module's namespace may offer.
    fn exported_method(&self) -> Option<String> {
        let name = self.call.as_ref()?;
        let modifiers = |word: &str| self.tokens.iter().any(|token| token == word);
        // A constructor has the class's name and no return type, and there is nothing for a
        // namespace to bind it to.
        (modifiers("public") && modifiers("static") && name != MODULE_CLASS).then(|| name.clone())
    }
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// The smallest reading of Java that can tell **code** from everything that merely looks like it.
///
/// It answers two questions and no others: which bytes are code (so a line that opens with `import`
/// inside a text block is not an import), and where each member declaration of a class body begins
/// (so an annotation can be inserted in front of one). It is not a parser and does not try to be —
/// javac is downstream of it and is what actually reads the program.
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
                        if let Some(declaration) = current.take()
                            && depth == 0
                        {
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
                    // An annotation is part of the declaration it decorates, so gg's own has to go
                    // in front of it rather than between it and the method it applies to.
                    current.get_or_insert(Declaration {
                        start: at,
                        tokens: Vec::new(),
                        call: None,
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
                        start: at,
                        tokens: Vec::new(),
                        call: None,
                    });
                    // An identifier immediately followed by `(` is the method's own name; the ones
                    // before it are modifiers, annotations and the return type.
                    if declaration.call.is_none() && self.bytes.get(end) == Some(&b'(') {
                        declaration.call = Some(word.to_string());
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
    /// source, which is a program javac will refuse anyway — and refusing it *here* would replace
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
