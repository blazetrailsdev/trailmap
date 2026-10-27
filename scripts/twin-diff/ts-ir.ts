/**
 * TypeScript front-end of the twin diff: lowers a trailmap source file into
 * the node kinds `ruby-ir.rb` emits, so both sides of a pair are compared in
 * one vocabulary.
 *
 * The lowering decides each JS spelling of a Ruby construct once, here:
 * `await` is dropped, `this.x` and a bare Ruby call both have a `self`
 * receiver, a property read is a zero-argument call (a Ruby reader is one), a
 * trailing arrow function is the call's block, `for…of` is `each`, `throw` is
 * `raise`, `new K(…)` is `K.new(…)`, and `x?.y` is a safe call. Anything with
 * no Ruby shape lowers to `{ k: "unhandled" }` with its syntax kind, and the
 * diff counts it rather than guessing.
 */
import ts from "typescript";
import type { N } from "./ir.ts";

export function lowerTsFile(file: string, text: string): N {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const line = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const seq = (body: N[]): N => ({ k: "seq", body });
  const call = (
    recv: N | null,
    name: string,
    args: N[],
    n: ts.Node,
    block: N | null = null,
    safe = false,
  ): N => ({
    k: "call",
    recv,
    name,
    args,
    block,
    safe,
    l: line(n),
  });

  const isUpper = (s: string) => /^[A-Z]/.test(s);

  function stmts(
    list: readonly ts.Statement[] | ts.NodeArray<ts.Statement>,
  ): N[] {
    const out: N[] = [];
    for (const s of list) {
      const x = stmt(s);
      if (x) out.push(...(Array.isArray(x) ? x : [x]));
    }
    return out;
  }

  function block(b: ts.Node | undefined): N {
    if (!b) return seq([]);
    if (ts.isBlock(b)) return seq(stmts(b.statements));
    const s = stmt(b as ts.Statement);
    return seq(s ? (Array.isArray(s) ? s : [s]) : []);
  }

  function params(ps: ts.NodeArray<ts.ParameterDeclaration>) {
    return ps
      .filter((p) => !(ts.isIdentifier(p.name) && p.name.text === "this"))
      .map((p) => {
        const name = ts.isIdentifier(p.name) ? p.name.text : null;
        const destructure = ts.isObjectBindingPattern(p.name)
          ? p.name.elements.map((e) =>
              ts.isIdentifier(e.name) ? e.name.text : null,
            )
          : undefined;
        return {
          kind: p.dotDotDotToken
            ? "rest"
            : p.initializer || p.questionToken
              ? "opt"
              : "req",
          name,
          default: p.initializer ? expr(p.initializer) : undefined,
          destructure,
        };
      });
  }

  function fn(n: ts.FunctionLikeDeclaration): N {
    return {
      k: "block",
      params: params(n.parameters),
      body: n.body ? block(n.body) : seq([]),
    };
  }

  function modifiers(n: ts.Node) {
    const mods = ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : [];
    const has = (k: ts.SyntaxKind) => mods.some((m) => m.kind === k);
    return {
      isStatic: has(ts.SyntaxKind.StaticKeyword),
      isPrivate:
        has(ts.SyntaxKind.PrivateKeyword) ||
        has(ts.SyntaxKind.ProtectedKeyword),
      isDeclare: has(ts.SyntaxKind.DeclareKeyword),
      isExport: has(ts.SyntaxKind.ExportKeyword),
    };
  }

  function memberName(n: ts.PropertyName | ts.BindingName): string {
    if (
      ts.isIdentifier(n) ||
      ts.isStringLiteral(n) ||
      ts.isPrivateIdentifier(n)
    )
      return n.text.replace(/^#/, "");
    return n.getText(sf);
  }

  function classDecl(n: ts.ClassDeclaration | ts.ClassExpression): N {
    const heritage = n.heritageClauses?.find(
      (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
    );
    const body: N[] = [];
    for (const m of n.members) {
      const mod = modifiers(m);
      if (ts.isClassStaticBlockDeclaration(m)) {
        body.push(...stmts(m.body.statements));
      } else if (
        ts.isMethodDeclaration(m) ||
        ts.isGetAccessor(m) ||
        ts.isSetAccessor(m)
      ) {
        const name = memberName(m.name) + (ts.isSetAccessor(m) ? "=" : "");
        body.push({
          k: "def",
          name,
          singleton: mod.isStatic,
          private: mod.isPrivate,
          getter: ts.isGetAccessor(m),
          params: params(m.parameters),
          body: m.body ? block(m.body) : seq([]),
          l: line(m),
        });
      } else if (ts.isConstructorDeclaration(m)) {
        body.push({
          k: "def",
          name: "initialize",
          singleton: false,
          private: false,
          params: params(m.parameters),
          body: block(m.body),
          l: line(m),
        });
      } else if (ts.isPropertyDeclaration(m)) {
        const name = memberName(m.name);
        if (mod.isDeclare || !m.initializer) {
          body.push({ k: "tsdecl", name, static: mod.isStatic, l: line(m) });
        } else if (
          m.initializer &&
          (ts.isArrowFunction(m.initializer) ||
            ts.isFunctionExpression(m.initializer))
        ) {
          const f = fn(m.initializer);
          body.push({
            k: "def",
            name,
            singleton: mod.isStatic,
            private: mod.isPrivate,
            params: f.params,
            body: f.body,
            l: line(m),
          });
        } else if (mod.isStatic && isUpper(name)) {
          body.push({
            k: "casgn",
            path: [name],
            value: expr(m.initializer),
            l: line(m),
          });
        } else {
          body.push({
            k: "tsfield",
            name,
            static: mod.isStatic,
            value: expr(m.initializer),
            l: line(m),
          });
        }
      }
    }
    return {
      k: "class",
      path: [n.name?.text ?? "(anonymous)"],
      superclass: heritage ? expr(heritage.types[0].expression) : null,
      body: seq(body),
      l: line(n),
    };
  }

  function stmt(s: ts.Statement | ts.Node): N | N[] | null {
    if (
      ts.isImportDeclaration(s) ||
      ts.isExportDeclaration(s) ||
      ts.isEmptyStatement(s)
    )
      return null;
    if (
      ts.isInterfaceDeclaration(s) ||
      (ts.isTypeAliasDeclaration(s) && ts.isTypeLiteralNode(s.type))
    ) {
      const members = ts.isInterfaceDeclaration(s)
        ? s.members
        : (s.type as ts.TypeLiteralNode).members;
      return {
        k: "tsinterface",
        name: s.name.text,
        members: members.filter((m) => m.name).map((m) => memberName(m.name!)),
        l: line(s),
      };
    }
    if (ts.isTypeAliasDeclaration(s)) return null;
    if (ts.isClassDeclaration(s)) return classDecl(s);
    if (ts.isFunctionDeclaration(s)) {
      const mod = modifiers(s);
      return {
        k: "def",
        name: s.name?.text ?? "(anonymous)",
        singleton: true,
        private: !mod.isExport,
        toplevel: true,
        params: params(s.parameters),
        body: block(s.body),
        l: line(s),
      };
    }
    if (ts.isVariableStatement(s)) {
      const out: N[] = [];
      const exported = modifiers(s).isExport;
      for (const d of s.declarationList.declarations) {
        const name = memberName(d.name);
        const init = d.initializer;
        if (
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          exported
        ) {
          const f = fn(init);
          out.push({
            k: "def",
            name,
            singleton: true,
            toplevel: true,
            params: f.params,
            body: f.body,
            l: line(d),
          });
        } else if (
          exported ||
          (isUpper(name) && !ts.isFunctionLike(s.parent))
        ) {
          out.push({
            k: "casgn",
            path: [name],
            value: init ? expr(init) : { k: "nil" },
            l: line(d),
          });
        } else if (
          ts.isObjectBindingPattern(d.name) ||
          ts.isArrayBindingPattern(d.name)
        ) {
          out.push({
            k: "masgn",
            targets: d.name.elements.map((e) =>
              ts.isBindingElement(e) && ts.isIdentifier(e.name)
                ? { k: "lasgn", name: e.name.text }
                : { k: "unhandled" },
            ),
            value: init ? expr(init) : { k: "nil" },
            l: line(d),
          });
        } else {
          out.push({
            k: "lasgn",
            name,
            value: init ? expr(init) : { k: "nil" },
            l: line(d),
          });
        }
      }
      return out;
    }
    if (ts.isExpressionStatement(s)) return expr(s.expression);
    if (ts.isReturnStatement(s))
      return {
        k: "return",
        value: s.expression ? expr(s.expression) : null,
        l: line(s),
      };
    if (ts.isThrowStatement(s)) return raise(s.expression, s);
    if (ts.isIfStatement(s))
      return {
        k: "if",
        cond: expr(s.expression),
        then: block(s.thenStatement),
        else: s.elseStatement ? block(s.elseStatement) : null,
        l: line(s),
      };
    if (ts.isBlock(s)) return stmts(s.statements);
    if (ts.isForOfStatement(s) || ts.isForInStatement(s)) {
      const init = s.initializer;
      const names = ts.isVariableDeclarationList(init)
        ? init.declarations.flatMap((d) =>
            ts.isIdentifier(d.name)
              ? [d.name.text]
              : (
                  d.name.elements as ts.NodeArray<
                    ts.BindingElement | ts.OmittedExpression
                  >
                ).map((e) =>
                  ts.isBindingElement(e) && ts.isIdentifier(e.name)
                    ? e.name.text
                    : "_",
                ),
          )
        : [init.getText(sf)];
      const recv = ts.isForInStatement(s)
        ? call(expr(s.expression), "keys", [], s)
        : expr(s.expression);
      return call(recv, "each", [], s, {
        k: "block",
        params: names.map((name) => ({ kind: "req", name })),
        body: block(s.statement),
      });
    }
    if (ts.isForStatement(s) || ts.isWhileStatement(s) || ts.isDoStatement(s))
      return {
        k: "while",
        cond:
          "expression" in s && s.expression
            ? expr(s.expression)
            : { k: "true" },
        body: block(s.statement),
        l: line(s),
      };
    if (ts.isTryStatement(s))
      return {
        k: "begin",
        body: block(s.tryBlock),
        rescues: s.catchClause
          ? [
              {
                classes: [],
                var:
                  s.catchClause.variableDeclaration?.name.getText(sf) ?? null,
                body: block(s.catchClause.block),
              },
            ]
          : [],
        ensure: s.finallyBlock ? block(s.finallyBlock) : null,
        l: line(s),
      };
    if (ts.isSwitchStatement(s))
      return {
        k: "case",
        subject: expr(s.expression),
        whens: s.caseBlock.clauses
          .filter(ts.isCaseClause)
          .map((c) => ({
            conds: [expr(c.expression)],
            body: seq(stmts(c.statements)),
          })),
        else: (() => {
          const d = s.caseBlock.clauses.find(ts.isDefaultClause);
          return d ? seq(stmts(d.statements)) : null;
        })(),
        l: line(s),
      };
    if (ts.isBreakStatement(s)) return { k: "break" };
    if (ts.isContinueStatement(s)) return { k: "next" };
    return { k: "unhandled", node: ts.SyntaxKind[s.kind], l: line(s) };
  }

  function raise(e: ts.Expression, at: ts.Node): N {
    if (ts.isNewExpression(e))
      return call(
        null,
        "raise",
        [expr(e.expression), ...(e.arguments ?? []).map(expr)],
        at,
      );
    return call(null, "raise", [expr(e)], at);
  }

  function args(
    list: readonly ts.Expression[] | undefined,
    n: ts.Node,
  ): { args: N[]; block: N | null } {
    const xs = [...(list ?? [])];
    let blk: N | null = null;
    const last = xs[xs.length - 1];
    if (last && (ts.isArrowFunction(last) || ts.isFunctionExpression(last))) {
      xs.pop();
      blk = fn(last);
    }
    void n;
    return {
      args: xs.map((a) =>
        ts.isObjectLiteralExpression(a) ? kwargs(a) : expr(a),
      ),
      block: blk,
    };
  }

  function kwargs(o: ts.ObjectLiteralExpression): N {
    return { ...hash(o), k: "kwargs" };
  }

  function hash(o: ts.ObjectLiteralExpression): N {
    return {
      k: "hash",
      pairs: o.properties.map((p) => {
        if (ts.isPropertyAssignment(p))
          return {
            key: { k: "sym", value: memberName(p.name) },
            value: expr(p.initializer),
          };
        if (ts.isShorthandPropertyAssignment(p))
          return {
            key: { k: "sym", value: p.name.text },
            value: { k: "lvar", name: p.name.text },
          };
        if (ts.isSpreadAssignment(p))
          return { key: { k: "splat" }, value: expr(p.expression) };
        if (ts.isMethodDeclaration(p))
          return { key: { k: "sym", value: memberName(p.name) }, value: fn(p) };
        return { key: { k: "unhandled" }, value: { k: "unhandled" } };
      }),
    };
  }

  const BINOPS: Partial<Record<ts.SyntaxKind, string>> = {
    [ts.SyntaxKind.PlusToken]: "+",
    [ts.SyntaxKind.MinusToken]: "-",
    [ts.SyntaxKind.AsteriskToken]: "*",
    [ts.SyntaxKind.SlashToken]: "/",
    [ts.SyntaxKind.PercentToken]: "%",
    [ts.SyntaxKind.LessThanToken]: "<",
    [ts.SyntaxKind.LessThanEqualsToken]: "<=",
    [ts.SyntaxKind.GreaterThanToken]: ">",
    [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
    [ts.SyntaxKind.EqualsEqualsToken]: "==",
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: "==",
    [ts.SyntaxKind.ExclamationEqualsToken]: "!=",
    [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!=",
    [ts.SyntaxKind.AsteriskAsteriskToken]: "**",
    [ts.SyntaxKind.InKeyword]: "key?",
    [ts.SyntaxKind.InstanceOfKeyword]: "is_a?",
  };

  function assignTarget(t: ts.Expression, value: N, n: ts.Node): N {
    if (ts.isIdentifier(t))
      return { k: "lasgn", name: t.text, value, l: line(n) };
    if (ts.isPropertyAccessExpression(t)) {
      const recv = expr(t.expression);
      if (recv.k === "self")
        return { k: "iasgn", name: t.name.text, value, l: line(n) };
      return call(recv, `${t.name.text}=`, [value], n);
    }
    if (ts.isElementAccessExpression(t))
      return call(
        expr(t.expression),
        "[]=",
        [expr(t.argumentExpression), value],
        n,
      );
    return { k: "unhandled", node: ts.SyntaxKind[t.kind], l: line(n) };
  }

  function expr(e: ts.Expression | ts.Node): N {
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e)
    )
      return expr(e.expression);
    if (ts.isAwaitExpression(e)) return expr(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
      return { k: "str", value: e.text };
    if (ts.isNumericLiteral(e)) {
      const v = Number(e.text.replace(/_/g, ""));
      return Number.isInteger(v)
        ? { k: "int", value: v }
        : { k: "float", value: v };
    }
    if (ts.isTemplateExpression(e))
      return {
        k: "dstr",
        parts: [
          ...(e.head.text ? [{ k: "str", value: e.head.text }] : []),
          ...e.templateSpans.flatMap((sp) => [
            expr(sp.expression),
            ...(sp.literal.text ? [{ k: "str", value: sp.literal.text }] : []),
          ]),
        ],
      };
    if (ts.isRegularExpressionLiteral(e)) return { k: "regex", value: e.text };
    if (e.kind === ts.SyntaxKind.TrueKeyword) return { k: "true" };
    if (e.kind === ts.SyntaxKind.FalseKeyword) return { k: "false" };
    if (e.kind === ts.SyntaxKind.NullKeyword) return { k: "nil" };
    if (e.kind === ts.SyntaxKind.ThisKeyword) return { k: "self" };
    if (e.kind === ts.SyntaxKind.SuperKeyword) return { k: "super", args: [] };
    if (ts.isIdentifier(e)) {
      if (e.text === "undefined") return { k: "nil" };
      return isUpper(e.text)
        ? { k: "const", path: [e.text] }
        : { k: "lvar", name: e.text };
    }
    if (ts.isArrayLiteralExpression(e))
      return {
        k: "array",
        elems: e.elements.map((x) =>
          ts.isSpreadElement(x)
            ? { k: "splat", value: expr(x.expression) }
            : expr(x),
        ),
      };
    if (ts.isObjectLiteralExpression(e)) return hash(e);
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e))
      return { ...fn(e), k: "lambda" };
    if (ts.isConditionalExpression(e))
      return {
        k: "if",
        cond: expr(e.condition),
        then: expr(e.whenTrue),
        else: expr(e.whenFalse),
        l: line(e),
      };
    if (ts.isPrefixUnaryExpression(e)) {
      if (e.operator === ts.SyntaxKind.ExclamationToken)
        return { k: "not", value: expr(e.operand) };
      if (
        e.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(e.operand)
      ) {
        const v = expr(e.operand);
        return { ...v, value: -v.value };
      }
      return call(expr(e.operand), `${ts.tokenToString(e.operator)}@`, [], e);
    }
    if (ts.isPostfixUnaryExpression(e))
      return {
        k: "opasgn",
        op: e.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-",
        target: expr(e.operand),
        value: { k: "int", value: 1 },
      };
    if (ts.isTypeOfExpression(e))
      return call(expr(e.expression), "class", [], e);
    if (ts.isSpreadElement(e)) return { k: "splat", value: expr(e.expression) };
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken)
        return { k: "and", left: expr(e.left), right: expr(e.right) };
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      )
        return {
          k: "or",
          left: expr(e.left),
          right: expr(e.right),
          nullish: op === ts.SyntaxKind.QuestionQuestionToken,
        };
      if (op === ts.SyntaxKind.EqualsToken)
        return assignTarget(e.left, expr(e.right), e);
      if (
        op >= ts.SyntaxKind.FirstCompoundAssignment &&
        op <= ts.SyntaxKind.LastCompoundAssignment
      )
        return {
          k: "opasgn",
          op: e.operatorToken.getText(sf).replace(/=$/, ""),
          target: expr(e.left),
          value: expr(e.right),
        };
      const name = BINOPS[op];
      if (name === "!=")
        return {
          k: "not",
          value: call(expr(e.left), "==", [expr(e.right)], e),
        };
      if (name === "key?")
        return call(expr(e.right), "key?", [expr(e.left)], e);
      if (name) return call(expr(e.left), name, [expr(e.right)], e);
      return { k: "unhandled", node: ts.SyntaxKind[op], l: line(e) };
    }
    if (ts.isNewExpression(e)) {
      const a = args(e.arguments, e);
      return call(expr(e.expression), "new", a.args, e, a.block);
    }
    if (ts.isCallExpression(e)) {
      const a = args(e.arguments, e);
      const c = e.expression;
      if (ts.isPropertyAccessExpression(c))
        return call(
          expr(c.expression),
          c.name.text,
          a.args,
          e,
          a.block,
          !!c.questionDotToken,
        );
      if (ts.isIdentifier(c))
        return call(isUpper(c.text) ? null : null, c.text, a.args, e, a.block);
      if (c.kind === ts.SyntaxKind.SuperKeyword)
        return { k: "super", args: a.args };
      if (ts.isElementAccessExpression(c))
        return call(
          expr(c.expression),
          "send",
          [expr(c.argumentExpression), ...a.args],
          e,
          a.block,
        );
      return call(expr(c), "call", a.args, e, a.block);
    }
    if (ts.isPropertyAccessExpression(e))
      return call(
        expr(e.expression),
        e.name.text,
        [],
        e,
        null,
        !!e.questionDotToken,
      );
    if (ts.isElementAccessExpression(e))
      return call(
        expr(e.expression),
        "[]",
        [expr(e.argumentExpression)],
        e,
        null,
        !!e.questionDotToken,
      );
    if (ts.isTaggedTemplateExpression(e))
      return call(null, e.tag.getText(sf), [expr(e.template)], e);
    if (ts.isClassExpression(e)) return classDecl(e);
    if (ts.isVoidExpression(e)) return { k: "nil" };
    return { k: "unhandled", node: ts.SyntaxKind[e.kind], l: line(e) };
  }

  return seq(stmts(sf.statements));
}
