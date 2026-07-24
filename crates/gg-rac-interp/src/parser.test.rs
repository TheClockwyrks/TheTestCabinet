//! Parser unit tests.

use super::{Access, BinOp, Expr, Stmt, UnOp};
use crate::lexer::lex;

/// Parse a whole program, panicking with the parse error on failure.
fn parse_ok(source: &str) -> Vec<Stmt> {
    let tokens = lex(source).expect("source lexes");
    super::parse(&tokens).expect("source parses").body
}

/// Parse a source that is a single `return EXPR;` and hand back the expression, so
/// expression-shape assertions stay terse.
fn parse_expr(source: &str) -> Expr {
    let body = parse_ok(&format!("return {source};"));
    match body.into_iter().next() {
        Some(Stmt::Return(Some(expr))) => expr,
        other => panic!("expected a single return statement, got {other:?}"),
    }
}

#[test]
fn parses_let_and_return() {
    let body = parse_ok("let x = 1; return x;");
    assert_eq!(
        body,
        vec![
            Stmt::Let {
                name: "x".into(),
                value: Expr::Number(1.0),
            },
            Stmt::Return(Some(Expr::Var("x".into()))),
        ]
    );
}

#[test]
fn arithmetic_precedence_binds_multiplication_tighter_than_addition() {
    // 1 + 2 * 3  ==  1 + (2 * 3)
    let expr = parse_expr("1 + 2 * 3");
    assert_eq!(
        expr,
        Expr::Binary(
            BinOp::Add,
            Box::new(Expr::Number(1.0)),
            Box::new(Expr::Binary(
                BinOp::Mul,
                Box::new(Expr::Number(2.0)),
                Box::new(Expr::Number(3.0)),
            )),
        )
    );
}

#[test]
fn logical_and_binds_tighter_than_or() {
    // a || b && c  ==  a || (b && c)
    let expr = parse_expr("a || b && c");
    match expr {
        Expr::Binary(BinOp::Or, left, right) => {
            assert_eq!(*left, Expr::Var("a".into()));
            assert!(matches!(*right, Expr::Binary(BinOp::And, _, _)));
        }
        other => panic!("expected an `||` at the root, got {other:?}"),
    }
}

#[test]
fn unary_minus_and_not() {
    assert_eq!(
        parse_expr("-x"),
        Expr::Unary(UnOp::Neg, Box::new(Expr::Var("x".into())))
    );
    assert_eq!(
        parse_expr("!flag"),
        Expr::Unary(UnOp::Not, Box::new(Expr::Var("flag".into())))
    );
}

#[test]
fn a_bare_identifier_call_is_a_call_expression() {
    let expr = parse_expr(r#"read_file({ path: "README.md" })"#);
    match expr {
        Expr::Call(name, args) => {
            assert_eq!(name, "read_file");
            assert_eq!(args.len(), 1);
            assert!(matches!(args[0], Expr::Map(_)));
        }
        other => panic!("expected a call, got {other:?}"),
    }
}

#[test]
fn index_and_field_postfix_chain() {
    // items[0].name → Field(Index(Var, 0), "name")
    let expr = parse_expr("items[0].name");
    match expr {
        Expr::Field(base, name) => {
            assert_eq!(name, "name");
            assert!(matches!(*base, Expr::Index(_, _)));
        }
        other => panic!("expected a field access, got {other:?}"),
    }
}

#[test]
fn nested_lvalue_assignment_parses() {
    let body = parse_ok("result[0].count = 3;");
    match body.into_iter().next() {
        Some(Stmt::Assign { target, .. }) => {
            assert_eq!(target.root, "result");
            assert_eq!(
                target.path,
                vec![
                    Access::Index(Expr::Number(0.0)),
                    Access::Field("count".into())
                ]
            );
        }
        other => panic!("expected an assignment, got {other:?}"),
    }
}

#[test]
fn if_else_if_chain() {
    let body = parse_ok("if a { return 1; } else if b { return 2; } else { return 3; }");
    match &body[0] {
        Stmt::If {
            else_body: Some(else_body),
            ..
        } => {
            // The `else if` becomes a single nested `if` statement in the else body.
            assert_eq!(else_body.len(), 1);
            assert!(matches!(else_body[0], Stmt::If { .. }));
        }
        other => panic!("expected an if with an else, got {other:?}"),
    }
}

#[test]
fn while_and_for_loops() {
    let body = parse_ok("while x { x = 0; } for item in list { print(item); }");
    assert!(matches!(body[0], Stmt::While { .. }));
    match &body[1] {
        Stmt::For { var, .. } => assert_eq!(var, "item"),
        other => panic!("expected a for loop, got {other:?}"),
    }
}

#[test]
fn assigning_to_a_non_lvalue_is_an_error() {
    let tokens = lex("1 + 2 = 3;").expect("lexes");
    let err = super::parse(&tokens).expect_err("assigning to an expression is rejected");
    assert!(err.message.contains("left-hand side"));
}

#[test]
fn a_keyword_cannot_be_a_variable_name() {
    let tokens = lex("let while = 1;").expect("lexes");
    assert!(super::parse(&tokens).is_err());
}

#[test]
fn a_missing_semicolon_is_an_error_not_a_panic() {
    let tokens = lex("let x = 1").expect("lexes");
    let err = super::parse(&tokens).expect_err("a missing `;` is rejected");
    assert!(err.message.contains(';') || err.message.contains("ended"));
}
