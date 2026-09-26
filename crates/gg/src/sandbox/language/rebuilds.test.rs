//! What the [table](super::ROWS) owes as a whole, with no compiler in the loop.

use super::*;

/// **Every registered arm has said what its program step does with a module it holds no build of.**
///
/// The table is the audit, so a twelfth arm registered tomorrow fails here rather than quietly
/// inheriting whichever band its compiler happened to produce.
#[test]
fn every_registered_arm_has_a_row() {
    for language in crate::sandbox::all_languages() {
        let id = language.id();
        assert_eq!(
            ROWS.iter().filter(|(named, _)| *named == id).count(),
            1,
            "{id} has no row, or more than one, in the module-rebuild table"
        );
    }
    for (arm, rebuilds) in ROWS {
        assert!(
            crate::sandbox::all_languages().any(|language| language.id() == *arm),
            "{arm} has a row and is not registered"
        );
        if let Rebuilds::Nothing(why) = rebuilds {
            assert!(
                !why.is_empty(),
                "{arm} compiles no module at prepare time and says nothing about why"
            );
        }
    }
}

/// **An arm that compiles no module at prepare time really prepares one.**
///
/// The half of the table that needs no compiler, driven here rather than beside a toolchain because
/// there is no toolchain beside it to drive.
#[test]
fn an_arm_that_compiles_no_module_prepares_a_program_beside_a_broken_one() {
    for (arm, rebuilds) in ROWS {
        if matches!(rebuilds, Rebuilds::Nothing(_)) {
            gate(*arm);
        }
    }
}
