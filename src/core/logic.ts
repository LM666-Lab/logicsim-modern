/**
 * 逻辑引擎 —— 逆波兰逻辑表达式 → 二元决策图。
 *
 * 纯移植自 2021 年版的 LogicParser.js，算法与结果完全一致，
 * 只补了 TypeScript 类型和精确的出错位置。没有任何新增功能。
 *
 * 支持的五个操作符（均为后缀 / 逆波兰写法）：
 *   `.`  a b .  →  a 与 b
 *   `,`  a b ,  →  a 或 b
 *   `<`  a <    →  非 a
 *   `>`  a b >  →  a 推出 b
 *   `=`  a b =  →  a 与 b 等价（同或）
 */

import type {
  BddModel,
  BddPath,
  DecisionNode,
  GraphDesc,
  NodeKey,
  ParseErrorCode,
  ParseResult,
  Polarity,
} from './types';

/** 常量节点在字符串形式下的写法。 */
const TRUE = '1';
const FALSE = '0';

// ---------------------------------------------------------------------------
// 内建小工具：原版用一个 {S, 0, 1} 对象表示 Shannon 展开的每一层
// ---------------------------------------------------------------------------

const andNode = (a: DecisionNode | string, b: DecisionNode | string): DecisionNode => ({
  S: a,
  0: FALSE,
  1: { S: b, 0: FALSE, 1: TRUE },
});

const orNode = (a: DecisionNode | string, b: DecisionNode | string): DecisionNode => ({
  S: a,
  0: { S: b, 0: FALSE, 1: TRUE },
  1: TRUE,
});

const notNode = (a: DecisionNode | string): DecisionNode => ({
  S: a,
  0: TRUE,
  1: FALSE,
});

const implyNode = (a: DecisionNode | string, b: DecisionNode | string): DecisionNode => ({
  S: a,
  0: TRUE,
  1: { S: b, 0: FALSE, 1: TRUE },
});

const equalNode = (a: DecisionNode | string, b: DecisionNode | string): DecisionNode => ({
  S: a,
  0: { S: b, 0: TRUE, 1: FALSE },
  1: { S: b, 0: FALSE, 1: TRUE },
});

const OPERATOR_CHARS = new Set(['.', ',', '<', '>', '=']);

const ERROR_TEXT: Record<ParseErrorCode, string> = {
  EMPTY: '表达式为空，请先输入逆波兰逻辑表达式。',
  NOT_ENOUGH_ARGS: '操作数不足：「%s」前面的变量不够用。',
  TOO_MANY_ARGS: '操作数过多：表达式结束后还有多余的变量没有参与运算。',
  RESERVED_NAME: '变量名与操作符冲突，或同一处出现了空白的变量名。',
};

// ---------------------------------------------------------------------------
// LogicParser：逆波兰表达式 → 决策树
// ---------------------------------------------------------------------------

export function parseRPN(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, code: 'EMPTY', message: ERROR_TEXT.EMPTY };
  }

  // 与原版相同的切分方式：保留分隔符本身，便于逐个 token 处理。
  const tokens = trimmed.split(/(\.|,|<|>|=|\s)/);
  const stack: (DecisionNode | string)[] = [];
  const variables: string[] = [];
  /** 1 表示上一个 token 是变量名（原版用 state 变量表达同一件事）。 */
  let state = 0;
  /** 还有多少个变量没被任何操作符消费掉。 */
  let pending = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '') continue;

    if (/^\s+$/.test(token)) {
      if (state === 1) {
        state = 0;
        pending++;
      }
      continue;
    }

    if (OPERATOR_CHARS.has(token)) {
      if (state === 1) {
        return {
          ok: false,
          code: 'RESERVED_NAME',
          message: ERROR_TEXT.RESERVED_NAME,
          tokenIndex: i,
        };
      }

      const arity = token === '<' ? 1 : 2;
      const args: (DecisionNode | string)[] = [];
      for (let k = 0; k < arity; k++) {
        const top = stack.pop();
        if (top === undefined) {
          return {
            ok: false,
            code: 'NOT_ENOUGH_ARGS',
            message: ERROR_TEXT.NOT_ENOUGH_ARGS.replace('%s', token),
            tokenIndex: i,
          };
        }
        args.unshift(top);
      }

      let built: DecisionNode;
      switch (token) {
        case '.':
          built = andNode(args[0], args[1]);
          break;
        case ',':
          built = orNode(args[0], args[1]);
          break;
        case '<':
          built = notNode(args[0]);
          break;
        case '>':
          built = implyNode(args[0], args[1]);
          break;
        default:
          built = equalNode(args[0], args[1]);
          break;
      }
      stack.push(built);
      // 只有二元操作符才把两个待归约值合并成一个；`<` 是一元的，栈净变化为 0，
      // 因此不减计数。原版正是靠这一点发现「a b <」里多出来的操作数。
      if (arity === 2) pending--;
      continue;
    }

    // 普通变量名
    if (state === 0) {
      state = 1;
      stack.push(token);
      if (!variables.includes(token)) variables.push(token);
    }
  }

  if (state === 1) pending++;

  if (pending > 1) {
    return { ok: false, code: 'TOO_MANY_ARGS', message: ERROR_TEXT.TOO_MANY_ARGS };
  }

  const tree = stack.pop();
  if (tree === undefined) {
    return { ok: false, code: 'EMPTY', message: ERROR_TEXT.EMPTY };
  }
  return { ok: true, tree, variables };
}

// ---------------------------------------------------------------------------
// ModelGen：决策树 → 化简后的路径集合（Shannon 展开 + 常量折叠）
// ---------------------------------------------------------------------------

export function reduceModel(node: DecisionNode | string): BddModel {
  if (typeof node === 'string') {
    if (node === TRUE) return { value: [{ '.': '>' }], order: [] };
    if (node === FALSE) return { value: [{ '.': '<' }], order: [] };
    return {
      value: [
        { '.': '>' as Polarity, [node]: '>' as Polarity },
        { '.': '<' as Polarity, [node]: '<' as Polarity },
      ],
      order: [node],
    };
  }

  const selector = reduceModel(node.S);

  // 选择变量已被化简成常量 —— 直接取出对应分支。
  if (selector.order.length === 0) {
    return selector.value[0]['.'] === '<' ? reduceModel(node[0]) : reduceModel(node[1]);
  }

  const selectorVars = new Set(selector.order);
  const lowBranch = reduceModel(node[0]);
  const highBranch = reduceModel(node[1]);
  const lowShared = lowBranch.order.filter((x) => selectorVars.has(x));
  const highShared = highBranch.order.filter((x) => selectorVars.has(x));

  const result: BddModel = { value: [], order: [] };
  let sawFalse = false;
  let sawTrue = false;

  for (const path of selector.value) {
    const takeHigh = path['.'] === '>';
    const branch = takeHigh ? highBranch : lowBranch;
    const shared = takeHigh ? highShared : lowShared;
    const branchVars = takeHigh ? highBranch.order : lowBranch.order;

    for (const other of branch.value) {
      // 两条路径在同名变量上取值冲突则无法拼接。
      const compatible = shared.every(
        (v) => path[v] === undefined || other[v] === undefined || path[v] === other[v],
      );
      if (!compatible) continue;

      const merged: BddPath = { ...path };
      for (const v of branchVars) {
        if (other[v] !== undefined) merged[v] = other[v];
      }
      merged['.'] = other['.'];
      if (merged['.'] === '>') sawTrue = true;
      else sawFalse = true;
      result.value.push(merged);
    }
  }

  if (sawFalse && !sawTrue) return { value: [{ '.': '<' }], order: [] };
  if (sawTrue && !sawFalse) return { value: [{ '.': '>' }], order: [] };

  result.order = Array.from(
    new Set([...selector.order, ...lowBranch.order, ...highBranch.order]),
  );
  return result;
}

// ---------------------------------------------------------------------------
// ViewGen：化简结果 → 可渲染的节点 / 连线
// ---------------------------------------------------------------------------

/**
 * 等价于原版的 ViewGen0：把 model 接到 (parentKey, parentPort) 上，
 * 需要时递归插入 SEL（2:1 多路选择器）节点。
 *
 * 原版在找不到公共变量时会返回 undefined 并让调用处抛异常，
 * 这里改为返回空结果。
 */
function expand(
  model: BddModel,
  parentKey: NodeKey,
  parentPort: string,
  nextKey: () => number,
): GraphDesc {
  if (model.value.length === 1) {
    const constant = model.value[0]['.'] === '<' ? FALSE : TRUE;
    return {
      nodeArray: [],
      linkArray: [{ from: constant, frompid: 'OUT', to: parentKey, topid: parentPort }],
    };
  }

  // 选出「所有路径都定义了」的那个变量作为本次选择变量（原版取最后一个匹配项）。
  let selectorVar = '';
  for (const v of model.order) {
    if (model.value.every((p) => p[v] !== undefined)) selectorVar = v;
  }
  if (selectorVar === '') return { nodeArray: [], linkArray: [] };

  const remaining = model.order.filter((v) => v !== selectorVar);
  const lowModel: BddModel = {
    value: model.value.filter((p) => p[selectorVar] === '<'),
    order: remaining,
  };
  const highModel: BddModel = {
    value: model.value.filter((p) => p[selectorVar] === '>'),
    order: remaining,
  };

  const selKey = nextKey();
  const low = expand(lowModel, selKey, '0', nextKey);
  const high = expand(highModel, selKey, '1', nextKey);

  return {
    nodeArray: [{ key: selKey, type: 'SEL' }, ...low.nodeArray, ...high.nodeArray],
    linkArray: [
      { from: selKey, frompid: 'N', to: parentKey, topid: parentPort },
      { from: selectorVar, frompid: 'OUT', to: selKey, topid: 'SI' },
      ...low.linkArray,
      ...high.linkArray,
    ],
  };
}

export function buildGraph(model: BddModel): GraphDesc {
  const result: GraphDesc = {
    nodeArray: [
      { key: '0', type: '0', name: 'Zero' },
      { key: '1', type: '1', name: 'One' },
      { key: '2', type: 'Export', name: 'Out' },
    ],
    linkArray: [],
  };

  let counter = 2;
  const nextKey = () => ++counter;

  for (const v of model.order) {
    result.nodeArray.push({ key: v, type: 'Import', name: v });
  }

  const expanded = expand(model, 2, 'OUT', nextKey);
  result.nodeArray.push(...expanded.nodeArray);
  result.linkArray.push(...expanded.linkArray);
  return result;
}

/** 一步到位：表达式 → 图描述。原版这里是「解析文本」和「文本转图」两步。 */
export function expressionToGraph(expression: string):
  | { ok: true; graph: GraphDesc }
  | { ok: false; code: ParseErrorCode; message: string } {
  const parsed = parseRPN(expression);
  if (!parsed.ok) return parsed;
  return { ok: true, graph: buildGraph(reduceModel(parsed.tree)) };
}
