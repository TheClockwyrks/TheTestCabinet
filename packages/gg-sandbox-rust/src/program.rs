//! The **shell** a model's program runs inside: what calls it, what it answers when gg asks what it
//! can bind, and the error type its `main` may return.
//!
//! The shell is here rather than in a file gg writes around the model's text, and that is the whole
//! of this arm's conversion to the
//! [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/). gg compiles the
//! model's bytes and nothing else; the file it hands `rustc` is a **binary crate** whose `fn main`
//! the model wrote. What reaches that `main` is [`Program::run`] below, through the unmangled C
//! entry symbol `rustc` emits for a binary crate — so the world's `run` export lives in this rlib,
//! is linked into every program, and appears in no source a model reads.
//!
//! No model reads any of this. It is not the SDK and it is not one of the capability modules.

use crate::bindings::{CodeModule, EndingKind};

/// The type gg's world is exported on, and the whole of what stands between the host's `run` and
/// the model's `fn main`.
///
/// It lives in this rlib rather than in the file `rustc` compiles, which is the point: the file
/// `rustc` compiles is the model's reply, byte for byte. The `export!` below turns this crate into
/// the half of the component that answers `run` and `bound-operations`, and linking it into a **binary**
/// crate is what makes the model's own `main` reachable — see [`Program::run`].
struct Program;

impl crate::bindings::Guest for Program {
    /// Call the model's `main`, and stop with the status it ended on.
    ///
    /// # How this reaches `main` at all
    ///
    /// `rustc` compiling a **binary** crate emits an unmangled C entry symbol beside the model's
    /// `fn main` — `__main_void` on `wasm32-wasip1`, which is wasi-libc's convention — and asks
    /// `rust-lld` to export it. That symbol is what [`main`](self::main) declares and what this
    /// calls. A **library** crate type emits neither: there the model's `main` is dead code, and
    /// the Rust-mangled symbol carries a `-C metadata` hash no `extern` declaration can name.
    ///
    /// It is a convention rather than a stable ABI, so it is guarded by a test rather than trusted:
    /// `rust.substrate.test.rs` compiles a `fn main()` program, drives this export and asserts both
    /// that the model's `main` ran and that a panicking one's stderr reaches the host. A toolchain
    /// that renamed the symbol fails at link, loudly; one that made the platform's own `_start` do
    /// more than call `main` would fail quietly, and that test is what would say so.
    ///
    /// # Why the status is propagated rather than swallowed
    ///
    /// `main` returning `Err` is [shape (c)](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
    /// of a runtime failure, and `std`'s own `Termination` has already written `Error: …` to
    /// standard error by the time this sees the status — which the host keeps, because gg wires the
    /// guest's stderr. What the status adds is that the turn **failed**: a `run` that returned
    /// normally would be a program the model is told worked. [`std::process::exit`] is `proc_exit`
    /// here, so the host reads it as the exit it is, carrying the status the program chose.
    fn run(
        _program: String,
        _modules: Vec<CodeModule>,
        _operations: Vec<String>,
        _ending: EndingKind,
        _library: bool,
    ) {
        // SAFETY: `main` is the C entry symbol `rustc` emits for the binary crate this rlib is
        // linked into. It takes no arguments, returns the program's status, and is the same symbol
        // the platform's own `_start` would have called.
        let status = unsafe { main() };
        if status != 0 {
            std::process::exit(status);
        }
    }

    fn bound_operations() -> Vec<String> {
        self::bound_operations()
    }
}

crate::bindings::export!(Program with_types_in crate::bindings);

unsafe extern "C" {
    /// The model's `fn main`, reached through the entry symbol `rustc` emits for a binary crate.
    ///
    /// `__main_void` rather than `main`: on `wasm32-wasip1` that is the wasi-libc convention for an
    /// entry point taking no arguments, and it is the symbol `rust-lld` is asked to export. The
    /// Rust name of the model's `main` is unreachable — it is mangled with a `-C metadata` hash
    /// that is a function of the compile.
    #[link_name = "__main_void"]
    fn main() -> i32;
}

/// The gg tool names this component can bind, **module by module** — what `bound-operations` answers.
///
/// gg asks the built artifact which tools it binds and compares the answer with gg's own
/// `ALL_TOOL_NAMES`. The answer has to come from the SDK's own binding table rather than from a
/// list written here, because the whole point of asking the artifact is that it is a second,
/// independent statement of the same fact: each capability module declares the tools *its own*
/// functions dispatch, beside the functions that dispatch them, and this is the concatenation.
///
/// The four modules missing from it are missing because none of their functions is a gg tool:
/// `views`, `programs` and `session` are the model-facing carve-outs the WIT keeps outside the tool
/// interfaces, `core` declares no function at all, and `files`'s helper `read_text_file` dispatches
/// `read_file` rather than a name of its own.
const OPERATIONS: &[&[&str]] = &[
    crate::files::OPERATIONS,
    crate::shell::OPERATIONS,
    crate::board::OPERATIONS,
    crate::tasks::OPERATIONS,
    crate::memories::OPERATIONS,
    crate::context::OPERATIONS,
    crate::delegation::OPERATIONS,
    crate::skills::OPERATIONS,
];

/// The gg tool names this component can bind, as `bound-operations` returns them.
pub fn bound_operations() -> Vec<String> {
    OPERATIONS
        .iter()
        .flat_map(|object| object.iter())
        .map(|name| (*name).to_string())
        .collect()
}

/// **Why a program ended early** — the error type a program's `main` returns.
///
/// It exists so that `?` is the operator a Rust author would reach for. Anything that implements
/// [`std::error::Error`] converts into it, which covers every SDK call and every `std` fallible
/// operation a program composes them with; [`message`] is the constructor for a program that wants
/// to stop on a sentence of its own.
///
/// It deliberately does **not** implement [`std::error::Error`] itself. That is what lets the
/// blanket conversion below exist at all — an `impl<E: Error> From<E> for Failure` on a type that
/// was itself an `Error` would overlap the reflexive `impl<T> From<T> for T` — and it is the same
/// shape `anyhow::Error` has, for the same reason.
pub struct Failure {
    /// What ended the program. Boxed because it is whatever the program's own `?` produced, and
    /// kept as itself rather than flattened to a string at the conversion so that [`Display`] can
    /// walk the whole chain it carries.
    ///
    /// [`Display`]: std::fmt::Display
    error: Box<dyn std::error::Error>,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The chain, not just the head: a program that `?`s a parse failure out of an SDK call has
        // two sentences worth saying, and a model shown only the outer one is shown "the call
        // failed" with the reason removed.
        write!(formatter, "{}", self.error)?;
        let mut source = self.error.source();
        while let Some(cause) = source {
            write!(formatter, ": {cause}")?;
            source = cause.source();
        }
        Ok(())
    }
}

impl std::fmt::Debug for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, formatter)
    }
}

impl<E: std::error::Error + 'static> From<E> for Failure {
    fn from(error: E) -> Self {
        Self {
            error: Box::new(error),
        }
    }
}

/// A failure that is a sentence rather than an error value: `Err(gg::program::message("no rows"))`.
///
/// It is reached by that path — `gg::program::message`, or under a `use gg::program;` the program
/// wrote — rather than by a name gg put in scope, because there is no such name: everything this
/// crate offers is reached through a line the program writes or through the full path.
///
/// A free function rather than `impl From<&str> for Failure`, and not for want of trying. The
/// blanket conversion above is what makes `?` work, and coherence will not admit a second `From`
/// beside it for **any** type this crate does not own — not `&str`, not `String`, not
/// `Box<dyn Error>` — because a future release of `std` could implement [`std::error::Error`] for
/// one of them and the two impls would then overlap (measured: three `E0119`s). So the ergonomic
/// half is a constructor, which coherence has no opinion about.
pub fn message(message: impl std::fmt::Display) -> Failure {
    Failure {
        error: message.to_string().into(),
    }
}
