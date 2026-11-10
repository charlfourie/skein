import { parseDuration } from '../time'
/**
 * Skein's state language: tokens, syntax tree and parser.
 *
 * Conditions (one boolean expression):
 *   Keeper->Stranger.Trust >= 2 and not World.StormRaging
 *   Time.Phase is Night or Player.Reputation > 3
 *   Keeper.Mood == Wary          (enum options, phases and entities by name)
 *
 * Actions (statements, one per line or separated by `;`):
 *   Keeper.Mood = Wary
 *   Keeper->Stranger.Trust += 1
 *   advance                       (one phase)   advance 2   advance to Night
 *   advance until Night           (stays put if it's already Night)
 *   pass 45m   pass 2h   pass 1h 30m   (let time go by on the clock)
 *
 * Randomness (actions and Condition nodes only): chance(30) is true 30% of the time;
 * roll(1, 6) is a whole number from 1 to 6.
 */

export interface Diagnostic {
  level: 'error' | 'warning'
  message: string
  start: number
  end: number
}

// ---------------------------------------------------------------------------
// Lexer

export type TokenKind = 'ident' | 'number' | 'string' | 'op' | 'newline' | 'eof'

export interface Token {
  kind: TokenKind
  value: string
  start: number
  end: number
}

const OPS = ['->', '==', '!=', '<=', '>=', '+=', '-=', '&&', '||', '→', '(', ')', '.', ',', '<', '>', '=', '+', '-', '*', '/', '!', ';']

export function tokenize(src: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = []
  const diagnostics: Diagnostic[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      tokens.push({ kind: 'newline', value: '\n', start: i, end: i + 1 })
      i++
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++ // comment
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++
      tokens.push({ kind: 'ident', value: src.slice(start, i), start, end: i })
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i
      while (i < src.length && /[0-9]/.test(src[i])) i++
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++
        while (i < src.length && /[0-9]/.test(src[i])) i++
      }
      tokens.push({ kind: 'number', value: src.slice(start, i), start, end: i })
      continue
    }
    if (c === '"' || c === "'") {
      const start = i
      i++
      let value = ''
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < src.length) {
          value += src[i + 1]
          i += 2
        } else value += src[i++]
      }
      if (src[i] !== c) {
        diagnostics.push({ level: 'error', message: 'Text is missing its closing quote.', start, end: i })
      } else i++
      tokens.push({ kind: 'string', value, start, end: i })
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      tokens.push({ kind: 'op', value: op === '→' ? '->' : op, start: i, end: i + op.length })
      i += op.length
      continue
    }
    diagnostics.push({ level: 'error', message: `Unexpected character “${c}”.`, start: i, end: i + 1 })
    i++
  }
  tokens.push({ kind: 'eof', value: '', start: src.length, end: src.length })
  return { tokens, diagnostics }
}

// ---------------------------------------------------------------------------
// Syntax tree

export interface Seg {
  name: string
  start: number
  end: number
}

interface Spanned {
  start: number
  end: number
}

export type BinaryOp = 'and' | 'or' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/'

export type Expr =
  | (Spanned & { kind: 'number'; value: number })
  | (Spanned & { kind: 'string'; value: string })
  | (Spanned & { kind: 'bool'; value: boolean })
  /** `A`, `A.b` or `A->B.c` */
  | (Spanned & { kind: 'name'; head: Seg; to?: Seg; member?: Seg })
  | (Spanned & { kind: 'unary'; op: 'not' | 'neg'; arg: Expr })
  | (Spanned & { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr })
  /** `chance(30)` or `roll(1, 6)`: the arguments are literal numbers. */
  | (Spanned & { kind: 'random'; fn: 'chance' | 'roll'; args: { value: number; start: number; end: number }[] })

export type NameExpr = Extract<Expr, { kind: 'name' }>

export type Statement =
  | (Spanned & { kind: 'assign'; target: NameExpr; op: '=' | '+=' | '-='; value: Expr })
  | (Spanned & { kind: 'advance'; count: number; toPhase?: Seg; stay?: true })
  /** `pass 45m`, `pass 2h`, `pass 1h 30m`, `pass 90` (minutes) */
  | (Spanned & { kind: 'pass'; minutes: number })

// ---------------------------------------------------------------------------
// Parser (precedence climbing)

class ParseError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number
  ) {
    super(message)
  }
}

const PRECEDENCE: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '==': 4,
  '!=': 4,
  is: 4,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6
}

class Parser {
  private i = 0
  constructor(
    private readonly tokens: Token[],
    private readonly skipNewlines: boolean
  ) {}

  peek(offset = 0): Token {
    let j = this.i
    let seen = -1
    for (;;) {
      const t = this.tokens[Math.min(j, this.tokens.length - 1)]
      if (this.skipNewlines && t.kind === 'newline') {
        j++
        continue
      }
      seen++
      if (seen === offset || t.kind === 'eof') return t
      j++
    }
  }

  next(): Token {
    for (;;) {
      const t = this.tokens[Math.min(this.i, this.tokens.length - 1)]
      this.i++
      if (this.skipNewlines && t.kind === 'newline') continue
      return t
    }
  }

  is(value: string): boolean {
    const t = this.peek()
    return (t.kind === 'op' || t.kind === 'ident') && t.value === value
  }

  expect(value: string, what: string): Token {
    const t = this.peek()
    if ((t.kind === 'op' || t.kind === 'ident') && t.value === value) return this.next()
    throw new ParseError(`Expected ${what}${describe(t)}.`, t.start, Math.max(t.end, t.start + 1))
  }

  expression(minPrec = 1): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      const key = t.kind === 'op' || t.kind === 'ident' ? t.value : ''
      const prec = PRECEDENCE[key]
      if (!prec || prec < minPrec) return left
      this.next()
      let op: BinaryOp
      if (key === 'is') {
        if (this.is('not')) {
          this.next()
          op = '!='
        } else op = '=='
      } else op = ({ '||': 'or', '&&': 'and' } as Record<string, BinaryOp>)[key] ?? (key as BinaryOp)
      const right = this.expression(prec + 1)
      left = { kind: 'binary', op, left, right, start: left.start, end: right.end }
    }
  }

  unary(): Expr {
    const t = this.peek()
    if ((t.kind === 'ident' && t.value === 'not') || (t.kind === 'op' && t.value === '!')) {
      this.next()
      const arg = this.expression(3)
      return { kind: 'unary', op: 'not', arg, start: t.start, end: arg.end }
    }
    if (t.kind === 'op' && t.value === '-') {
      this.next()
      const arg = this.unary()
      return { kind: 'unary', op: 'neg', arg, start: t.start, end: arg.end }
    }
    return this.primary()
  }

  primary(): Expr {
    const t = this.next()
    if (t.kind === 'number') return { kind: 'number', value: Number(t.value), start: t.start, end: t.end }
    if (t.kind === 'string') return { kind: 'string', value: t.value, start: t.start, end: t.end }
    if (t.kind === 'op' && t.value === '(') {
      const inner = this.expression()
      const close = this.expect(')', 'a closing “)”')
      return { ...inner, start: t.start, end: close.end }
    }
    if (t.kind === 'ident') {
      if (t.value === 'true' || t.value === 'false') return { kind: 'bool', value: t.value === 'true', start: t.start, end: t.end }
      if ((t.value === 'chance' || t.value === 'roll') && this.is('(')) return this.random(t)
      if (['and', 'or', 'is', 'not', 'advance'].includes(t.value)) {
        throw new ParseError(`“${t.value}” can’t be used here.`, t.start, t.end)
      }
      return this.nameFrom(t)
    }
    throw new ParseError(`Expected a value${describe(t)}.`, t.start, Math.max(t.end, t.start + 1))
  }

  random(t: Token): Expr {
    const fn = t.value as 'chance' | 'roll'
    this.next() // (
    const args: { value: number; start: number; end: number }[] = []
    const example = fn === 'chance' ? 'chance(30)' : 'roll(1, 6)'
    for (;;) {
      const neg = this.is('-') ? this.next() : null
      const n = this.next()
      if (n.kind !== 'number') throw new ParseError(`Expected a number, e.g. ${example}${describe(n)}.`, n.start, Math.max(n.end, n.start + 1))
      args.push({ value: neg ? -Number(n.value) : Number(n.value), start: neg?.start ?? n.start, end: n.end })
      if (!this.is(',')) break
      this.next()
    }
    const close = this.expect(')', 'a closing “)”')
    return { kind: 'random', fn, args, start: t.start, end: close.end }
  }

  nameFrom(head: Token): NameExpr {
    const headSeg = seg(head)
    if (this.is('->')) {
      this.next()
      const to = this.identifier('the other side of the relationship, e.g. Keeper->Stranger.Trust')
      this.expect('.', '“.” and the relationship name')
      const member = this.identifier('a relationship name')
      return { kind: 'name', head: headSeg, to, member, start: head.start, end: member.end }
    }
    if (this.is('.')) {
      this.next()
      const member = this.identifier('a property name after “.”')
      return { kind: 'name', head: headSeg, member, start: head.start, end: member.end }
    }
    return { kind: 'name', head: headSeg, start: head.start, end: head.end }
  }

  identifier(what: string): Seg {
    const t = this.peek()
    if (t.kind !== 'ident') throw new ParseError(`Expected ${what}${describe(t)}.`, t.start, Math.max(t.end, t.start + 1))
    return seg(this.next())
  }

  statement(): Statement {
    const t = this.next()
    if (t.kind === 'ident' && t.value === 'pass') {
      const parts: Token[] = []
      while (this.peek().kind === 'number' || (this.peek().kind === 'ident' && parts.length > 0 && /^[a-z]/i.test(this.peek().value))) parts.push(this.next())
      const text = parts.map((p) => p.value).join('')
      const minutes = parseDuration(text)
      const end = parts.length ? parts[parts.length - 1].end : t.end
      if (minutes === null || !parts.length) throw new ParseError('Say how long, e.g. pass 30m, pass 2h or pass 1h 30m.', t.start, Math.max(end, t.end + 1))
      if (!(minutes > 0)) throw new ParseError('Pass a length of time above zero.', t.start, end)
      return { kind: 'pass', minutes, start: t.start, end }
    }
    if (t.kind === 'ident' && t.value === 'advance') {
      if (this.is('to') || this.is('until')) {
        const stay = this.next().value === 'until'
        const phase = this.identifier(stay ? 'a time phase, e.g. advance until Night' : 'a time phase, e.g. advance to Night')
        return { kind: 'advance', count: 1, toPhase: phase, ...(stay ? { stay: true as const } : {}), start: t.start, end: phase.end }
      }
      const n = this.peek()
      if (n.kind === 'number') {
        this.next()
        const count = Number(n.value)
        if (!Number.isInteger(count) || count < 1) throw new ParseError('Advance by a whole number of phases (1 or more).', n.start, n.end)
        return { kind: 'advance', count, start: t.start, end: n.end }
      }
      return { kind: 'advance', count: 1, start: t.start, end: t.end }
    }
    if (t.kind !== 'ident') throw new ParseError(`Expected something to change, e.g. Keeper.Mood = Wary${describe(t)}.`, t.start, Math.max(t.end, t.start + 1))
    const target = this.nameFrom(t)
    const opTok = this.peek()
    if (opTok.kind === 'op' && (opTok.value === '=' || opTok.value === '+=' || opTok.value === '-=')) {
      this.next()
      const value = this.expression()
      return { kind: 'assign', target, op: opTok.value, value, start: t.start, end: value.end }
    }
    if (opTok.kind === 'op' && opTok.value === '==') {
      throw new ParseError('Use “=” to change a value (“==” compares).', opTok.start, opTok.end)
    }
    throw new ParseError(`Expected “=”, “+=” or “-=”${describe(opTok)}.`, opTok.start, Math.max(opTok.end, opTok.start + 1))
  }

  atEnd(): boolean {
    return this.peek().kind === 'eof'
  }
}

function seg(t: Token): Seg {
  return { name: t.value, start: t.start, end: t.end }
}

function describe(t: Token): string {
  if (t.kind === 'eof') return ', but the text ended'
  if (t.kind === 'newline') return ' before the line ended'
  return `, found “${t.value}”`
}

export function parseCondition(src: string): { ast: Expr | null; diagnostics: Diagnostic[] } {
  const { tokens, diagnostics } = tokenize(src)
  if (diagnostics.length) return { ast: null, diagnostics }
  const p = new Parser(tokens, true)
  try {
    if (p.atEnd()) return { ast: null, diagnostics: [] }
    const ast = p.expression()
    if (!p.atEnd()) {
      const t = p.peek()
      throw new ParseError(`Unexpected “${t.value}”. Join conditions with “and” / “or”.`, t.start, t.end)
    }
    return { ast, diagnostics: [] }
  } catch (e) {
    if (e instanceof ParseError) return { ast: null, diagnostics: [{ level: 'error', message: e.message, start: e.start, end: e.end }] }
    throw e
  }
}

export function parseActions(src: string): { ast: Statement[] | null; diagnostics: Diagnostic[] } {
  const { tokens, diagnostics } = tokenize(src)
  if (diagnostics.length) return { ast: null, diagnostics }
  const p = new Parser(tokens, false)
  const statements: Statement[] = []
  const errors: Diagnostic[] = []
  // Parse statement by statement so one bad line doesn't hide the others.
  for (;;) {
    while (p.peek().kind === 'newline' || p.is(';')) p.next()
    if (p.atEnd()) break
    try {
      statements.push(p.statement())
      const t = p.peek()
      if (!(t.kind === 'newline' || t.kind === 'eof' || (t.kind === 'op' && t.value === ';'))) {
        throw new ParseError(`Unexpected “${t.value}”. Put each change on its own line.`, t.start, t.end)
      }
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      errors.push({ level: 'error', message: e.message, start: e.start, end: e.end })
      while (!(p.peek().kind === 'newline' || p.peek().kind === 'eof' || p.is(';'))) p.next()
    }
  }
  return { ast: errors.length ? null : statements, diagnostics: errors }
}
