//! The one function that belongs to **no** API object, because it belongs to all of them.
//!
//! Every object this SDK offers carries a `list`, so a program can always discover what it has
//! whatever a run enables. Reading what one of those functions *does* is
//! [`view::open_docs_view`](crate::view::open_docs_view) — a view, because everything a model reads
//! is a view.
//!
//! It is declared **once**, by [`directory_of`], and expanded into each object module. Writing
//! twelve copies of one function would be twelve copies of one paragraph of model-facing
//! documentation with nothing keeping them equal, and this SDK's rule is that every word a model
//! reads is written on the code exactly once. The macro is what makes "once" true and still leaves
//! `fs::list()` a real function in `fs`, with the object it belongs to closed over rather than
//! passed.

use crate::bindings::test_cabinet::gg::docs;
use crate::types::FunctionSummary;
use crate::wire;

/// The directory of one API object, as the host answers it.
///
/// Not model-facing: [`directory_of`] is the declaration a program calls and the one the catalogue
/// is reflected from. This is the single call underneath all twelve of them.
pub(crate) fn directory(object: &str) -> Vec<FunctionSummary> {
    docs::list_functions(object)
        .into_iter()
        .map(wire::function_summary)
        .collect()
}

/// The `list` an API object carries, with that object's name closed over.
///
/// Expanded once per object module. The documentation on the `list` it declares is the whole of what
/// a model is told about the function, on every object at once — which is the point of declaring it
/// here rather than twelve times.
macro_rules! directory_of {
    ($object:literal) => {
        /// List the functions available on this API object, each with a one-line summary.
        ///
        /// Only the functions this run actually bound are returned, so the directory never names a
        /// call your program cannot make. Open a view of one function's full signature, argument
        /// descriptions and types with `view::open_docs_view`.
        pub fn list() -> ::std::vec::Vec<$crate::types::FunctionSummary> {
            $crate::meta::directory($object)
        }
    };
}

pub(crate) use directory_of;
