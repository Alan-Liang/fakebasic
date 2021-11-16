// to build an executable, run `qjsc -fno-string-normalize -fno-map -fno-promise -fno-typedarray -fno-typedarray -fno-json -fno-eval -fno-proxy -fno-date -fno-bigint -o code main.js && strip code`

import * as std from 'std'

const { printf, exit } = std
const stdin = std.in

const DIVIDE_BY_ZERO = 'DIVIDE BY ZERO'
const INVALID_NUMBER = 'INVALID NUMBER'
const LINE_NUMBER_ERROR = 'LINE NUMBER ERROR'
const SYNTAX_ERROR = 'SYNTAX ERROR'
const VARIABLE_NOT_DEFINED = 'VARIABLE NOT DEFINED'
const HELP = 'Yet another basic interpreter'

class RuntimeError extends Error {}
class EarlyError extends Error {}

const re = (segments, ...interpolations) => {
  let str = segments.raw[0]
  for (const [ i, int ] of interpolations.entries()) str += (int + segments.raw[i + 1])
  return new RegExp(str.replace(/\n/g, ''))
}

const keywords = 'REM LET PRINT INPUT END GOTO IF THEN RUN LIST CLEAR QUIT HELP'.split(' ')

const checkName = name => {
  if (keywords.includes(name)) throw new EarlyError(SYNTAX_ERROR)
  if (!/^[a-zA-Z0-9]+$/.test(name)) throw new EarlyError(SYNTAX_ERROR)
  return name
}
const checkLine = line => {
  if (!(String(line) in state.program)) throw new RuntimeError(LINE_NUMBER_ERROR)
  return Number(line)
}

const reExpr = re`
^(?:
(?<literal>\d+)|
(?<variable>[a-zA-Z0-9]+)|
(?:__GRP_(?<group>\d+)__)|
(?:(?<sub1pm>.+)\s*(?<pm>[+\-])\s*(?<sub2pm>.+))|
(?:(?<sub1mul>.+)\s*(?<mul>[*/])\s*(?<sub2mul>.+))
)$
`
const parseExpr = (expr, baseGroups = []) => {
  expr = expr.trim()
  const groups = []
  if (/[()]/.test(expr)) {
    const symbol = i => `__GRP_${i}__`
    let depth = 0, start = -1
    for (const i of [ ...expr ].keys()) {
      if (expr[i] === '(') {
        if (depth === 0) start = i
        ++depth
      } else if (expr[i] === ')') {
        --depth
        if (depth === 0) groups.push({ start, end: i, parsed: parseExpr(expr.slice(start + 1, i)) })
        if (depth < 0) throw new EarlyError(SYNTAX_ERROR)
      }
    }
    if (depth > 0) throw new EarlyError(SYNTAX_ERROR)
    const originalExpr = expr
    expr = originalExpr.slice(0, groups[0].start)
    for (const i of groups.keys()) {
      expr += symbol(i + baseGroups.length)
      expr += originalExpr.slice(groups[i].end + 1, groups[i + 1]?.start)
    }
  }
  groups.splice(0, 0, ...baseGroups)
  // print(expr)
  // print(JSON.stringify(groups))
  const parsed = expr.match(reExpr)?.groups
  if (!parsed) throw new EarlyError(SYNTAX_ERROR)
  const entries = Object.entries(parsed).filter(x => x[1])
  if (entries.length > 1) {
    return {
      is: 'op',
      op: parsed.pm || parsed.mul,
      sub1: parseExpr(parsed.sub1pm || parsed.sub1mul, groups),
      sub2: parseExpr(parsed.sub2pm || parsed.sub2mul, groups),
    }
  }
  const is = entries[0][0]
  if (is === 'group') return { is, group: groups[parsed.group].parsed }
  if (is === 'variable') return { is, variable: checkName(parsed.variable) }
  return { is, [is]: entries[0][1] }
}
const evalExpr = expr => ({
  literal: ({ literal }) => Number(literal),
  variable: ({ variable }) => {
    if (!(variable in state.variables)) throw new RuntimeError(VARIABLE_NOT_DEFINED)
    return state.variables[variable]
  },
  group: ({ group }) => evalExpr(group),
  op: ({ op, sub1, sub2 }) => ({
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => {
      if (b === 0) throw new RuntimeError(DIVIDE_BY_ZERO)
      return parseInt(a / b)
    },
  })[op](evalExpr(sub1), evalExpr(sub2)),
})[expr.is](expr)

const parseStatement = (type, args, source) => {
  const stmt = statements[type]
  stmt.static?.(args)
  return { is: type, args, source }
}

const statements = {
  Rem: { re: /.+/, },
  Let: {
    re: /(?<letName>[^ ]+)\s+=\s+(?<letExpr>.+)/,
    static (args) {
      checkName(args.letName)
      args.letExpr = parseExpr(args.letExpr)
    },
    eval ({ letName, letExpr }) {
      state.variables[letName] = evalExpr(letExpr)
    },
  },
  Print: {
    re: /(?<printExpr>.+)/,
    static (args) { args.printExpr = parseExpr(args.printExpr) },
    eval ({ printExpr }) { print(evalExpr(printExpr)) },
  },
  Input: {
    re: /(?<inputName>[^ ]+)/,
    static ({ inputName }) { checkName(inputName) },
    eval ({ inputName }) {
      const read = () => {
        printf(' ? ')
        return stdin.getline()
      }
      let input = read()
      while (!/^-?\d+$/.test(input)) {
        print(INVALID_NUMBER)
        input = read()
        if (input === null) exit(1)
      }
      state.variables[inputName] = Number(input)
    },
  },
  End: { re: re``, },
  Goto: {
    re: /(?<gotoLine>\d+)/,
    eval ({ gotoLine }) { state.pc = checkLine(gotoLine) },
  },
  If: {
    re: /(?<ifExpr1>.+)\s+(?<ifCmp>[<>=])\s+(?<ifExpr2>.+)\s+THEN\s+(?<ifLine>\d+)/,
    static (args) { for (const i of '12') args[`ifExpr${i}`] = parseExpr(args[`ifExpr${i}`]) },
    eval ({ ifExpr1, ifCmp, ifExpr2, ifLine }) {
      const [ expr1, expr2 ] = [ ifExpr1, ifExpr2 ].map(evalExpr)
      const condition = { '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b }[ifCmp](expr1, expr2)
      if (condition) state.pc = checkLine(ifLine)
    },
  },
}

const immediateStatements = [ 'Let', 'Print', 'Input' ]
const endStatement = 'End'

const commands = {
  Run () {
    const lines = state.lines
    if (lines.length === 0) return
    state.pc = lines[0]
    try {
      while (state.pc !== undefined) {
        const { is, args } = state.program[state.pc]
        if (is === endStatement) break
        state.pc = lines.find(x => x > state.pc)
        statements[is].eval?.(args)
      }
    } catch (e) { print(e.message) }
  },
  List () {
    if (state.lines.length === 0) return
    print(state.lines.map(x => state.program[x]).map(x => x.source).join('\n'))
  },
  Clear () { state = new ProgramState() },
  Quit () { exit(0) },
  Help () { print(HELP) },
}

const syntax = re`
^(?:
(?:(?<lineNumber>\d+)\s*)?
(?:${[ ...Object.entries(statements), ...Object.entries(commands) ].map(([ k, v ]) => String.raw`(?<${k}>${k.toUpperCase()}\s*${v.re?.source || ''})`).join('|')})?
)$
`

class ProgramState {
  pc = -1
  variables = []
  program = {}
  get lines () { return Object.keys(this.program).map(Number).sort((a, b) => a - b) }
}

let state = new ProgramState()

const statementTypes = Object.keys(statements)
const commandTypes = Object.keys(commands)

// print(syntax.source)
const oneLine = () => {
  const line = stdin.getline()
  if (line === null) exit(0)
  const parsed = line.match(syntax)?.groups
  if (!parsed) throw new EarlyError(SYNTAX_ERROR)
  const statementType = statementTypes.find(x => parsed[x])
  const commandType = commandTypes.find(x => parsed[x])
  const type = statementType || commandType
  if (!type) {
    if (!parsed.lineNumber) throw new EarlyError(SYNTAX_ERROR)
    delete state.program[Number(parsed.lineNumber)]
    return
  }
  if (commandType) {
    if (parsed.lineNumber) throw new EarlyError(SYNTAX_ERROR)
    commands[type]()
  } else {
    if (parsed.lineNumber) {
      parsed.lineNumber = Number(parsed.lineNumber)
      state.program[parsed.lineNumber] = parseStatement(type, parsed, line)
    } else {
      if (!immediateStatements.includes(type)) throw new EarlyError(SYNTAX_ERROR)
      const stmt = statements[type]
      stmt.eval?.(parseStatement(type, parsed).args)
    }
  }
}

while (true) try { oneLine() } catch (e) { print(e.message) }
