//! What the [table](super::ROWS) owes as a whole, with no compiler in the loop.

use super::*;

/// **Every registered arm has said what its preparation does with an unresolved import.**
///
/// The table is the audit, so a twelfth arm registered tomorrow fails here rather than quietly
/// inheriting the answer "the whole inventory, on every rejection".
#[test]
fn every_registered_arm_has_a_row() {
    for language in crate::sandbox::all_languages() {
        let id = language.id();
        assert_eq!(
            ROWS.iter().filter(|(named, _)| *named == id).count(),
            1,
            "{id} has no row, or more than one, in the unresolved-import table"
        );
    }
    for (arm, reads) in ROWS {
        assert!(
            crate::sandbox::all_languages().any(|language| language.id() == *arm),
            "{arm} has a row and is not registered"
        );
        if let Reads::Nothing(why) = reads {
            assert!(
                !why.is_empty(),
                "{arm} reads no import and says nothing about why"
            );
        }
    }
}

/// **An arm that names a candidate names one its own catalogue declares.**
///
/// The row's `candidate` is the module the answer must offer back, so a row naming a module the arm
/// does not carry would assert nothing at all. Read off the catalogue rather than a list here, for
/// the reason every model-facing word about an arm's surface is.
#[test]
fn every_candidate_a_row_names_is_a_module_that_arm_declares() {
    for (arm, reads) in ROWS {
        let Reads::Import { candidate, .. } = reads else {
            continue;
        };
        let catalogue = crate::sandbox::language(*arm).catalogue();
        assert!(
            catalogue
                .libraries
                .iter()
                .any(|group| group.modules.iter().any(|module| module == candidate)),
            "{arm}'s row names `{candidate}`, which its catalogue does not declare"
        );
    }
}

/// **An arm whose preparation reads no import recovers nothing from any arm's wording.**
///
/// The other half of the table, and the half that needs no compiler. What it catches is a parser
/// copied from the arm beside it: an arm that reads nothing on the host must read nothing out of
/// every sentence the arms that do read produce.
#[test]
fn an_arm_that_reads_no_import_recovers_nothing_from_any_wording() {
    for (arm, reads) in ROWS {
        if matches!(reads, Reads::Nothing(_)) {
            gate(*arm);
        }
    }
}
