// GML-tolk för Game Maker 5: tokenizer -> parser (AST) -> JS-closures.
// Stöder det spelen behöver plus det vanligaste i GM5-syntax:
//   `=` som jämförelse i uttryck, `and/or/xor/not`, `div/mod`, frivilliga semikolon,
//   `{}` och `begin/end`, if/else, while, do/until, for, repeat, with, switch, exit,
//   break, continue, var, globalvar, fält som `other.y`, `global.x`, `objekt.x`.
// Körning: varje kompilerad bit tar en kontext { self, other, game, locals, args }.

export class GmlError extends Error {}

// ---------------- tokenizer ----------------
const OPS = ['<<=', '>>=', '&&', '||', '^^', '==', '!=', '<>', '<=', '>=', '+=', '-=', '*=', '/=',
  '|=', '&=', '^=', '<<', '>>', '+', '-', '*', '/', '<', '>', '=', '!', '~', '&', '|', '^', '(',
  ')', '[', ']', '{', '}', ',', ';', '.', ':'];
const WORD_OPS = new Set(['and', 'or', 'xor', 'not', 'div', 'mod']);

function tokenize(src) {
  const t = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i; while (j < n && /[0-9.]/.test(src[j])) j++;
      t.push({ k: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
    }
    if (c === '$') {
      let j = i + 1; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      t.push({ k: 'num', v: parseInt(src.slice(i + 1, j), 16) }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      const end = j < 0 ? n : j;
      t.push({ k: 'str', v: src.slice(i + 1, end) }); i = end + 1; continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_À-ɏ]/.test(src[j])) j++;
      const w = src.slice(i, j);
      const lw = w.toLowerCase();
      if (WORD_OPS.has(lw)) t.push({ k: 'op', v: lw });
      else t.push({ k: 'id', v: w });
      i = j; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new GmlError(`Okänt tecken '${c}' i GML`);
    t.push({ k: 'op', v: op }); i += op.length;
  }
  t.push({ k: 'eof' });
  return t;
}

// ---------------- parser ----------------
const BIN = {
  '||': 1, 'or': 1, '&&': 2, 'and': 2, '^^': 2, 'xor': 2,
  '<': 3, '<=': 3, '==': 3, '=': 3, '!=': 3, '<>': 3, '>': 3, '>=': 3,
  '|': 4, '&': 4, '^': 4, '<<': 5, '>>': 5, '+': 6, '-': 6,
  '*': 7, '/': 7, 'div': 7, 'mod': 7,
};
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '|=', '&=', '^=', '<<=', '>>=']);
const KEYWORDS = new Set(['if', 'else', 'while', 'do', 'until', 'for', 'repeat', 'with', 'switch',
  'case', 'default', 'exit', 'break', 'continue', 'return', 'var', 'globalvar', 'begin', 'end',
  'then']);

class Parser {
  constructor(src) { this.t = tokenize(src); this.p = 0; }
  peek(o = 0) { return this.t[this.p + o]; }
  next() { return this.t[this.p++]; }
  isOp(v) { const x = this.peek(); return x.k === 'op' && x.v === v; }
  isWord(v) { const x = this.peek(); return x.k === 'id' && x.v.toLowerCase() === v; }
  eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  eatWord(v) { if (this.isWord(v)) { this.p++; return true; } return false; }
  expectOp(v) { if (!this.eatOp(v)) throw new GmlError(`Väntade '${v}' men fick ${this.desc()}`); }
  desc() { const x = this.peek(); return x.k === 'eof' ? 'slutet' : `'${x.v}'`; }

  program() {
    const body = [];
    while (this.peek().k !== 'eof') body.push(this.statement());
    return { t: 'block', body };
  }

  block() {
    const body = [];
    const close = this.eatOp('{') ? '}' : (this.eatWord('begin') ? 'end' : null);
    if (!close) throw new GmlError('Väntade block');
    while (!(close === '}' ? this.isOp('}') : this.isWord('end'))) {
      if (this.peek().k === 'eof') throw new GmlError('Block saknar slut');
      body.push(this.statement());
    }
    this.p++;
    return { t: 'block', body };
  }

  statement() {
    while (this.eatOp(';'));
    if (this.peek().k === 'eof') return { t: 'block', body: [] };
    let s;
    if (this.isOp('{') || this.isWord('begin')) s = this.block();
    else if (this.peek().k === 'id' && KEYWORDS.has(this.peek().v.toLowerCase())) s = this.keywordStatement();
    else s = this.simpleStatement();
    while (this.eatOp(';'));
    return s;
  }

  keywordStatement() {
    const w = this.next().v.toLowerCase();
    switch (w) {
      case 'if': {
        const cond = this.expr();
        this.eatWord('then');
        const then = this.statement();
        const els = this.eatWord('else') ? this.statement() : null;
        return { t: 'if', cond, then, els };
      }
      case 'while': { const cond = this.expr(); this.eatWord('do'); return { t: 'while', cond, body: this.statement() }; }
      case 'do': {
        const body = this.statement();
        if (!this.eatWord('until')) throw new GmlError("Väntade 'until'");
        return { t: 'do', body, cond: this.expr() };
      }
      case 'repeat': return { t: 'repeat', count: this.expr(), body: this.statement() };
      case 'with': return { t: 'with', target: this.expr(), body: this.statement() };
      case 'for': {
        this.expectOp('(');
        const init = this.statement();
        const cond = this.expr(); while (this.eatOp(';'));
        const step = this.isOp(')') ? { t: 'block', body: [] } : this.simpleStatement();
        this.expectOp(')');
        return { t: 'for', init, cond, step, body: this.statement() };
      }
      case 'switch': {
        const val = this.expr();
        if (!this.eatOp('{') && !this.eatWord('begin')) throw new GmlError('switch saknar block');
        const cases = [];
        let cur = null;
        while (!this.isOp('}') && !this.isWord('end')) {
          if (this.eatWord('case')) { cur = { val: this.expr(), body: [] }; this.expectOp(':'); cases.push(cur); }
          else if (this.eatWord('default')) { cur = { val: null, body: [] }; this.expectOp(':'); cases.push(cur); }
          else { if (!cur) throw new GmlError('Sats före case'); cur.body.push(this.statement()); }
        }
        this.p++;
        return { t: 'switch', val, cases };
      }
      case 'exit': return { t: 'exit' };
      case 'break': return { t: 'break' };
      case 'continue': return { t: 'continue' };
      case 'return': return { t: 'return', val: this.expr() };
      case 'var': case 'globalvar': {
        const names = [this.next().v];
        while (this.eatOp(',')) names.push(this.next().v);
        return { t: w, names };
      }
      default: throw new GmlError(`Oväntat ord '${w}'`);
    }
  }

  simpleStatement() {
    const target = this.postfix();
    const x = this.peek();
    if (x.k === 'op' && ASSIGN.has(x.v)) {
      this.p++;
      if (target.t !== 'var' && target.t !== 'field' && target.t !== 'index') throw new GmlError('Kan inte tilldela');
      return { t: 'assign', op: x.v, target, val: this.expr() };
    }
    if (target.t === 'call') return { t: 'expr', e: target };
    throw new GmlError(`Ofullständig sats vid ${this.desc()}`);
  }

  expr(minPrec = 1) {
    let left = this.unary();
    for (;;) {
      const x = this.peek();
      if (x.k !== 'op') break;
      const prec = BIN[x.v];
      if (!prec || prec < minPrec) break;
      this.p++;
      const right = this.expr(prec + 1);
      left = { t: 'bin', op: x.v, a: left, b: right };
    }
    return left;
  }

  unary() {
    if (this.eatOp('!') || this.eatOp('not')) return { t: 'not', a: this.unary() };
    if (this.eatOp('-')) return { t: 'neg', a: this.unary() };
    if (this.eatOp('+')) return this.unary();
    if (this.eatOp('~')) return { t: 'bnot', a: this.unary() };
    return this.postfix();
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.eatOp('.')) {
        const name = this.next();
        if (name.k !== 'id') throw new GmlError('Väntade fältnamn efter punkt');
        e = { t: 'field', obj: e, name: name.v };
      } else if (this.isOp('[')) {
        this.p++;
        const i = this.expr();
        const j = this.eatOp(',') ? this.expr() : null;
        this.expectOp(']');
        e = { t: 'index', base: e, i, j };
      } else break;
    }
    return e;
  }

  primary() {
    const x = this.next();
    if (x.k === 'num') return { t: 'num', v: x.v };
    if (x.k === 'str') return { t: 'str', v: x.v };
    if (x.k === 'op' && x.v === '(') { const e = this.expr(); this.expectOp(')'); return e; }
    if (x.k === 'id') {
      if (this.isOp('(')) {
        this.p++;
        const args = [];
        if (!this.isOp(')')) { do { args.push(this.expr()); } while (this.eatOp(',')); }
        this.expectOp(')');
        return { t: 'call', name: x.v, args };
      }
      return { t: 'var', name: x.v };
    }
    throw new GmlError(`Oväntat ${x.k === 'eof' ? 'slut' : "'" + x.v + "'"} i uttryck`);
  }
}

export function parse(src) { return new Parser(src).program(); }
export function parseExpr(src) {
  const p = new Parser(src);
  const e = p.expr();
  if (p.peek().k !== 'eof') throw new GmlError(`Skräp efter uttryck: ${p.desc()}`);
  return e;
}

// ---------------- kompilering ----------------
class Exit {} class Break {} class Continue {}
class Return { constructor(v) { this.v = v; } }
export const EXIT = new Exit();

const truthy = (v) => (typeof v === 'string' ? v.length > 0 : v > 0.5);
const b = (x) => (x ? 1 : 0);

function binop(op, a, c) {
  switch (op) {
    case '+': return (typeof a === 'string' || typeof c === 'string') ? String(a) + String(c) : a + c;
    case '-': return a - c;
    case '*': return a * c;
    case '/': return a / c;
    case 'div': return Math.trunc(a / c);
    case 'mod': return a % c;
    case '<': return b(a < c);
    case '<=': return b(a <= c);
    case '>': return b(a > c);
    case '>=': return b(a >= c);
    case '=': case '==': return b(a === c || (typeof a === 'number' && typeof c === 'number' && Math.abs(a - c) < 1e-9));
    case '!=': case '<>': return b(!(a === c || (typeof a === 'number' && typeof c === 'number' && Math.abs(a - c) < 1e-9)));
    case '|': return Math.round(a) | Math.round(c);
    case '&': return Math.round(a) & Math.round(c);
    case '^': return Math.round(a) ^ Math.round(c);
    case '<<': return Math.round(a) << Math.round(c);
    case '>>': return Math.round(a) >> Math.round(c);
    case '^^': case 'xor': return b(truthy(a) !== truthy(c));
    default: throw new GmlError('Okänd operator ' + op);
  }
}

// rt = runtime-gränssnitt från motorn:
//   rt.getVar(ctx, name), rt.setVar(ctx, name, v),
//   rt.getField(ctx, target, name), rt.setField(ctx, target, name, v),
//   rt.call(ctx, name, args), rt.withTargets(ctx, target) -> lista av instanser
export function compile(ast, rt) {
  const C = (n) => compileNode(n, rt);
  return C(ast);
}

function compileNode(n, rt) {
  const C = (x) => compileNode(x, rt);
  switch (n.t) {
    case 'num': { const v = n.v; return () => v; }
    case 'str': { const v = n.v; return () => v; }
    case 'var': { const name = n.name; return (ctx) => rt.getVar(ctx, name); }
    case 'field': {
      const obj = C(n.obj); const name = n.name;
      return (ctx) => rt.getField(ctx, obj(ctx), name);
    }
    case 'index': {
      const base = n.base; const i = C(n.i); const j = n.j ? C(n.j) : null;
      if (base.t !== 'var') throw new GmlError('Index stöds bara på variabler');
      const name = base.name;
      return (ctx) => rt.getVar(ctx, name, Math.floor(i(ctx)), j ? Math.floor(j(ctx)) : 0);
    }
    case 'call': {
      const args = n.args.map(C); const name = n.name;
      return (ctx) => rt.call(ctx, name, args.map((a) => a(ctx)));
    }
    case 'not': { const a = C(n.a); return (ctx) => b(!truthy(a(ctx))); }
    case 'neg': { const a = C(n.a); return (ctx) => -a(ctx); }
    case 'bnot': { const a = C(n.a); return (ctx) => ~Math.round(a(ctx)); }
    case 'bin': {
      const a = C(n.a); const c = C(n.b); const op = n.op;
      if (op === '&&' || op === 'and') return (ctx) => b(truthy(a(ctx)) && truthy(c(ctx)));
      if (op === '||' || op === 'or') return (ctx) => b(truthy(a(ctx)) || truthy(c(ctx)));
      return (ctx) => binop(op, a(ctx), c(ctx));
    }
    case 'block': {
      const body = n.body.map(C);
      return (ctx) => { for (const s of body) s(ctx); };
    }
    case 'expr': { const e = C(n.e); return (ctx) => { e(ctx); }; }
    case 'assign': {
      const val = C(n.val); const op = n.op; const tg = n.target;
      const combine = op === '=' ? null : op.slice(0, -1);
      if (tg.t === 'var') {
        const name = tg.name;
        return (ctx) => {
          let v = val(ctx);
          if (combine) v = binop(combine, rt.getVar(ctx, name), v);
          rt.setVar(ctx, name, v);
        };
      }
      if (tg.t === 'index') {
        if (tg.base.t !== 'var') throw new GmlError('Index stöds bara på variabler');
        const name = tg.base.name; const i = C(tg.i); const j = tg.j ? C(tg.j) : null;
        return (ctx) => {
          const ii = Math.floor(i(ctx)); const jj = j ? Math.floor(j(ctx)) : 0;
          let v = val(ctx);
          if (combine) v = binop(combine, rt.getVar(ctx, name, ii, jj), v);
          rt.setVar(ctx, name, v, ii, jj);
        };
      }
      const obj = C(tg.obj); const name = tg.name;
      return (ctx) => {
        const target = obj(ctx);
        let v = val(ctx);
        if (combine) v = binop(combine, rt.getField(ctx, target, name), v);
        rt.setField(ctx, target, name, v);
      };
    }
    case 'if': {
      const cond = C(n.cond); const then = C(n.then); const els = n.els ? C(n.els) : null;
      return (ctx) => { if (truthy(cond(ctx))) then(ctx); else if (els) els(ctx); };
    }
    case 'while': {
      const cond = C(n.cond); const body = C(n.body);
      return (ctx) => {
        let guard = 0;
        while (truthy(cond(ctx))) {
          if (++guard > 1e6) throw new GmlError('Oändlig while-loop');
          try { body(ctx); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
      };
    }
    case 'do': {
      const cond = C(n.cond); const body = C(n.body);
      return (ctx) => {
        let guard = 0;
        do {
          if (++guard > 1e6) throw new GmlError('Oändlig do-loop');
          try { body(ctx); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        } while (!truthy(cond(ctx)));
      };
    }
    case 'repeat': {
      const count = C(n.count); const body = C(n.body);
      return (ctx) => {
        const k = Math.round(count(ctx));
        for (let i = 0; i < k; i++) {
          try { body(ctx); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
      };
    }
    case 'for': {
      const init = C(n.init); const cond = C(n.cond); const step = C(n.step); const body = C(n.body);
      return (ctx) => {
        let guard = 0;
        for (init(ctx); truthy(cond(ctx)); step(ctx)) {
          if (++guard > 1e6) throw new GmlError('Oändlig for-loop');
          try { body(ctx); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
      };
    }
    case 'with': {
      const target = C(n.target); const body = C(n.body);
      return (ctx) => {
        const list = rt.withTargets(ctx, target(ctx));
        for (const inst of list) {
          if (inst.deleted) continue;
          const sub = { ...ctx, other: ctx.self, self: inst };
          try { body(sub); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
      };
    }
    case 'switch': {
      const val = C(n.val);
      const cases = n.cases.map((c) => ({ val: c.val ? C(c.val) : null, body: c.body.map(C) }));
      return (ctx) => {
        const v = val(ctx);
        let start = cases.findIndex((c) => c.val && binop('==', c.val(ctx), v));
        if (start < 0) start = cases.findIndex((c) => !c.val);
        if (start < 0) return;
        try {
          for (let i = start; i < cases.length; i++) for (const s of cases[i].body) s(ctx);
        } catch (e) { if (!(e instanceof Break)) throw e; }
      };
    }
    case 'exit': return () => { throw EXIT; };
    case 'break': return () => { throw new Break(); };
    case 'continue': return () => { throw new Continue(); };
    case 'return': { const v = C(n.val); return (ctx) => { throw new Return(v(ctx)); }; }
    case 'var': {
      const names = n.names;
      return (ctx) => { for (const nm of names) if (!(nm in ctx.locals)) ctx.locals[nm] = 0; };
    }
    case 'globalvar': {
      const names = n.names;
      return (ctx) => { for (const nm of names) rt.declareGlobal(nm); };
    }
    default: throw new GmlError('Okänd nod ' + n.t);
  }
}

// Kör en kompilerad kodbit. Returnerar värdet från `return` eller 0.
export function run(fn, ctx) {
  try { fn(ctx); return 0; } catch (e) {
    if (e === EXIT) return 0;
    if (e instanceof Return) return e.v;
    throw e;
  }
}

export { truthy };

// Samlar alla funktions- och variabelnamn i ett AST (för testet i etapp 5).
export function collectNames(ast, out = { calls: new Set(), vars: new Set() }) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.t === 'call') out.calls.add(n.name);
    if (n.t === 'var') out.vars.add(n.name);
    for (const k of Object.keys(n)) if (k !== 't') walk(n[k]);
  };
  walk(ast);
  return out;
}
