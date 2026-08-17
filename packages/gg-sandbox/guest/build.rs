//! Generate this guest's two halves that nobody should write by hand: the **membrane glue** that
//! lowers gg's WIT onto JavaScript values, and the **table of baked SDK sources** the module loader
//! resolves against.
//!
//! # Why the glue is generated
//!
//! `crates/gg/wit/gg-sandbox.wit` is 1,400 lines: fifteen interfaces, fifty-five imported functions,
//! and forty-odd records, variants and enums between them. Every one of those needs a lift and a
//! lower — WIT value to JavaScript value and back — in exactly the shape the SDK in
//! `packages/gg-sandbox/src/gg/` already expects, because that SDK is **reused unchanged**: it is
//! written against the canonical component-model JS mapping (`src/membrane.d.ts` states the table),
//! and the whole point of this guest is that its SDK is the same 4,000 lines the incumbent's is.
//!
//! Hand-writing that is not a one-off cost, it is a permanent one: it would have to be kept in step
//! with a file that changes whenever gg grows a tool, and the failure of falling behind is a model
//! shown a surface its guest cannot lower. So the WIT is read here, and the glue falls out of it.
//! This is the same argument `crates/gg/build.rs` makes for the eleven signature catalogues, one
//! level down.
//!
//! # The mapping this emits, which is jco's and not one of ours
//!
//! | WIT | JavaScript |
//! | --- | --- |
//! | `bool` | `boolean` |
//! | `u8`/`u16`/`u32`/`s8`/`s16`/`s32`/`f32`/`f64` | `number` |
//! | `u64`/`s64` | `bigint` |
//! | `string` | `string` |
//! | `list<T>` | `T[]` |
//! | `option<T>` | `T \| undefined` (a **positional** parameter) |
//! | `record` | an object with camelCased fields |
//! | `enum` | the case name as a string, kebab-case, exactly as the WIT spells it |
//! | `variant` | `{ tag: "case" }` or `{ tag: "case", val: T }` |
//! | `result<T, E>` | returns `T`; **throws** `E` |
//!
//! It is the component model's own mapping rather than a convention invented here, and that is what
//! makes `packages/gg-sandbox/src/gg/*.ts` — written for `componentize-js` — compile and run against
//! this guest with not one character changed.
//!
//! # What it refuses
//!
//! Every WIT construct gg's membrane does not use: tuples, flags, resources, handles, `char`, and a
//! `list<u8>` (which jco lowers to a `Uint8Array` rather than an array). Refused loudly, at build
//! time, naming the construct and the type it appeared in — because the alternative to a build
//! failure here is a lowering that silently guesses.

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use wit_parser::{Resolve, Type, TypeDefKind, TypeId, WorldItem, WorldKey};

/// The world this guest exports, and the one gg's host binds.
const WORLD: &str = "sandbox";

/// The interfaces of the [`WORLD`] whose functions are **not** gg tools.
///
/// The WIT's own header is the authority for this list and states the reason for each: `feedback` is
/// the guest's private channel back to gg, `session` carries the calls that end the run, `docs` is
/// the always-bound documentation lookup, `views` is how a program puts material into its own
/// context window, `programs` is the library of programs this agent has already run, and `helpers`
/// holds the convenience wrappers built on a tool without being one.
///
/// It is what [`bound_tools`](../src/lib.rs) is derived from, and it is checked in both directions:
/// a name here that is not an interface of the world fails this build, and an interface of the world
/// that is not here contributes its functions to the tool list. That is the property gg's
/// `every_registered_language_binds_exactly_the_tools_gg_offers` compares against `ALL_TOOL_NAMES`.
const NOT_TOOL_INTERFACES: [&str; 6] = ["helpers", "session", "docs", "views", "programs", "feedback"];

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets this"));
    let package = manifest
        .parent()
        .expect("the guest crate sits inside packages/gg-sandbox")
        .to_path_buf();
    let root = package
        .parent()
        .and_then(Path::parent)
        .expect("packages/gg-sandbox sits inside the repository")
        .to_path_buf();
    let wit = root.join("crates/gg/wit");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("cargo sets this"));

    println!("cargo::rerun-if-changed={}", wit.display());
    println!("cargo::rerun-if-changed=build.rs");

    let mut resolve = Resolve::default();
    let (packages, _) = resolve
        .push_path(&wit)
        .unwrap_or_else(|error| panic!("could not parse {}: {error:#}", wit.display()));
    let world = resolve
        .select_world(&[packages], Some(WORLD))
        .unwrap_or_else(|error| panic!("{}: no world `{WORLD}`: {error:#}", wit.display()));

    let generated = Generator::new(&resolve, world).emit();
    std::fs::write(out.join("membrane.rs"), generated)
        .unwrap_or_else(|error| panic!("could not write the membrane glue: {error}"));

    bake_sdk(&package, &out);
}

// -------------------------------------------------------------------------------------------------
// The SDK table
// -------------------------------------------------------------------------------------------------

/// Bake the compiled SDK into the guest as a table of `(specifier, source)`.
///
/// The sources are `packages/gg-sandbox/src/`'s own — the SDK the incumbent guest ships, emitted to
/// `dist/` by the same `tsc` invocation, with nothing done to them here. The specifier a module is
/// filed under is its path under `dist/` with a `sdk:` scheme in front (`sdk:gg/files.js`), which is
/// what lets the loader resolve their relative imports (`../internal/errors.js`) by ordinary path
/// arithmetic and what keeps the whole SDK namespace out of a program's reach: `src/loader.rs`
/// resolves an `sdk:` specifier for an SDK importer and refuses it for a program.
///
/// Only the SDK is baked. `dist/shim.js` is the incumbent guest's entry point — a `new Function`
/// evaluator and a scope builder, which is the arrangement this guest exists to delete — and it is
/// deliberately not in the set.
fn bake_sdk(package: &Path, out: &Path) {
    let dist = package.join("dist");
    println!("cargo::rerun-if-changed={}", dist.display());

    assert!(
        dist.is_dir(),
        "{} does not exist. The SDK is emitted there by `tsc -p packages/gg-sandbox/tsconfig.json`, \
         which `packages/gg-sandbox/build.sh` runs before it reaches this crate — so building this \
         crate on its own needs that step run first.",
        dist.display(),
    );

    // The directories under `dist/` this guest bakes, and nothing else. Named rather than globbed:
    // a file appearing under `dist/` that the SDK does not import is a file this guest should not
    // be carrying, and a glob would carry it silently.
    let mut sources: Vec<(String, String)> = vec![read_module(&dist, "catalogue.js")];
    for directory in ["gg", "internal"] {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dist.join(directory))
            .unwrap_or_else(|error| panic!("could not read {}/{directory}: {error}", dist.display()))
            .map(|entry| entry.expect("a readable directory entry").path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "js"))
            .collect();
        entries.sort();
        assert!(
            !entries.is_empty(),
            "{}/{directory} holds no emitted JavaScript; the SDK build did not run",
            dist.display(),
        );
        for path in entries {
            let name = path
                .file_name()
                .expect("a file path has a file name")
                .to_string_lossy();
            sources.push(read_module(&dist, &format!("{directory}/{name}")));
        }
    }

    let mut rust = String::from(
        "/// Every SDK module baked into this guest, by the specifier the loader files it under.\n\
         pub const SDK_SOURCES: &[(&str, &str)] = &[\n",
    );
    for (specifier, source) in &sources {
        let _ = writeln!(rust, "    ({specifier:?}, r#\"{source}\"#),");
    }
    rust.push_str("];\n");
    std::fs::write(out.join("sdk.rs"), rust)
        .unwrap_or_else(|error| panic!("could not write the baked SDK table: {error}"));
}

/// One emitted SDK module, as `(specifier, source)`.
fn read_module(dist: &Path, relative: &str) -> (String, String) {
    let path = dist.join(relative);
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()));
    assert!(
        !source.contains("\"#"),
        "{} holds the sequence that ends a Rust raw string, so it cannot be baked with `r#\"…\"#`",
        path.display(),
    );
    (format!("sdk:{relative}"), source)
}

// -------------------------------------------------------------------------------------------------
// The membrane glue
// -------------------------------------------------------------------------------------------------

/// How `wit-bindgen` takes one parameter, and therefore how a lifted local is handed to it.
#[derive(Clone, Copy)]
enum Borrow {
    /// Taken by value: every scalar, and every `enum`.
    ByValue,
    /// Taken as `&T`: a `string`, a `list<T>`, a `record`, a `variant`.
    Reference,
    /// Taken as `Option<&str>` or `Option<&[T]>`.
    OptionDeref,
    /// Taken as `Option<&T>` for an aggregate payload.
    OptionReference,
}

/// Everything one emit needs: the parsed WIT, the world, and the buffer being written.
struct Generator<'a> {
    resolve: &'a Resolve,
    world: wit_parser::WorldId,
    out: String,
    /// The named types a lowering has already been emitted for, so a type reached from two
    /// interfaces is written once.
    done: BTreeSet<TypeId>,
}

impl<'a> Generator<'a> {
    fn new(resolve: &'a Resolve, world: wit_parser::WorldId) -> Self {
        Self {
            resolve,
            world,
            out: String::new(),
            done: BTreeSet::new(),
        }
    }

    fn emit(mut self) -> String {
        self.out.push_str(HEADER);

        let interfaces = self.interfaces();
        for name in &NOT_TOOL_INTERFACES {
            assert!(
                interfaces.iter().any(|(id, _)| id == name),
                "`NOT_TOOL_INTERFACES` names `{name}`, and the `{WORLD}` world does not import an \
                 interface by that name. The list decides which functions are reported as gg TOOLS, \
                 so a stale name silently moves a whole family into the tool vocabulary."
            );
        }

        // Every named type reachable from the interfaces this guest binds, lowered once.
        for (_, interface) in &interfaces {
            let interface = &self.resolve.interfaces[*interface];
            for (_, function) in &interface.functions {
                let types: Vec<Type> = function
                    .params
                    .iter()
                    .map(|param| param.ty)
                    .chain(function.result)
                    .collect();
                for ty in types {
                    self.emit_type(ty);
                }
            }
        }

        for (name, interface) in &interfaces {
            self.emit_interface(name, *interface);
        }

        self.emit_registry(&interfaces);
        self.emit_tool_names(&interfaces);
        self.out
    }

    /// The world's imported interfaces, in declaration order, skipping the ones with no functions.
    ///
    /// `types` is the one that has none: it exists so a single `tool-error` crosses the whole
    /// membrane rather than one per family, so there is nothing to import and nothing to bind.
    fn interfaces(&self) -> Vec<(String, wit_parser::InterfaceId)> {
        let mut found = Vec::new();
        for (key, item) in &self.resolve.worlds[self.world].imports {
            let WorldItem::Interface { id, .. } = item else {
                continue;
            };
            let name = match key {
                WorldKey::Name(name) => name.clone(),
                WorldKey::Interface(id) => self.resolve.interfaces[*id]
                    .name
                    .clone()
                    .expect("an interface imported by id is named"),
            };
            if self.resolve.interfaces[*id].functions.is_empty() {
                continue;
            }
            found.push((name, *id));
        }
        found
    }

    // --- types ------------------------------------------------------------------------------

    /// Emit the lift and lower for `ty` and everything it reaches, once.
    fn emit_type(&mut self, ty: Type) {
        let Type::Id(id) = ty else { return };
        if !self.done.insert(id) {
            return;
        }
        let def = &self.resolve.types[id];
        match &def.kind {
            TypeDefKind::Record(record) => {
                for field in &record.fields {
                    self.emit_type(field.ty);
                }
                self.emit_record(id, record.clone());
            }
            TypeDefKind::Variant(variant) => {
                for case in &variant.cases {
                    if let Some(ty) = case.ty {
                        self.emit_type(ty);
                    }
                }
                self.emit_variant(id, variant.clone());
            }
            TypeDefKind::Enum(enumeration) => self.emit_enum(id, enumeration.clone()),
            TypeDefKind::Option(inner) => {
                let inner = *inner;
                self.emit_type(inner);
                self.done.remove(&id);
            }
            TypeDefKind::List(inner) => {
                let inner = *inner;
                self.emit_type(inner);
                self.done.remove(&id);
            }
            TypeDefKind::Result(result) => {
                let (ok, err) = (result.ok, result.err);
                if let Some(ok) = ok {
                    self.emit_type(ok);
                }
                if let Some(err) = err {
                    self.emit_type(err);
                }
                self.done.remove(&id);
            }
            TypeDefKind::Type(inner) => {
                let inner = *inner;
                self.emit_type(inner);
                self.done.remove(&id);
            }
            other => panic!(
                "{}: gg's membrane has grown a {other:?}, which this generator has no lowering for. \
                 Add one rather than letting the guest guess.",
                self.type_name(id),
            ),
        }
    }

    fn emit_record(&mut self, id: TypeId, record: wit_parser::Record) {
        let rust = self.rust_path(id);
        let stem = self.helper_stem(id);
        let _ = writeln!(
            self.out,
            "/// `{}` as a JavaScript object with camelCased fields.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn to_js_{stem}<'js>(ctx: &Ctx<'js>, value: {rust}) -> Result<Value<'js>> {{\n    \
             let object = Object::new(ctx.clone())?;"
        );
        for field in &record.fields {
            let js = camel(&field.name);
            let rs = snake(&field.name);
            let lowered = self.lower(field.ty, &format!("value.{rs}"));
            let _ = writeln!(self.out, "    object.set({js:?}, {lowered})?;");
        }
        let _ = writeln!(self.out, "    Ok(object.into_value())\n}}\n");

        let _ = writeln!(
            self.out,
            "/// A JavaScript object read back as `{}`.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn from_js_{stem}<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<{rust}> {{\n    \
             let object = as_object(ctx, &value, {:?})?;\n    Ok({rust} {{",
            self.type_name(id)
        );
        for field in &record.fields {
            let js = camel(&field.name);
            let rs = snake(&field.name);
            let lifted = self.lift(field.ty, &format!("field(&object, {js:?})?"));
            let _ = writeln!(self.out, "        {rs}: {lifted},");
        }
        let _ = writeln!(self.out, "    }})\n}}\n");
    }

    fn emit_variant(&mut self, id: TypeId, variant: wit_parser::Variant) {
        let rust = self.rust_path(id);
        let stem = self.helper_stem(id);
        let _ = writeln!(
            self.out,
            "/// `{}` as `{{ tag, val }}`.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn to_js_{stem}<'js>(ctx: &Ctx<'js>, value: {rust}) -> Result<Value<'js>> {{\n    \
             let object = Object::new(ctx.clone())?;\n    match value {{"
        );
        for case in &variant.cases {
            let tag = &case.name;
            let arm = pascal(&case.name);
            match case.ty {
                Some(ty) => {
                    let lowered = self.lower(ty, "payload");
                    let _ = writeln!(
                        self.out,
                        "        {rust}::{arm}(payload) => {{\n            \
                         object.set(\"tag\", {tag:?})?;\n            \
                         object.set(\"val\", {lowered})?;\n        }}"
                    );
                }
                None => {
                    let _ = writeln!(
                        self.out,
                        "        {rust}::{arm} => {{ object.set(\"tag\", {tag:?})?; }}"
                    );
                }
            }
        }
        let _ = writeln!(self.out, "    }}\n    Ok(object.into_value())\n}}\n");

        let _ = writeln!(
            self.out,
            "/// A `{{ tag, val }}` object read back as `{}`.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn from_js_{stem}<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<{rust}> {{\n    \
             let object = as_object(ctx, &value, {:?})?;\n    \
             let tag: String = from_js_string(ctx, field(&object, \"tag\")?)?;\n    \
             match tag.as_str() {{",
            self.type_name(id)
        );
        for case in &variant.cases {
            let tag = &case.name;
            let arm = pascal(&case.name);
            match case.ty {
                Some(ty) => {
                    let lifted = self.lift(ty, "field(&object, \"val\")?");
                    let _ = writeln!(self.out, "        {tag:?} => Ok({rust}::{arm}({lifted})),");
                }
                None => {
                    let _ = writeln!(self.out, "        {tag:?} => Ok({rust}::{arm}),");
                }
            }
        }
        let cases: Vec<&str> = variant.cases.iter().map(|case| case.name.as_str()).collect();
        let _ = writeln!(
            self.out,
            "        other => Err(type_error(ctx, &format!(\"{} has no case {{other:?}}; the cases \
             are {}\"))),\n    }}\n}}\n",
            self.type_name(id),
            cases.join(", "),
        );
    }

    fn emit_enum(&mut self, id: TypeId, enumeration: wit_parser::Enum) {
        let rust = self.rust_path(id);
        let stem = self.helper_stem(id);
        let _ = writeln!(
            self.out,
            "/// `{}` as the case name, spelled exactly as the WIT spells it.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn to_js_{stem}<'js>(ctx: &Ctx<'js>, value: {rust}) -> Result<Value<'js>> {{\n    \
             let text = match value {{"
        );
        for case in &enumeration.cases {
            let name = &case.name;
            let arm = pascal(&case.name);
            let _ = writeln!(self.out, "        {rust}::{arm} => {name:?},");
        }
        let _ = writeln!(
            self.out,
            "    }};\n    text.into_js(ctx)\n}}\n"
        );

        let _ = writeln!(
            self.out,
            "/// A case name read back as `{}`.",
            self.type_name(id)
        );
        let _ = writeln!(
            self.out,
            "pub fn from_js_{stem}<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> Result<{rust}> {{\n    \
             let text = from_js_string(ctx, value)?;\n    match text.as_str() {{"
        );
        for case in &enumeration.cases {
            let name = &case.name;
            let arm = pascal(&case.name);
            let _ = writeln!(self.out, "        {name:?} => Ok({rust}::{arm}),");
        }
        let cases: Vec<&str> = enumeration
            .cases
            .iter()
            .map(|case| case.name.as_str())
            .collect();
        let _ = writeln!(
            self.out,
            "        other => Err(type_error(ctx, &format!(\"{} has no case {{other:?}}; the cases \
             are {}\"))),\n    }}\n}}\n",
            self.type_name(id),
            cases.join(", "),
        );
    }

    // --- interfaces -------------------------------------------------------------------------

    fn emit_interface(&mut self, name: &str, id: wit_parser::InterfaceId) {
        let interface = self.resolve.interfaces[id].clone();
        let module = snake(name);
        let specifier = format!("test-cabinet:gg/{name}");
        let _ = writeln!(
            self.out,
            "/// The native module the SDK reaches `{specifier}` by.\n\
             ///\n\
             /// Every export is a closure over the wit-bindgen import of the same function, so a call\n\
             /// from a program crosses gg's membrane exactly as any other guest's does — same\n\
             /// capability gate, same recording bracket, same `tool-error`.\n\
             pub struct {}Module;\n",
            pascal(name)
        );
        let _ = writeln!(
            self.out,
            "impl ModuleDef for {}Module {{\n    \
             fn declare(declare: &Declarations) -> Result<()> {{",
            pascal(name)
        );
        for (function_name, _) in &interface.functions {
            let _ = writeln!(self.out, "        declare.declare({:?})?;", camel(function_name));
        }
        let _ = writeln!(self.out, "        Ok(())\n    }}\n");

        let _ = writeln!(
            self.out,
            "    fn evaluate<'js>(ctx: &Ctx<'js>, exports: &Exports<'js>) -> Result<()> {{"
        );
        for (function_name, function) in &interface.functions {
            self.emit_function(&module, function_name, function);
        }
        let _ = writeln!(self.out, "        Ok(())\n    }}\n}}\n");
    }

    fn emit_function(&mut self, module: &str, name: &str, function: &wit_parser::Function) {
        let js = camel(name);
        let rs = snake(name);
        let mut body = String::new();
        let mut call_args: Vec<String> = Vec::new();
        for (index, param) in function.params.iter().enumerate() {
            let local = snake(&param.name);
            let ty = param.ty;
            let lifted = self.lift(ty, &format!("argument(ctx, &arguments, {index})"));
            let _ = writeln!(body, "                let {local} = {lifted};");
            call_args.push(self.call_argument(ty, &local));
        }
        // The call itself, BRACKETED. What the bracket buys is stated on `crate::deadline`: gg's
        // execution timeout bounds the guest's own execution rather than wall clock, so the time a
        // program spends parked in a twenty-minute `shell` build has to be subtracted before the
        // engine's interrupt handler decides it is looping.
        //
        // A function returning nothing is called as a STATEMENT rather than bound to a name, because
        // binding a unit value is a lint everywhere this crate is compiled.
        let arguments = call_args
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        let binding = match function.result {
            Some(_) => "let outcome = ",
            None => "",
        };
        let _ = writeln!(
            body,
            "                let started = std::time::Instant::now();\n                \
             {binding}bindings::{module}::{rs}({arguments});\n                \
             crate::deadline::parked(started.elapsed());",
        );

        // A `result<_, tool-error>` is the one shape gg's membrane returns errors in, and the JS
        // mapping for it is a THROW. Everything else comes straight back.
        let completion = match function.result {
            None => "                Ok(Value::new_undefined(ctx.clone()))".to_string(),
            Some(Type::Id(id)) if matches!(self.resolve.types[id].kind, TypeDefKind::Result(_)) => {
                let TypeDefKind::Result(result) = &self.resolve.types[id].kind else {
                    unreachable!("just matched")
                };
                let (ok, err) = (result.ok, result.err);
                let err = err.expect("gg's membrane never returns a result with no error type");
                let lowered = match ok {
                    Some(ok) => self.lower(ok, "value"),
                    None => "Value::new_undefined(ctx.clone())".to_string(),
                };
                let thrown = self.lower(err, "failure");
                format!(
                    "                match outcome {{\n                    \
                     Ok(value) => {{ let _ = &value; Ok({lowered}) }}\n                    \
                     Err(failure) => {{\n                        \
                     let thrown = {thrown};\n                        \
                     Err(ctx.throw(thrown))\n                    }}\n                }}"
                )
            }
            Some(ty) => {
                let lowered = self.lower(ty, "value");
                format!("                let value = outcome;\n                Ok({lowered})")
            }
        };

        let _ = writeln!(
            self.out,
            "        {{\n            let bound = ctx.clone();\n            \
             let function = Function::new(ctx.clone(), move |arguments: Rest<Value<'js>>| \
             -> Result<Value<'js>> {{\n                \
             let ctx = &bound;\n                \
             let _ = &arguments;\n{body}{completion}\n            }})?;\n            \
             exports.export({js:?}, function)?;\n        }}"
        );
    }

    // --- expressions ------------------------------------------------------------------------

    /// A Rust expression turning `expr` (a WIT value of `ty`) into a `Value<'js>`.
    fn lower(&self, ty: Type, expr: &str) -> String {
        match ty {
            Type::Bool
            | Type::U8
            | Type::U16
            | Type::U32
            | Type::S8
            | Type::S16
            | Type::S32
            | Type::F32
            | Type::F64 => format!("({expr}).into_js(ctx)?"),
            Type::U64 => format!("big_int_u64(ctx, {expr})?"),
            Type::S64 => format!("big_int_i64(ctx, {expr})?"),
            Type::String => format!("({expr}).into_js(ctx)?"),
            Type::Char => panic!("gg's membrane has grown a `char`, which jco lowers as a string of one code point; add the lowering"),
            Type::ErrorContext => panic!("gg's membrane has grown an `error-context`; add the lowering"),
            Type::Id(id) => match &self.resolve.types[id].kind {
                TypeDefKind::Type(inner) => self.lower(*inner, expr),
                TypeDefKind::Option(inner) => {
                    let some = self.lower(*inner, "inner");
                    format!(
                        "match {expr} {{ Some(inner) => {some}, None => Value::new_undefined(ctx.clone()) }}"
                    )
                }
                TypeDefKind::List(inner) => {
                    assert!(
                        !matches!(inner, Type::U8),
                        "gg's membrane has grown a `list<u8>`, which jco lowers as a `Uint8Array` \
                         rather than an array; add the lowering"
                    );
                    let each = self.lower(*inner, "item");
                    format!(
                        "{{ let array = Array::new(ctx.clone())?; for (index, item) in ({expr}).into_iter().enumerate() {{ array.set(index, {each})?; }} array.into_value() }}"
                    )
                }
                TypeDefKind::Record(_) | TypeDefKind::Variant(_) | TypeDefKind::Enum(_) => {
                    format!("to_js_{}(ctx, {expr})?", self.helper_stem(id))
                }
                other => panic!("no lowering for {other:?}"),
            },
        }
    }

    /// A Rust expression turning `expr` (a `Value<'js>`) into a WIT value of `ty`.
    fn lift(&self, ty: Type, expr: &str) -> String {
        match ty {
            Type::Bool => format!("from_js_bool(ctx, {expr})?"),
            Type::U8 => format!("from_js_number(ctx, {expr})? as u8"),
            Type::U16 => format!("from_js_number(ctx, {expr})? as u16"),
            Type::U32 => format!("from_js_number(ctx, {expr})? as u32"),
            Type::S8 => format!("from_js_number(ctx, {expr})? as i8"),
            Type::S16 => format!("from_js_number(ctx, {expr})? as i16"),
            Type::S32 => format!("from_js_number(ctx, {expr})? as i32"),
            Type::F32 => format!("from_js_number(ctx, {expr})? as f32"),
            Type::F64 => format!("from_js_number(ctx, {expr})?"),
            Type::U64 => format!("from_js_big_int(ctx, {expr})? as u64"),
            Type::S64 => format!("from_js_big_int(ctx, {expr})? as i64"),
            Type::String => format!("from_js_string(ctx, {expr})?"),
            Type::Char => panic!("gg's membrane has grown a `char`; add the lifting"),
            Type::ErrorContext => panic!("gg's membrane has grown an `error-context`; add the lifting"),
            Type::Id(id) => match &self.resolve.types[id].kind {
                TypeDefKind::Type(inner) => self.lift(*inner, expr),
                TypeDefKind::Option(inner) => {
                    let some = self.lift(*inner, "inner");
                    format!("match absent({expr}) {{ None => None, Some(inner) => Some({some}) }}")
                }
                TypeDefKind::List(inner) => {
                    assert!(
                        !matches!(inner, Type::U8),
                        "gg's membrane has grown a `list<u8>`; add the lifting"
                    );
                    let each = self.lift(*inner, "item");
                    format!(
                        "{{ let array = as_array(ctx, {expr})?; let mut items = Vec::with_capacity(array.len()); for index in 0..array.len() {{ let item: Value<'js> = array.get(index)?; items.push({each}); }} items }}"
                    )
                }
                TypeDefKind::Record(_) | TypeDefKind::Variant(_) | TypeDefKind::Enum(_) => {
                    format!("from_js_{}(ctx, {expr})?", self.helper_stem(id))
                }
                other => panic!("no lifting for {other:?}"),
            },
        }
    }

    /// How a lifted local is handed to the `wit-bindgen` import, which owns none of its parameters.
    ///
    /// `wit-bindgen` borrows a parameter that owns a heap allocation — a `string` arrives as `&str`,
    /// a `list<T>` as `&[T]`, a record or variant as `&T` — and takes everything else by value. An
    /// `option` follows its payload, and the two borrows differ: `Option<&str>` and `Option<&[T]>`
    /// come from `as_deref`, while `Option<&Record>` comes from `as_ref`.
    fn call_argument(&self, ty: Type, local: &str) -> String {
        match self.borrow(ty) {
            Borrow::ByValue => local.to_string(),
            Borrow::Reference => format!("&{local}"),
            Borrow::OptionDeref => format!("{local}.as_deref()"),
            Borrow::OptionReference => format!("{local}.as_ref()"),
        }
    }

    /// Which of the four parameter shapes `ty` takes.
    fn borrow(&self, ty: Type) -> Borrow {
        match ty {
            Type::String => Borrow::Reference,
            Type::Id(id) => match &self.resolve.types[id].kind {
                TypeDefKind::Type(inner) => self.borrow(*inner),
                TypeDefKind::List(_) | TypeDefKind::Record(_) | TypeDefKind::Variant(_) => {
                    Borrow::Reference
                }
                TypeDefKind::Enum(_) => Borrow::ByValue,
                TypeDefKind::Option(inner) => match inner {
                    Type::String => Borrow::OptionDeref,
                    Type::Id(inner) => match &self.resolve.types[*inner].kind {
                        TypeDefKind::List(_) => Borrow::OptionDeref,
                        TypeDefKind::Record(_) | TypeDefKind::Variant(_) => Borrow::OptionReference,
                        _ => Borrow::ByValue,
                    },
                    _ => Borrow::ByValue,
                },
                other => panic!("no parameter shape for {other:?}"),
            },
            _ => Borrow::ByValue,
        }
    }

    // --- the two tables ---------------------------------------------------------------------

    /// The table `src/loader.rs` resolves a `test-cabinet:gg/<interface>` specifier through.
    fn emit_registry(&mut self, interfaces: &[(String, wit_parser::InterfaceId)]) {
        self.out.push_str(
            "/// Declare the native module a membrane specifier names, or `None` when it names none.\n\
             ///\n\
             /// One arm per interface the `sandbox` world imports, generated from the WIT itself, so a\n\
             /// family gg adds is reachable from the SDK the moment its declarations land.\n\
             pub fn declare_membrane<'js>(ctx: &Ctx<'js>, specifier: &str) -> Option<Result<Module<'js, Declared>>> {\n    \
             match specifier {\n",
        );
        for (name, _) in interfaces {
            let _ = writeln!(
                self.out,
                "        \"test-cabinet:gg/{name}\" => Some(Module::declare_def::<{}Module, _>(ctx.clone(), specifier)),",
                pascal(name)
            );
        }
        self.out.push_str("        _ => None,\n    }\n}\n\n");
    }

    /// The gg tool names this component binds — what the world's `bound-tools` export answers.
    fn emit_tool_names(&mut self, interfaces: &[(String, wit_parser::InterfaceId)]) {
        let mut names: Vec<String> = Vec::new();
        for (name, id) in interfaces {
            if NOT_TOOL_INTERFACES.contains(&name.as_str()) {
                continue;
            }
            for (function, _) in &self.resolve.interfaces[*id].functions {
                names.push(snake(function));
            }
        }
        self.out.push_str(
            "/// Every gg tool this component imports a binding for.\n\
             ///\n\
             /// Derived from the WIT rather than written down: it is exactly the functions of the\n\
             /// interfaces `NOT_TOOL_INTERFACES` (in `build.rs`) does not exclude, which is the rule the\n\
             /// WIT's own header states. gg compares it against `ALL_TOOL_NAMES` on the built artifact,\n\
             /// which is the one drift check that reads the `.wasm` rather than a source file.\n\
             pub const BOUND_TOOLS: &[&str] = &[\n",
        );
        for name in &names {
            let _ = writeln!(self.out, "    {name:?},");
        }
        self.out.push_str("];\n");
    }

    // --- naming -----------------------------------------------------------------------------

    /// The wit-bindgen path for a named type: `bindings::files::TextRead`.
    fn rust_path(&self, id: TypeId) -> String {
        let def = &self.resolve.types[id];
        let name = def.name.clone().expect("a lowered type is named");
        let owner = match def.owner {
            wit_parser::TypeOwner::Interface(interface) => self.resolve.interfaces[interface]
                .name
                .clone()
                .expect("gg's interfaces are all named"),
            other => panic!("{name} is owned by {other:?}, which this generator has no path for"),
        };
        format!("bindings::{}::{}", snake(&owner), pascal(&name))
    }

    /// The suffix of the `to_js_` / `from_js_` pair for a named type, unique across interfaces.
    fn helper_stem(&self, id: TypeId) -> String {
        let def = &self.resolve.types[id];
        let name = def.name.clone().expect("a lowered type is named");
        let owner = match def.owner {
            wit_parser::TypeOwner::Interface(interface) => self.resolve.interfaces[interface]
                .name
                .clone()
                .expect("gg's interfaces are all named"),
            other => panic!("{name} is owned by {other:?}"),
        };
        format!("{}_{}", snake(&owner), snake(&name))
    }

    /// A type's WIT name, for a message.
    fn type_name(&self, id: TypeId) -> String {
        self.resolve.types[id]
            .name
            .clone()
            .unwrap_or_else(|| "an anonymous type".to_string())
    }
}

// -------------------------------------------------------------------------------------------------
// Spelling
// -------------------------------------------------------------------------------------------------

/// `read-file` → `read_file`, the spelling `wit-bindgen` gives a Rust item.
fn snake(name: &str) -> String {
    let mut out = name.replace('-', "_");
    // `type` is the one WIT name in this membrane that is a Rust keyword; `wit-bindgen` escapes it
    // by appending an underscore, and a generated call has to spell it the same way.
    if matches!(
        out.as_str(),
        "type" | "match" | "move" | "ref" | "box" | "fn" | "loop" | "const" | "static" | "impl"
    ) {
        out.push('_');
    }
    out
}

/// `read-file` → `readFile`, the spelling jco gives a JavaScript name.
fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for ch in name.chars() {
        if ch == '-' {
            upper = true;
            continue;
        }
        if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// `read-file` → `ReadFile`, the spelling `wit-bindgen` gives a Rust type or variant.
fn pascal(name: &str) -> String {
    let camel = camel(name);
    let mut chars = camel.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => camel,
    }
}

/// What every generated file opens with.
const HEADER: &str = "\
// GENERATED by packages/gg-sandbox/guest/build.rs from crates/gg/wit/gg-sandbox.wit. Do not edit.
use rquickjs::module::{Declarations, Declared, Exports, ModuleDef};
use rquickjs::function::Rest;
use rquickjs::{Array, Ctx, Function, IntoJs, Module, Object, Result, Value};

use crate::abi::{
    absent, argument, as_array, as_object, big_int_i64, big_int_u64, field, from_js_big_int,
    from_js_bool, from_js_number, from_js_string, type_error,
};
use crate::bindings;

";
