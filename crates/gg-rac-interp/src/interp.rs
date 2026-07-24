//! The `gg-script` interpreter: a deterministic tree-walk over a parsed [`Ast`],
//! with tool calls routed to a [`ToolHost`].
//!
//! The runtime value of the language *is* a [`serde_json::Value`] — literals, tool
//! arguments, and tool results are all JSON — so the interpreter inherits exact JSON
//! semantics and speaks the same units as the [host](crate) across the wasm ABI.
//!
//! ## Determinism and termination
//!
//! The walk is fully deterministic: no clock, no randomness, and map iteration is in
//! sorted key order (`serde_json`'s default `BTreeMap` backing). Termination is
//! guaranteed by a [step budget](RunConfig::step_limit) — every statement and every
//! loop iteration spends one step, and exhausting the budget stops the program with a
//! [`RuntimeError`] rather than looping forever. This is the interpreter's *own*
//! backstop; the wasm host additionally caps the guest with a wasmtime fuel ceiling,
//! so even a budget the guest failed to honour cannot run away.
//!
//! ## The tool seam
//!
//! A call to any name the interpreter does not recognise as a [builtin](builtins) is
//! a **tool call**: the interpreter evaluates its single map argument and hands
//! `(name, args)` to the [`ToolHost`], which returns the tool's result as a JSON
//! value the script can branch on. This is the one impure surface — everything else
//! is pure computation — and it is a trait so the interpreter is unit-tested natively
//! against a mock host with no wasm and no container.

use serde_json::{Map, Number, Value};

use crate::parser::{Access, Ast, BinOp, Expr, LValue, Stmt, UnOp};

/// The impure boundary: a script's tool call reaches the outside world only through
/// this trait. The interpreter evaluates the tool's arguments and hands them here;
/// the implementation performs the call and returns its result as a JSON value the
/// script sees.
///
/// The returned value is passed straight back into the script, so by convention it is
/// the `{ "ok": bool, "output": string, "summary": string|null }` shape gg's
/// [`ToolOutcome`](../../gg) serialises to — letting a script branch on `result.ok`
/// and read `result.output`. A tool *error* is therefore an ordinary value
/// (`ok == false`), which is how a failed call surfaces *into* the program rather than
/// aborting it.
pub trait ToolHost {
    /// Perform the tool call `name(args)` and return its result value.
    fn call_tool(&mut self, name: &str, args: &Value) -> Value;
}

/// The knobs a run is bounded by.
#[derive(Debug, Clone, Copy)]
pub struct RunConfig {
    /// The maximum number of steps (statements executed + loop iterations) before the
    /// run is stopped with a [`RuntimeErrorKind::StepLimit`] error. The interpreter's
    /// hard termination guarantee, independent of the host's fuel ceiling.
    pub step_limit: u64,
}

impl Default for RunConfig {
    /// A generous default step budget (1,000,000 steps) — ample for composing tool
    /// calls with real control flow, while still bounding a runaway `while (true)`.
    fn default() -> Self {
        Self {
            step_limit: 1_000_000,
        }
    }
}

/// The category of a [`RuntimeError`], so a caller can tell a runaway program
/// (`StepLimit`) from an ordinary bug (`Message`) without string-matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeErrorKind {
    /// A type error, an unbound variable, an out-of-range index, a division by zero —
    /// an ordinary program fault, carried with a human-readable message.
    Message,
    /// The [step budget](RunConfig::step_limit) was exhausted — the interpreter's hard
    /// termination guarantee tripped.
    StepLimit,
}

/// Why a run stopped early. A [`ToolHost`] error is *not* one of these — it is an
/// ordinary value the script receives; a [`RuntimeError`] is a fault in the program
/// itself (or the budget backstop).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    /// The category of the fault.
    pub kind: RuntimeErrorKind,
    /// A human-readable explanation.
    pub message: String,
}

impl RuntimeError {
    fn msg(message: impl Into<String>) -> Self {
        Self {
            kind: RuntimeErrorKind::Message,
            message: message.into(),
        }
    }
}

/// The result of running a program: its return value (or the fault that stopped it),
/// the `print` log it emitted, and the number of steps it took.
#[derive(Debug, Clone, PartialEq)]
pub struct RunOutcome {
    /// The program's `return` value (`null` if it ran off the end without returning),
    /// or the [`RuntimeError`] that stopped it.
    pub result: Result<Value, RuntimeError>,
    /// The lines the program emitted via `print(..)`, in order.
    pub logs: Vec<String>,
    /// The number of steps the run consumed.
    pub steps: u64,
}

/// Run a parsed program against `host` under `config`. Never panics: a program fault
/// is returned as [`RunOutcome::result`] `Err`, and a tool error is an ordinary value.
pub fn run(ast: &Ast, host: &mut dyn ToolHost, config: RunConfig) -> RunOutcome {
    let mut interp = Interpreter {
        host,
        config,
        steps: 0,
        scopes: vec![Map::new()],
        logs: Vec::new(),
    };
    let result = match interp.exec_block(&ast.body) {
        Ok(Flow::Return(value)) => Ok(value),
        Ok(Flow::Normal) => Ok(Value::Null),
        Err(error) => Err(error),
    };
    RunOutcome {
        result,
        logs: interp.logs,
        steps: interp.steps,
    }
}

/// The control-flow signal a statement (or block) produces: keep going, or unwind to
/// the top with a `return` value.
enum Flow {
    Normal,
    Return(Value),
}

struct Interpreter<'h> {
    host: &'h mut dyn ToolHost,
    config: RunConfig,
    steps: u64,
    /// A stack of lexical scopes (`let` binds into the innermost; a read/assignment
    /// searches outward). Blocks (`if`/`while`/`for` bodies) push and pop a scope.
    scopes: Vec<Map<String, Value>>,
    logs: Vec<String>,
}

impl Interpreter<'_> {
    /// Charge one step against the budget, failing the run if it is exhausted.
    fn tick(&mut self) -> Result<(), RuntimeError> {
        self.steps += 1;
        if self.steps > self.config.step_limit {
            return Err(RuntimeError {
                kind: RuntimeErrorKind::StepLimit,
                message: format!(
                    "step budget of {} exhausted (possible runaway loop)",
                    self.config.step_limit
                ),
            });
        }
        Ok(())
    }

    /// Execute a block of statements in a fresh child scope, popped on exit.
    fn exec_block(&mut self, body: &[Stmt]) -> Result<Flow, RuntimeError> {
        self.scopes.push(Map::new());
        let result = self.exec_stmts(body);
        self.scopes.pop();
        result
    }

    /// Execute statements in the *current* scope (the block scope is managed by the
    /// caller), short-circuiting on a `return`.
    fn exec_stmts(&mut self, body: &[Stmt]) -> Result<Flow, RuntimeError> {
        for stmt in body {
            if let Flow::Return(value) = self.exec_stmt(stmt)? {
                return Ok(Flow::Return(value));
            }
        }
        Ok(Flow::Normal)
    }

    fn exec_stmt(&mut self, stmt: &Stmt) -> Result<Flow, RuntimeError> {
        self.tick()?;
        match stmt {
            Stmt::Let { name, value } => {
                let value = self.eval(value)?;
                self.bind(name, value);
                Ok(Flow::Normal)
            }
            Stmt::Assign { target, value } => {
                let value = self.eval(value)?;
                self.assign(target, value)?;
                Ok(Flow::Normal)
            }
            Stmt::Expr(expr) => {
                self.eval(expr)?;
                Ok(Flow::Normal)
            }
            Stmt::If {
                condition,
                then_body,
                else_body,
            } => {
                if truthy(&self.eval(condition)?) {
                    self.exec_block(then_body)
                } else if let Some(else_body) = else_body {
                    self.exec_block(else_body)
                } else {
                    Ok(Flow::Normal)
                }
            }
            Stmt::While { condition, body } => {
                while truthy(&self.eval(condition)?) {
                    self.tick()?;
                    if let Flow::Return(value) = self.exec_block(body)? {
                        return Ok(Flow::Return(value));
                    }
                }
                Ok(Flow::Normal)
            }
            Stmt::For {
                var,
                iterable,
                body,
            } => self.exec_for(var, iterable, body),
            Stmt::Return(expr) => {
                let value = match expr {
                    Some(expr) => self.eval(expr)?,
                    None => Value::Null,
                };
                Ok(Flow::Return(value))
            }
        }
    }

    fn exec_for(
        &mut self,
        var: &str,
        iterable: &Expr,
        body: &[Stmt],
    ) -> Result<Flow, RuntimeError> {
        let iterable = self.eval(iterable)?;
        let items = self.iter_items(&iterable)?;
        for item in items {
            self.tick()?;
            // Each iteration runs in its own scope with the loop variable bound.
            self.scopes.push(Map::new());
            self.bind(var, item);
            let flow = self.exec_stmts(body);
            self.scopes.pop();
            if let Flow::Return(value) = flow? {
                return Ok(Flow::Return(value));
            }
        }
        Ok(Flow::Normal)
    }

    /// The elements a `for` loop iterates: a list's items, or a map's entries as
    /// `[key, value]` pairs (in sorted key order). Anything else is a type error.
    fn iter_items(&self, value: &Value) -> Result<Vec<Value>, RuntimeError> {
        match value {
            Value::Array(items) => Ok(items.clone()),
            Value::Object(map) => Ok(map
                .iter()
                .map(|(k, v)| Value::Array(vec![Value::String(k.clone()), v.clone()]))
                .collect()),
            other => Err(RuntimeError::msg(format!(
                "`for` expects a list or map to iterate, got {}",
                type_name(other)
            ))),
        }
    }

    // ---- variables & assignment --------------------------------------------------

    /// Bind `name` in the innermost scope (a `let`, or a loop variable).
    fn bind(&mut self, name: &str, value: Value) {
        self.scopes
            .last_mut()
            .expect("at least one scope is always present")
            .insert(name.to_string(), value);
    }

    /// Read a variable, searching scopes innermost-first.
    fn lookup(&self, name: &str) -> Result<Value, RuntimeError> {
        for scope in self.scopes.iter().rev() {
            if let Some(value) = scope.get(name) {
                return Ok(value.clone());
            }
        }
        Err(RuntimeError::msg(format!("`{name}` is not defined")))
    }

    /// Assign into an existing variable (or an element/field of one). The root
    /// variable must already exist — assignment never declares (that is `let`).
    fn assign(&mut self, target: &LValue, value: Value) -> Result<(), RuntimeError> {
        // Resolve the accessor path to concrete keys/indices first (evaluating any
        // index expressions) so the mutable borrow of the variable is brief.
        let steps = self.resolve_path(&target.path)?;

        let scope_index = self
            .scopes
            .iter()
            .rposition(|scope| scope.contains_key(&target.root))
            .ok_or_else(|| {
                RuntimeError::msg(format!(
                    "cannot assign to `{}`: it is not defined (use `let` first)",
                    target.root
                ))
            })?;
        let slot = self.scopes[scope_index]
            .get_mut(&target.root)
            .expect("presence just checked");

        assign_into(slot, &steps, value)
    }

    /// Evaluate an accessor path into concrete [`PathStep`]s (map keys or list
    /// indices).
    fn resolve_path(&mut self, path: &[Access]) -> Result<Vec<PathStep>, RuntimeError> {
        let mut steps = Vec::with_capacity(path.len());
        for access in path {
            match access {
                Access::Field(name) => steps.push(PathStep::Key(name.clone())),
                Access::Index(expr) => {
                    let index = self.eval(expr)?;
                    steps.push(index_to_step(&index)?);
                }
            }
        }
        Ok(steps)
    }

    // ---- expression evaluation ---------------------------------------------------

    fn eval(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        match expr {
            Expr::Null => Ok(Value::Null),
            Expr::Bool(b) => Ok(Value::Bool(*b)),
            Expr::Number(n) => number_value(*n),
            Expr::Str(s) => Ok(Value::String(s.clone())),
            Expr::Var(name) => self.lookup(name),
            Expr::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    out.push(self.eval(item)?);
                }
                Ok(Value::Array(out))
            }
            Expr::Map(entries) => {
                let mut map = Map::new();
                for (key, value_expr) in entries {
                    let value = self.eval(value_expr)?;
                    map.insert(key.clone(), value);
                }
                Ok(Value::Object(map))
            }
            Expr::Unary(op, inner) => {
                let value = self.eval(inner)?;
                eval_unary(*op, value)
            }
            Expr::Binary(op, left, right) => self.eval_binary(*op, left, right),
            Expr::Index(base, index) => {
                let base = self.eval(base)?;
                let index = self.eval(index)?;
                index_value(&base, &index)
            }
            Expr::Field(base, name) => {
                let base = self.eval(base)?;
                index_value(&base, &Value::String(name.clone()))
            }
            Expr::Call(name, args) => self.eval_call(name, args),
        }
    }

    fn eval_binary(&mut self, op: BinOp, left: &Expr, right: &Expr) -> Result<Value, RuntimeError> {
        // Short-circuit the logical operators before evaluating the right operand.
        match op {
            BinOp::And => {
                let left = self.eval(left)?;
                if !truthy(&left) {
                    return Ok(Value::Bool(false));
                }
                return Ok(Value::Bool(truthy(&self.eval(right)?)));
            }
            BinOp::Or => {
                let left = self.eval(left)?;
                if truthy(&left) {
                    return Ok(Value::Bool(true));
                }
                return Ok(Value::Bool(truthy(&self.eval(right)?)));
            }
            _ => {}
        }

        let left = self.eval(left)?;
        let right = self.eval(right)?;
        eval_arith_or_compare(op, &left, &right)
    }

    fn eval_call(&mut self, name: &str, args: &[Expr]) -> Result<Value, RuntimeError> {
        // A recognised builtin runs in-guest; anything else is a host tool call.
        if builtins::is_builtin(name) {
            let mut values = Vec::with_capacity(args.len());
            for arg in args {
                values.push(self.eval(arg)?);
            }
            return builtins::call(self, name, values);
        }

        // Tool call convention: at most one argument, a map of arguments (or nothing,
        // meaning an empty argument object).
        let tool_args = match args {
            [] => Value::Object(Map::new()),
            [only] => self.eval(only)?,
            _ => {
                return Err(RuntimeError::msg(format!(
                    "tool `{name}` takes a single arguments map, but {} were given",
                    args.len()
                )));
            }
        };
        if !matches!(tool_args, Value::Object(_) | Value::Null) {
            return Err(RuntimeError::msg(format!(
                "tool `{name}` arguments must be a map, got {}",
                type_name(&tool_args)
            )));
        }
        Ok(self.host.call_tool(name, &tool_args))
    }

    /// Append a line to the program's `print` log (used by the `print` builtin).
    fn log(&mut self, line: String) {
        self.logs.push(line);
    }
}

/// A resolved assignment path step: a map key or a list index.
enum PathStep {
    Key(String),
    Index(usize),
}

/// Navigate `slot` along `steps` and store `value` at the end, growing/mutating maps
/// and lists as needed.
fn assign_into(slot: &mut Value, steps: &[PathStep], value: Value) -> Result<(), RuntimeError> {
    let Some((first, rest)) = steps.split_first() else {
        *slot = value;
        return Ok(());
    };
    match first {
        PathStep::Key(key) => {
            let map = as_object_mut(slot, key)?;
            let entry = map.entry(key.clone()).or_insert(Value::Null);
            assign_into(entry, rest, value)
        }
        PathStep::Index(index) => {
            let list = match slot {
                Value::Array(list) => list,
                other => {
                    return Err(RuntimeError::msg(format!(
                        "cannot index into {} with `[{index}]` during assignment",
                        type_name(other)
                    )));
                }
            };
            let length = list.len();
            let element = list.get_mut(*index).ok_or_else(|| {
                RuntimeError::msg(format!(
                    "index {index} is out of range for a list of length {length}"
                ))
            })?;
            assign_into(element, rest, value)
        }
    }
}

/// Borrow `slot` as an object for a keyed assignment, initialising a `null` slot to an
/// empty map so `let m = null; m.k = 1` (or building up a fresh map) works.
fn as_object_mut<'a>(
    slot: &'a mut Value,
    key: &str,
) -> Result<&'a mut Map<String, Value>, RuntimeError> {
    if slot.is_null() {
        *slot = Value::Object(Map::new());
    }
    match slot {
        Value::Object(map) => Ok(map),
        other => Err(RuntimeError::msg(format!(
            "cannot set field `{key}` on {}",
            type_name(other)
        ))),
    }
}

fn index_to_step(index: &Value) -> Result<PathStep, RuntimeError> {
    match index {
        Value::String(key) => Ok(PathStep::Key(key.clone())),
        Value::Number(_) => Ok(PathStep::Index(as_index(index)?)),
        other => Err(RuntimeError::msg(format!(
            "an index must be a string (map key) or number (list index), got {}",
            type_name(other)
        ))),
    }
}

// ---- pure value operations -------------------------------------------------------

/// Whether a value is "truthy" for a condition: `false`/`null`/`0`/`""`/empty
/// list/empty map are falsy; everything else is truthy.
pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

/// A short name for a value's type, for diagnostics.
pub(crate) fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "list",
        Value::Object(_) => "map",
    }
}

/// Build a numeric [`Value`] from an `f64`, failing on a non-finite result (a division
/// by zero or an overflow to infinity, so the fault surfaces rather than producing a
/// `null`).
pub(crate) fn number_value(n: f64) -> Result<Value, RuntimeError> {
    Number::from_f64(n)
        .map(Value::Number)
        .ok_or_else(|| RuntimeError::msg("arithmetic produced a non-finite number".to_string()))
}

/// A value's numeric content as `f64`, or `None` if it is not a number.
pub(crate) fn as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// Coerce a value to a non-negative list index, rejecting fractional or negative
/// numbers.
fn as_index(value: &Value) -> Result<usize, RuntimeError> {
    let n = as_f64(value).ok_or_else(|| {
        RuntimeError::msg(format!("index must be a number, got {}", type_name(value)))
    })?;
    if n.fract() != 0.0 || n < 0.0 {
        return Err(RuntimeError::msg(format!(
            "index must be a non-negative whole number, got {n}"
        )));
    }
    Ok(n as usize)
}

fn eval_unary(op: UnOp, value: Value) -> Result<Value, RuntimeError> {
    match op {
        UnOp::Not => Ok(Value::Bool(!truthy(&value))),
        UnOp::Neg => {
            let n = as_f64(&value)
                .ok_or_else(|| RuntimeError::msg(format!("cannot negate {}", type_name(&value))))?;
            number_value(-n)
        }
    }
}

/// Evaluate a non-short-circuit binary operator over two already-evaluated operands.
fn eval_arith_or_compare(op: BinOp, left: &Value, right: &Value) -> Result<Value, RuntimeError> {
    match op {
        BinOp::Eq => Ok(Value::Bool(values_equal(left, right))),
        BinOp::Ne => Ok(Value::Bool(!values_equal(left, right))),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => compare(op, left, right),
        BinOp::Add => eval_add(left, right),
        BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem => eval_numeric(op, left, right),
        BinOp::And | BinOp::Or => {
            unreachable!("logical operators are short-circuited before evaluation")
        }
    }
}

/// `+`: numeric addition, string concatenation (stringifying the other operand), or
/// list concatenation.
fn eval_add(left: &Value, right: &Value) -> Result<Value, RuntimeError> {
    match (left, right) {
        (Value::Number(_), Value::Number(_)) => {
            number_value(as_f64(left).unwrap() + as_f64(right).unwrap())
        }
        (Value::Array(a), Value::Array(b)) => {
            let mut out = a.clone();
            out.extend(b.iter().cloned());
            Ok(Value::Array(out))
        }
        (Value::String(_), _) | (_, Value::String(_)) => Ok(Value::String(format!(
            "{}{}",
            stringify(left),
            stringify(right)
        ))),
        _ => Err(RuntimeError::msg(format!(
            "cannot add {} and {}",
            type_name(left),
            type_name(right)
        ))),
    }
}

/// `- * / %` over two numbers.
fn eval_numeric(op: BinOp, left: &Value, right: &Value) -> Result<Value, RuntimeError> {
    let a = as_f64(left).ok_or_else(|| numeric_operand_error(op, left))?;
    let b = as_f64(right).ok_or_else(|| numeric_operand_error(op, right))?;
    let result = match op {
        BinOp::Sub => a - b,
        BinOp::Mul => a * b,
        BinOp::Div => {
            if b == 0.0 {
                return Err(RuntimeError::msg("division by zero"));
            }
            a / b
        }
        BinOp::Rem => {
            if b == 0.0 {
                return Err(RuntimeError::msg("remainder by zero"));
            }
            a % b
        }
        _ => unreachable!("eval_numeric only handles - * / %"),
    };
    number_value(result)
}

fn numeric_operand_error(op: BinOp, value: &Value) -> RuntimeError {
    RuntimeError::msg(format!(
        "operator `{}` needs numbers, got {}",
        op_symbol(op),
        type_name(value)
    ))
}

fn op_symbol(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::And => "&&",
        BinOp::Or => "||",
    }
}

/// `< <= > >=`: numeric ordering, or lexicographic ordering for two strings.
fn compare(op: BinOp, left: &Value, right: &Value) -> Result<Value, RuntimeError> {
    let ordering = match (left, right) {
        (Value::Number(_), Value::Number(_)) => as_f64(left)
            .unwrap()
            .partial_cmp(&as_f64(right).unwrap())
            .ok_or_else(|| RuntimeError::msg("cannot compare non-finite numbers"))?,
        (Value::String(a), Value::String(b)) => a.cmp(b),
        _ => {
            return Err(RuntimeError::msg(format!(
                "cannot compare {} with `{}` to {}",
                type_name(left),
                op_symbol(op),
                type_name(right)
            )));
        }
    };
    let result = match op {
        BinOp::Lt => ordering.is_lt(),
        BinOp::Le => ordering.is_le(),
        BinOp::Gt => ordering.is_gt(),
        BinOp::Ge => ordering.is_ge(),
        _ => unreachable!("compare only handles < <= > >="),
    };
    Ok(Value::Bool(result))
}

/// Structural equality that compares numbers by their `f64` value (so `1` and `1.0`,
/// or a script number and an integer from a tool result, are equal) and recurses
/// through lists and maps.
pub(crate) fn values_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(_), Value::Number(_)) => match (as_f64(left), as_f64(right)) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        },
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| values_equal(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|other| values_equal(v, other)))
        }
        _ => left == right,
    }
}

/// Index a value: a list by a numeric index, or a map by a string key. An out-of-range
/// list index is an error; a missing map key yields `null` (so `has`/`get` are not
/// mandatory for optional fields).
fn index_value(base: &Value, index: &Value) -> Result<Value, RuntimeError> {
    match base {
        Value::Array(items) => {
            let i = as_index(index)?;
            items.get(i).cloned().ok_or_else(|| {
                RuntimeError::msg(format!(
                    "index {i} is out of range for a list of length {}",
                    items.len()
                ))
            })
        }
        Value::Object(map) => {
            let key = match index {
                Value::String(key) => key.clone(),
                other => {
                    return Err(RuntimeError::msg(format!(
                        "a map is indexed by a string key, got {}",
                        type_name(other)
                    )));
                }
            };
            Ok(map.get(&key).cloned().unwrap_or(Value::Null))
        }
        other => Err(RuntimeError::msg(format!(
            "cannot index into {}",
            type_name(other)
        ))),
    }
}

/// Render a value as a plain string: strings as themselves, everything else as its
/// compact JSON form. Used by `+` string concatenation and the `str` builtin.
pub(crate) fn stringify(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// The interpreter's pure builtin functions — string/collection helpers and `print`.
/// Everything not named here is a host tool call.
mod builtins {
    use super::{Interpreter, RuntimeError, Value, as_f64, number_value, stringify, type_name};

    /// The builtin names, so [`Interpreter::eval_call`](super::Interpreter::eval_call)
    /// can route a call to a builtin or fall through to a tool call.
    const NAMES: &[&str] = &[
        "len", "keys", "values", "has", "get", "push", "range", "str", "num", "contains", "type",
        "print",
    ];

    pub(super) fn is_builtin(name: &str) -> bool {
        NAMES.contains(&name)
    }

    /// Invoke builtin `name` with already-evaluated `args`.
    pub(super) fn call(
        interp: &mut Interpreter,
        name: &str,
        args: Vec<Value>,
    ) -> Result<Value, RuntimeError> {
        match name {
            "len" => len(&args),
            "keys" => keys(&args),
            "values" => values(&args),
            "has" => has(&args),
            "get" => get(&args),
            "push" => push(&args),
            "range" => range(&args),
            "str" => Ok(Value::String(stringify(arg(&args, 0, "str")?))),
            "num" => num(&args),
            "contains" => contains(&args),
            "type" => Ok(Value::String(type_name(arg(&args, 0, "type")?).to_string())),
            "print" => {
                interp.log(stringify(arg(&args, 0, "print")?));
                Ok(Value::Null)
            }
            other => Err(RuntimeError::msg(format!("unknown builtin `{other}`"))),
        }
    }

    /// The `n`th argument, or an arity error naming the builtin.
    fn arg<'a>(args: &'a [Value], n: usize, name: &str) -> Result<&'a Value, RuntimeError> {
        args.get(n).ok_or_else(|| {
            RuntimeError::msg(format!(
                "`{name}` needs at least {} argument(s), got {}",
                n + 1,
                args.len()
            ))
        })
    }

    fn len(args: &[Value]) -> Result<Value, RuntimeError> {
        let value = arg(args, 0, "len")?;
        let n = match value {
            Value::String(s) => s.chars().count(),
            Value::Array(items) => items.len(),
            Value::Object(map) => map.len(),
            other => {
                return Err(RuntimeError::msg(format!(
                    "`len` needs a string, list, or map, got {}",
                    type_name(other)
                )));
            }
        };
        number_value(n as f64)
    }

    fn keys(args: &[Value]) -> Result<Value, RuntimeError> {
        match arg(args, 0, "keys")? {
            Value::Object(map) => Ok(Value::Array(
                map.keys().map(|k| Value::String(k.clone())).collect(),
            )),
            other => Err(RuntimeError::msg(format!(
                "`keys` needs a map, got {}",
                type_name(other)
            ))),
        }
    }

    fn values(args: &[Value]) -> Result<Value, RuntimeError> {
        match arg(args, 0, "values")? {
            Value::Object(map) => Ok(Value::Array(map.values().cloned().collect())),
            other => Err(RuntimeError::msg(format!(
                "`values` needs a map, got {}",
                type_name(other)
            ))),
        }
    }

    fn has(args: &[Value]) -> Result<Value, RuntimeError> {
        let container = arg(args, 0, "has")?;
        let key = arg(args, 1, "has")?;
        let present = match container {
            Value::Object(map) => match key {
                Value::String(k) => map.contains_key(k),
                _ => false,
            },
            Value::Array(items) => match as_f64(key) {
                Some(n) if n >= 0.0 && n.fract() == 0.0 => (n as usize) < items.len(),
                _ => false,
            },
            other => {
                return Err(RuntimeError::msg(format!(
                    "`has` needs a map or list, got {}",
                    type_name(other)
                )));
            }
        };
        Ok(Value::Bool(present))
    }

    /// `get(container, key)` or `get(container, key, default)` — a safe access that
    /// returns the default (or `null`) for a missing key/out-of-range index.
    fn get(args: &[Value]) -> Result<Value, RuntimeError> {
        let container = arg(args, 0, "get")?;
        let key = arg(args, 1, "get")?;
        let default = args.get(2).cloned().unwrap_or(Value::Null);
        let found = match container {
            Value::Object(map) => match key {
                Value::String(k) => map.get(k).cloned(),
                _ => None,
            },
            Value::Array(items) => match as_f64(key) {
                Some(n) if n >= 0.0 && n.fract() == 0.0 => items.get(n as usize).cloned(),
                _ => None,
            },
            other => {
                return Err(RuntimeError::msg(format!(
                    "`get` needs a map or list, got {}",
                    type_name(other)
                )));
            }
        };
        Ok(found.unwrap_or(default))
    }

    /// `push(list, value)` — returns a *new* list with `value` appended (values are
    /// immutable; the caller rebinds).
    fn push(args: &[Value]) -> Result<Value, RuntimeError> {
        let list = arg(args, 0, "push")?;
        let value = arg(args, 1, "push")?.clone();
        match list {
            Value::Array(items) => {
                let mut out = items.clone();
                out.push(value);
                Ok(Value::Array(out))
            }
            other => Err(RuntimeError::msg(format!(
                "`push` needs a list, got {}",
                type_name(other)
            ))),
        }
    }

    /// `range(n)` → `[0, 1, .., n-1]`; `range(a, b)` → `[a, .., b-1]`.
    fn range(args: &[Value]) -> Result<Value, RuntimeError> {
        let (start, end) = match args {
            [n] => (0.0, whole(n, "range")?),
            [a, b] => (whole(a, "range")?, whole(b, "range")?),
            _ => {
                return Err(RuntimeError::msg(format!(
                    "`range` takes 1 or 2 numbers, got {}",
                    args.len()
                )));
            }
        };
        let mut out = Vec::new();
        let mut i = start;
        while i < end {
            out.push(number_value(i)?);
            i += 1.0;
        }
        Ok(Value::Array(out))
    }

    /// `num(x)` — parse a string to a number, or pass a number through. A non-numeric
    /// string is an error.
    fn num(args: &[Value]) -> Result<Value, RuntimeError> {
        match arg(args, 0, "num")? {
            Value::Number(n) => Ok(Value::Number(n.clone())),
            Value::String(s) => s
                .trim()
                .parse::<f64>()
                .map_err(|_| RuntimeError::msg(format!("`num` could not parse `{s}`")))
                .and_then(number_value),
            other => Err(RuntimeError::msg(format!(
                "`num` needs a number or string, got {}",
                type_name(other)
            ))),
        }
    }

    /// `contains(haystack, needle)` — substring test for strings, membership test for
    /// lists.
    fn contains(args: &[Value]) -> Result<Value, RuntimeError> {
        let haystack = arg(args, 0, "contains")?;
        let needle = arg(args, 1, "contains")?;
        match haystack {
            Value::String(s) => match needle {
                Value::String(sub) => Ok(Value::Bool(s.contains(sub.as_str()))),
                other => Err(RuntimeError::msg(format!(
                    "`contains` on a string needs a string needle, got {}",
                    type_name(other)
                ))),
            },
            Value::Array(items) => Ok(Value::Bool(
                items.iter().any(|item| super::values_equal(item, needle)),
            )),
            other => Err(RuntimeError::msg(format!(
                "`contains` needs a string or list, got {}",
                type_name(other)
            ))),
        }
    }

    /// A numeric argument coerced to a whole `f64`, rejecting fractional values.
    fn whole(value: &Value, name: &str) -> Result<f64, RuntimeError> {
        let n = as_f64(value).ok_or_else(|| {
            RuntimeError::msg(format!("`{name}` needs a number, got {}", type_name(value)))
        })?;
        if n.fract() != 0.0 {
            return Err(RuntimeError::msg(format!(
                "`{name}` needs a whole number, got {n}"
            )));
        }
        Ok(n)
    }
}

#[cfg(test)]
#[path = "interp.test.rs"]
mod tests;
