//! The one function that belongs to **no** module, because it belongs to all of them.
//!
//! Every capability module carries a `list`, so a program can always discover what it has whatever a
//! run enables. Reading what one of those functions *does* is
//! [`views::open_docs_view`](crate::views::open_docs_view) — a view, because everything a model
//! reads is a view.
//!
//! It is declared **once**, by [`directory_of`], and expanded into each module. Writing eleven
//! copies of one function would be eleven copies of one paragraph of model-facing documentation with
//! nothing keeping them equal, and this SDK's rule is that every word a model reads is written on the
//! code exactly once. The macro is what makes "once" true and still leaves `files::list()` a real
//! function in `files`, with the module it belongs to closed over rather than passed.

use crate::bindings::test_cabinet::gg::docs;
use crate::core::FunctionSummary;
use crate::wire;

/// The directory of one module, as the host answers it.
///
/// Not model-facing: [`directory_of`] is the declaration a program calls and the one the catalogue
/// is reflected from. This is the single call underneath all eleven of them.
pub(crate) fn directory(module: &str) -> Vec<FunctionSummary> {
    docs::list_functions(module)
        .into_iter()
        .map(wire::function_summary)
        .collect()
}

/// The `list` a capability module carries, over the module it is expanded in.
///
/// Expanded once per module. The documentation on the `list` it declares is the whole of what a model
/// is told about the function, on every module at once — which is the point of declaring it here
/// rather than eleven times.
///
/// It takes **no argument**: the path comes from [`module_path!`], so the module a directory reports
/// is the module the directory is declared in, by construction. A path written out at each of the
/// eleven expansions would resolve — the host filters on it — and a copy-pasted one would resolve to
/// the wrong module's functions, which is a failure nothing downstream could see.
macro_rules! directory_of {
    () => {
        /// List the functions this module offers, each with a one-line summary.
        ///
        /// Only the functions this run actually bound are returned, so the directory never names a
        /// call the program cannot make. One function's full signature, argument descriptions and
        /// types are opened as a view with `views::open_docs_view`.
        pub fn list() -> ::std::vec::Vec<$crate::core::FunctionSummary> {
            $crate::directory::directory(::core::module_path!())
        }
    };
}

pub(crate) use directory_of;
