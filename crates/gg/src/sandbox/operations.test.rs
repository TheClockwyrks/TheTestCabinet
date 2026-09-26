//! What is left here after the [capability gate](crate::sandbox::language) was re-founded on this
//! table: the two checks that are about the table being reachable from a real arm rather than about
//! the table being well formed.
//!
//! # Where everything else went, and why
//!
//! Every rule about *gating* — the ending operations and their roles, a view being gated exactly
//! where it reads the workspace, a capability buying the program library and nothing else, an id
//! namespaced on exactly one real family, no operation written down twice — is stated in
//! `language/agreement.rs` and returned as a complaint rather than asserted here.
//!
//! That is not tidying. `OPERATIONS` is a `const`, so a rule asserted against it could only ever
//! be **watched passing**: no test could hand it a wrong table, and a rule whose failing path has
//! never run is a rule nobody has evidence about. The gate takes the table as a parameter for
//! exactly that reason, and its tests hand it a table with one row damaged — a view bound to every
//! program, an ending offered to the wrong role, a capability gg does not have, an exemption with no
//! reason — and assert on the sentence that comes back. Each of those has now been observed failing;
//! none of them ever had been.
//!
//! The per-arm rules live there for the same reason: capability coverage, the propagation rule,
//! and whether an operation takes input at all are all asserted there, against fixtures built to
//! fail them.
//!
//! What is left in the module itself is one `const` assertion, over the written reason every
//! [exemption](Applicability::UniversalExcept) carries — there because a `const` block fails a
//! `cargo check`, before there is a green suite to be reassured by — and it is *also* a gating rule
//! next door, where it can be watched failing.

use super::*;

use crate::sandbox::catalogue_functions;
use crate::sandbox::language::all_languages;

/// **Every function every registered arm catalogues resolves to an operation** — through
/// [`operation_of`], which is the lookup a *run* uses.
///
/// The [gate](crate::sandbox::language) asserts the same thing against a table it was handed, which
/// is what makes it able to fail on demand. This asserts it against the real table through the real
/// entry point, which is what makes it a statement about what a run does: a function with no row is
/// one [`bound`](crate::docs::DocsRuntime::bound) answers `false` for, so the model would never be
/// shown a call its own scope binds.
#[test]
fn every_catalogued_function_has_an_operation() {
    for language in all_languages() {
        for function in catalogue_functions(language) {
            assert!(
                operation_of(&function).is_some(),
                "{}: the catalogue binds `{}` under `{}` (spelled `{}`), which gg has no \
                 operation for",
                language.display_name(),
                function.key,
                function.object,
                function.name
            );
        }
    }
}
