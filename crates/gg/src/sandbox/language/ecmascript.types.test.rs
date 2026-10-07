//! Tests for [the type reader](super) — what a declaration writes in return position and in
//! parameter position, read off the declaration text alone.

use super::super::ModuleExportKind;
use super::types_of;

/// The two lists a function declaration produces, in return-then-parameter order.
fn read(declaration: &str) -> (Vec<String>, Vec<String>) {
    types_of(declaration, ModuleExportKind::Function)
}

/// **A declaration's annotations are read in both positions.**
#[test]
fn a_declaration_states_its_types_in_two_positions() {
    let (returns, parameters) = read("export function widen(row: Row, into: Table): Report");
    assert_eq!(returns, ["Report"]);
    assert_eq!(parameters, ["Row", "Table"]);

    let (returns, parameters) = read("export const parse = (text: string): Table =>");
    assert_eq!(
        returns,
        ["Table"],
        "an arrow's return annotation ends at the arrow that opens its body"
    );
    assert!(
        parameters.is_empty(),
        "a built-in names no declaration a view could open: {parameters:?}"
    );
}

/// **A declaration that annotates nothing reports nothing** — which is every declaration on the
/// [JavaScript](super::super::super::javascript) arm.
#[test]
fn an_unannotated_declaration_reports_no_types() {
    for declaration in [
        "export function parseCsv({ text, width })",
        "export const twice = (x) =>",
        "export const half = x =>",
        "export function rows()",
    ] {
        assert_eq!(
            read(declaration),
            (Vec::new(), Vec::new()),
            "`{declaration}` writes no type"
        );
    }
}

/// **Only a function has a signature to read**, so a class and a value report nothing whatever their
/// declaration says.
#[test]
fn a_class_and_a_value_report_no_types() {
    for kind in [ModuleExportKind::Type, ModuleExportKind::Value] {
        assert_eq!(
            types_of("export const limit: Bound = compute(4)", kind),
            (Vec::new(), Vec::new())
        );
    }
}

/// **A type argument list is not a parameter boundary**, and a name is reported once however often
/// the declaration writes it.
#[test]
fn a_generic_type_is_one_parameter_and_a_repeat_is_one_name() {
    let (returns, parameters) = read(
        "export function index(rows: Map<string, Row>, extra: Row): Promise<Map<string, Row>>",
    );
    assert_eq!(returns, ["Promise", "Map", "Row"]);
    assert_eq!(
        parameters,
        ["Map", "Row"],
        "one entry per name, in the order the declaration writes them"
    );
}

/// **A name the declaration itself binds is not a name a model can open**, so a type parameter is
/// left out of both lists and a name is reported only from the position the signature writes it in.
#[test]
fn a_type_parameter_is_the_declarations_own_name() {
    let (returns, parameters) = read("export const identity = <T>(value: T): T =>");
    assert!(returns.is_empty(), "{returns:?}");
    assert!(parameters.is_empty(), "{parameters:?}");

    let (returns, parameters) =
        read("export function first<T extends Row, K>(rows: T[], key: K, fallback: Row): T");
    assert!(returns.is_empty(), "{returns:?}");
    assert_eq!(
        parameters,
        ["Row"],
        "the only name here that is not one of the declaration's own"
    );
}

/// **A destructured parameter is read by its annotation and never by its properties.**
#[test]
fn a_destructured_parameter_is_read_by_its_annotation() {
    let (returns, parameters) = read("export function widen({ text, width }: Options): Row");
    assert_eq!(returns, ["Row"]);
    assert_eq!(parameters, ["Options"]);

    let (_, parameters) = read("export function widen({ text, width })");
    assert!(
        parameters.is_empty(),
        "an unannotated destructuring annotates nothing: {parameters:?}"
    );
}

/// **A default value is an expression**, so the names in one are not types.
#[test]
fn a_default_value_contributes_no_type() {
    let (_, parameters) = read("export function page(rows: Row[], size: number = defaultSize())");
    assert_eq!(parameters, ["Row"]);
}

/// **A callback parameter's own arrow does not end the signature**, and the names inside its type
/// are the parameter's.
#[test]
fn a_callback_parameters_arrow_is_part_of_its_type() {
    let (returns, parameters) =
        read("export function each(rows: Row[], visit: (row: Row) => Cell): Report");
    assert_eq!(returns, ["Report"]);
    assert_eq!(
        parameters,
        ["Row", "Cell"],
        "a property label is skipped and the rest of the callback's type is read"
    );
}

/// **A type literal's property labels are not types**, and a qualified name is reported by the name
/// its declaration is filed under.
#[test]
fn a_property_label_is_not_a_type_and_a_qualified_name_is_its_last_segment() {
    let (returns, parameters) = read("export function load(at: gg.FileRead): { rows: Row[] }");
    assert_eq!(returns, ["Row"]);
    assert_eq!(parameters, ["FileRead"]);
}

/// **A string literal type contributes no names**, whatever it spells.
#[test]
fn a_string_literal_type_contributes_nothing() {
    let (returns, parameters) = read("export function kindOf(row: Row): \"text\" | \"binary\"");
    assert!(returns.is_empty(), "{returns:?}");
    assert_eq!(parameters, ["Row"]);
}

/// **`typeof` names a value**, so what follows one is not reported as a type.
#[test]
fn a_typeof_query_names_a_value_rather_than_a_type() {
    let (returns, parameters) = read("export function shapeOf(row: Row): typeof defaults");
    assert!(returns.is_empty(), "{returns:?}");
    assert_eq!(parameters, ["Row"]);
}

/// **An optional and a rest parameter are read like any other.**
#[test]
fn optional_and_rest_parameters_are_read_like_any_other() {
    let (_, parameters) = read("export function join(first: Row, ...rest: Cell[], how?: Options)");
    assert_eq!(parameters, ["Row", "Cell", "Options"]);
}

/// **An unclosed parameter list is a declaration the compiler rejects**, and nothing here guesses at
/// what its author meant.
#[test]
fn an_unclosed_declaration_reports_nothing() {
    assert_eq!(
        read("export function rows(path: Row"),
        (Vec::new(), Vec::new())
    );
}
