//! The `gg-script` parser: a [`Token`] stream → an [`Ast`] (a flat list of
//! [`Stmt`]) the [interpreter](crate::interp) walks.
//!
//! It is a hand-written recursive-descent parser with the conventional
//! precedence-climbing expression grammar (see the crate [README](../README.md) for
//! the full grammar). Keyword classification happens here rather than in the
//! [lexer](crate::lexer): a bare word token becomes a [`Stmt::Let`]/`If`/`While`/…
//! when it is one of the reserved words, and a [`Expr::Var`] (or a
//! [`Expr::Call`] when followed by `(`) otherwise.
//!
//! Every failure is a [`ParseError`] with the offending token's byte offset, never a
//! panic — a malformed program is surfaced to the model, not trapped on.

use std::fmt;

use crate::lexer::{Token, TokenKind};

/// A parsed program: the ordered statements of its top-level block.
#[derive(Debug, Clone, PartialEq)]
pub struct Ast {
    /// The program's statements, run in order.
    pub body: Vec<Stmt>,
}

/// One statement.
#[derive(Debug, Clone, PartialEq)]
pub enum Stmt {
    /// `let NAME = EXPR;` — bind a new variable in the current scope.
    Let { name: String, value: Expr },
    /// `LVALUE = EXPR;` — assign to an existing variable, or to an element/field of
    /// one (`a[i] = x`, `m.k = x`).
    Assign { target: LValue, value: Expr },
    /// `EXPR;` — evaluate an expression for its effect (typically a tool call) and
    /// discard its value.
    Expr(Expr),
    /// `if COND { .. } else { .. }` — the `else` arm is optional and may itself be a
    /// single `if` block (an `else if` chain).
    If {
        condition: Expr,
        then_body: Vec<Stmt>,
        else_body: Option<Vec<Stmt>>,
    },
    /// `while COND { .. }` — repeat the body while `COND` is truthy (bounded by the
    /// interpreter's step budget).
    While { condition: Expr, body: Vec<Stmt> },
    /// `for NAME in ITER { .. }` — iterate the elements of a list (or the entries of
    /// a map, as `[key, value]` pairs), binding each to `NAME`.
    For {
        var: String,
        iterable: Expr,
        body: Vec<Stmt>,
    },
    /// `return EXPR;` or `return;` — end the program with the given value (or `null`).
    Return(Option<Expr>),
}

/// The left-hand side of an assignment: a root variable and a (possibly empty) chain
/// of element/field accessors into it.
#[derive(Debug, Clone, PartialEq)]
pub struct LValue {
    /// The root variable being assigned into.
    pub root: String,
    /// The accessor chain — empty for a plain `NAME = ..`, otherwise the nested
    /// element/field path (`a[i].k` is `[Index(i), Field("k")]`).
    pub path: Vec<Access>,
}

/// One step of an assignment or read accessor chain.
#[derive(Debug, Clone, PartialEq)]
pub enum Access {
    /// `[EXPR]` — a list index or a map key computed at runtime.
    Index(Expr),
    /// `.NAME` — a map key given literally (sugar for `["NAME"]`).
    Field(String),
}

/// One expression.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    /// The `null` literal.
    Null,
    /// A `true`/`false` literal.
    Bool(bool),
    /// A numeric literal.
    Number(f64),
    /// A string literal.
    Str(String),
    /// A list literal `[a, b, ..]`.
    List(Vec<Expr>),
    /// A map literal `{ key: value, .. }` (keys are bare identifiers or string
    /// literals).
    Map(Vec<(String, Expr)>),
    /// A variable reference.
    Var(String),
    /// A unary operation (`-x`, `!x`).
    Unary(UnOp, Box<Expr>),
    /// A binary operation (`a + b`, `a == b`, `a && b`, …).
    Binary(BinOp, Box<Expr>, Box<Expr>),
    /// An element access `base[index]`.
    Index(Box<Expr>, Box<Expr>),
    /// A field access `base.name` (sugar for `base["name"]`).
    Field(Box<Expr>, String),
    /// A call `name(args..)` — resolved at runtime to a builtin or, failing that, a
    /// host tool call.
    Call(String, Vec<Expr>),
}

/// A unary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnOp {
    /// Arithmetic negation `-x`.
    Neg,
    /// Logical negation `!x` (over truthiness).
    Not,
}

/// A binary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    /// `+` (numeric add, string concat, or list concat).
    Add,
    /// `-`
    Sub,
    /// `*`
    Mul,
    /// `/`
    Div,
    /// `%`
    Rem,
    /// `==` (structural equality).
    Eq,
    /// `!=`
    Ne,
    /// `<`
    Lt,
    /// `<=`
    Le,
    /// `>`
    Gt,
    /// `>=`
    Ge,
    /// `&&` (short-circuit over truthiness, yields a bool).
    And,
    /// `||` (short-circuit over truthiness, yields a bool).
    Or,
}

/// Why parsing failed — with the byte offset of the offending token (or the end of
/// input).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// The byte offset the fault anchors to.
    pub offset: usize,
    /// A human-readable explanation.
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "parse error at byte {}: {}", self.offset, self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parse a whole program from its `tokens` into an [`Ast`].
pub fn parse(tokens: &[Token]) -> Result<Ast, ParseError> {
    let mut parser = Parser { tokens, pos: 0 };
    let body = parser.parse_block_until_eof()?;
    Ok(Ast { body })
}

/// The reserved words the parser recognises; a bare word matching one of these is a
/// keyword, anything else is a variable or call name.
const KEYWORDS: &[&str] = &[
    "let", "if", "else", "while", "for", "in", "return", "true", "false", "null",
];

/// Whether `word` is a reserved keyword (so it cannot be used as a variable/tool
/// name).
pub fn is_keyword(word: &str) -> bool {
    KEYWORDS.contains(&word)
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl<'a> Parser<'a> {
    /// Parse statements until the token stream is exhausted (the top-level program
    /// block).
    fn parse_block_until_eof(&mut self) -> Result<Vec<Stmt>, ParseError> {
        let mut body = Vec::new();
        while self.pos < self.tokens.len() {
            body.push(self.parse_stmt()?);
        }
        Ok(body)
    }

    /// Parse a brace-delimited block `{ stmt* }`, consuming both braces.
    fn parse_braced_block(&mut self) -> Result<Vec<Stmt>, ParseError> {
        self.expect(&TokenKind::LBrace, "`{`")?;
        let mut body = Vec::new();
        while !self.check(&TokenKind::RBrace) {
            if self.pos >= self.tokens.len() {
                return Err(self.eof_error("`}` to close the block"));
            }
            body.push(self.parse_stmt()?);
        }
        self.expect(&TokenKind::RBrace, "`}`")?;
        Ok(body)
    }

    fn parse_stmt(&mut self) -> Result<Stmt, ParseError> {
        if let Some(TokenKind::Ident(word)) = self.peek_kind() {
            match word.as_str() {
                "let" => return self.parse_let(),
                "if" => return self.parse_if(),
                "while" => return self.parse_while(),
                "for" => return self.parse_for(),
                "return" => return self.parse_return(),
                _ => {}
            }
        }
        self.parse_expr_or_assign_stmt()
    }

    fn parse_let(&mut self) -> Result<Stmt, ParseError> {
        self.advance(); // `let`
        let name = self.expect_name("a variable name after `let`")?;
        self.expect(&TokenKind::Assign, "`=`")?;
        let value = self.parse_expr()?;
        self.expect(&TokenKind::Semicolon, "`;`")?;
        Ok(Stmt::Let { name, value })
    }

    fn parse_if(&mut self) -> Result<Stmt, ParseError> {
        self.advance(); // `if`
        let condition = self.parse_expr()?;
        let then_body = self.parse_braced_block()?;
        let else_body = if self.check_keyword("else") {
            self.advance(); // `else`
            if self.check_keyword("if") {
                // `else if ..` — a nested if statement as the sole else-body stmt.
                Some(vec![self.parse_if()?])
            } else {
                Some(self.parse_braced_block()?)
            }
        } else {
            None
        };
        Ok(Stmt::If {
            condition,
            then_body,
            else_body,
        })
    }

    fn parse_while(&mut self) -> Result<Stmt, ParseError> {
        self.advance(); // `while`
        let condition = self.parse_expr()?;
        let body = self.parse_braced_block()?;
        Ok(Stmt::While { condition, body })
    }

    fn parse_for(&mut self) -> Result<Stmt, ParseError> {
        self.advance(); // `for`
        let var = self.expect_name("a loop variable after `for`")?;
        if !self.check_keyword("in") {
            return Err(self.here_error("`in` after the `for` loop variable"));
        }
        self.advance(); // `in`
        let iterable = self.parse_expr()?;
        let body = self.parse_braced_block()?;
        Ok(Stmt::For {
            var,
            iterable,
            body,
        })
    }

    fn parse_return(&mut self) -> Result<Stmt, ParseError> {
        self.advance(); // `return`
        if self.check(&TokenKind::Semicolon) {
            self.advance();
            return Ok(Stmt::Return(None));
        }
        let value = self.parse_expr()?;
        self.expect(&TokenKind::Semicolon, "`;`")?;
        Ok(Stmt::Return(Some(value)))
    }

    /// Parse either an assignment (`LVALUE = EXPR;`) or a bare expression statement
    /// (`EXPR;`). Both begin by parsing an expression; the trailing `=` (if present)
    /// promotes it to an assignment, its target validated as an l-value.
    fn parse_expr_or_assign_stmt(&mut self) -> Result<Stmt, ParseError> {
        let start_offset = self.here_offset();
        let expr = self.parse_expr()?;
        if self.check(&TokenKind::Assign) {
            self.advance(); // `=`
            let target = expr_to_lvalue(&expr).ok_or_else(|| ParseError {
                offset: start_offset,
                message: "the left-hand side of `=` is not an assignable variable, index, or field"
                    .to_string(),
            })?;
            let value = self.parse_expr()?;
            self.expect(&TokenKind::Semicolon, "`;`")?;
            Ok(Stmt::Assign { target, value })
        } else {
            self.expect(&TokenKind::Semicolon, "`;` to end the statement")?;
            Ok(Stmt::Expr(expr))
        }
    }

    // ---- expression grammar (precedence climbing) --------------------------------

    fn parse_expr(&mut self) -> Result<Expr, ParseError> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_and()?;
        while self.check(&TokenKind::Or) {
            self.advance();
            let right = self.parse_and()?;
            left = Expr::Binary(BinOp::Or, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_equality()?;
        while self.check(&TokenKind::And) {
            self.advance();
            let right = self.parse_equality()?;
            left = Expr::Binary(BinOp::And, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_equality(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_comparison()?;
        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Eq) => BinOp::Eq,
                Some(TokenKind::Ne) => BinOp::Ne,
                _ => break,
            };
            self.advance();
            let right = self.parse_comparison()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_comparison(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_additive()?;
        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Lt) => BinOp::Lt,
                Some(TokenKind::Le) => BinOp::Le,
                Some(TokenKind::Gt) => BinOp::Gt,
                Some(TokenKind::Ge) => BinOp::Ge,
                _ => break,
            };
            self.advance();
            let right = self.parse_additive()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_additive(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Plus) => BinOp::Add,
                Some(TokenKind::Minus) => BinOp::Sub,
                _ => break,
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, ParseError> {
        let mut left = self.parse_unary()?;
        loop {
            let op = match self.peek_kind() {
                Some(TokenKind::Star) => BinOp::Mul,
                Some(TokenKind::Slash) => BinOp::Div,
                Some(TokenKind::Percent) => BinOp::Rem,
                _ => break,
            };
            self.advance();
            let right = self.parse_unary()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr, ParseError> {
        match self.peek_kind() {
            Some(TokenKind::Minus) => {
                self.advance();
                Ok(Expr::Unary(UnOp::Neg, Box::new(self.parse_unary()?)))
            }
            Some(TokenKind::Bang) => {
                self.advance();
                Ok(Expr::Unary(UnOp::Not, Box::new(self.parse_unary()?)))
            }
            _ => self.parse_postfix(),
        }
    }

    /// Parse a primary expression and any trailing postfix accessors (`[i]`, `.name`).
    /// A call `name(..)` is recognised in [`parse_primary`] when a bare identifier is
    /// immediately followed by `(`.
    fn parse_postfix(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.parse_primary()?;
        loop {
            match self.peek_kind() {
                Some(TokenKind::LBracket) => {
                    self.advance();
                    let index = self.parse_expr()?;
                    self.expect(&TokenKind::RBracket, "`]`")?;
                    expr = Expr::Index(Box::new(expr), Box::new(index));
                }
                Some(TokenKind::Dot) => {
                    self.advance();
                    let name = self.expect_name("a field name after `.`")?;
                    expr = Expr::Field(Box::new(expr), name);
                }
                _ => break,
            }
        }
        Ok(expr)
    }

    fn parse_primary(&mut self) -> Result<Expr, ParseError> {
        let token = self.peek().ok_or_else(|| self.eof_error("an expression"))?;
        let offset = token.offset;
        match &token.kind {
            TokenKind::Number(value) => {
                let value = *value;
                self.advance();
                Ok(Expr::Number(value))
            }
            TokenKind::Str(value) => {
                let value = value.clone();
                self.advance();
                Ok(Expr::Str(value))
            }
            TokenKind::LParen => {
                self.advance();
                let inner = self.parse_expr()?;
                self.expect(&TokenKind::RParen, "`)`")?;
                Ok(inner)
            }
            TokenKind::LBracket => self.parse_list_literal(),
            TokenKind::LBrace => self.parse_map_literal(),
            TokenKind::Ident(word) => {
                let word = word.clone();
                match word.as_str() {
                    "true" => {
                        self.advance();
                        Ok(Expr::Bool(true))
                    }
                    "false" => {
                        self.advance();
                        Ok(Expr::Bool(false))
                    }
                    "null" => {
                        self.advance();
                        Ok(Expr::Null)
                    }
                    _ if is_keyword(&word) => Err(ParseError {
                        offset,
                        message: format!("unexpected keyword `{word}` in expression position"),
                    }),
                    _ => {
                        self.advance();
                        if self.check(&TokenKind::LParen) {
                            let args = self.parse_call_args()?;
                            Ok(Expr::Call(word, args))
                        } else {
                            Ok(Expr::Var(word))
                        }
                    }
                }
            }
            other => Err(ParseError {
                offset,
                message: format!("unexpected token {other:?} where an expression was expected"),
            }),
        }
    }

    fn parse_call_args(&mut self) -> Result<Vec<Expr>, ParseError> {
        self.expect(&TokenKind::LParen, "`(`")?;
        let mut args = Vec::new();
        if !self.check(&TokenKind::RParen) {
            loop {
                args.push(self.parse_expr()?);
                if self.check(&TokenKind::Comma) {
                    self.advance();
                    // Allow a trailing comma before `)`.
                    if self.check(&TokenKind::RParen) {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect(&TokenKind::RParen, "`)` to close the argument list")?;
        Ok(args)
    }

    fn parse_list_literal(&mut self) -> Result<Expr, ParseError> {
        self.expect(&TokenKind::LBracket, "`[`")?;
        let mut items = Vec::new();
        if !self.check(&TokenKind::RBracket) {
            loop {
                items.push(self.parse_expr()?);
                if self.check(&TokenKind::Comma) {
                    self.advance();
                    if self.check(&TokenKind::RBracket) {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect(&TokenKind::RBracket, "`]` to close the list")?;
        Ok(Expr::List(items))
    }

    fn parse_map_literal(&mut self) -> Result<Expr, ParseError> {
        self.expect(&TokenKind::LBrace, "`{`")?;
        let mut entries = Vec::new();
        if !self.check(&TokenKind::RBrace) {
            loop {
                let key = self.parse_map_key()?;
                self.expect(&TokenKind::Colon, "`:` after a map key")?;
                let value = self.parse_expr()?;
                entries.push((key, value));
                if self.check(&TokenKind::Comma) {
                    self.advance();
                    if self.check(&TokenKind::RBrace) {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect(&TokenKind::RBrace, "`}` to close the map")?;
        Ok(Expr::Map(entries))
    }

    /// A map key is a bare identifier (including a keyword, treated as a plain name
    /// here) or a string literal.
    fn parse_map_key(&mut self) -> Result<String, ParseError> {
        match self.peek_kind() {
            Some(TokenKind::Ident(word)) => {
                let word = word.clone();
                self.advance();
                Ok(word)
            }
            Some(TokenKind::Str(value)) => {
                let value = value.clone();
                self.advance();
                Ok(value)
            }
            _ => Err(self.here_error("a map key (an identifier or string)")),
        }
    }

    // ---- token cursor helpers ----------------------------------------------------

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn peek_kind(&self) -> Option<&TokenKind> {
        self.peek().map(|t| &t.kind)
    }

    fn advance(&mut self) -> Option<&Token> {
        let token = self.tokens.get(self.pos);
        if token.is_some() {
            self.pos += 1;
        }
        token
    }

    fn check(&self, kind: &TokenKind) -> bool {
        self.peek_kind() == Some(kind)
    }

    fn check_keyword(&self, word: &str) -> bool {
        matches!(self.peek_kind(), Some(TokenKind::Ident(w)) if w == word)
    }

    fn expect(&mut self, kind: &TokenKind, what: &str) -> Result<(), ParseError> {
        if self.check(kind) {
            self.advance();
            Ok(())
        } else {
            Err(self.here_error(what))
        }
    }

    fn expect_name(&mut self, what: &str) -> Result<String, ParseError> {
        match self.peek_kind() {
            Some(TokenKind::Ident(word)) if !is_keyword(word) => {
                let word = word.clone();
                self.advance();
                Ok(word)
            }
            _ => Err(self.here_error(what)),
        }
    }

    fn here_offset(&self) -> usize {
        self.peek()
            .map(|t| t.offset)
            .unwrap_or_else(|| self.tokens.last().map(|t| t.offset).unwrap_or(0))
    }

    fn here_error(&self, expected: &str) -> ParseError {
        match self.peek() {
            Some(token) => ParseError {
                offset: token.offset,
                message: format!("expected {expected}, found {:?}", token.kind),
            },
            None => self.eof_error(expected),
        }
    }

    fn eof_error(&self, expected: &str) -> ParseError {
        ParseError {
            offset: self.tokens.last().map(|t| t.offset).unwrap_or(0),
            message: format!("expected {expected}, but the program ended"),
        }
    }
}

/// Convert an expression into an assignable [`LValue`] (a root variable with a chain
/// of `[..]`/`.name` accessors), or `None` if it is not a valid assignment target.
fn expr_to_lvalue(expr: &Expr) -> Option<LValue> {
    let mut path = Vec::new();
    let mut cursor = expr;
    loop {
        match cursor {
            Expr::Var(name) => {
                path.reverse();
                return Some(LValue {
                    root: name.clone(),
                    path,
                });
            }
            Expr::Index(base, index) => {
                path.push(Access::Index((**index).clone()));
                cursor = base;
            }
            Expr::Field(base, name) => {
                path.push(Access::Field(name.clone()));
                cursor = base;
            }
            _ => return None,
        }
    }
}

#[cfg(test)]
#[path = "parser.test.rs"]
mod tests;
