/**
 * 差分测试：把 2021 年原版 LogicParser.js 与本次 TypeScript 移植版
 * 在大量表达式上逐一对比，确认移植没有改变任何行为。
 *
 * 运行：node differential.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { expressionToGraph } from '../src/core/logic.ts';

// 路径按本文件所在位置解析，这样从任何工作目录运行都可以
const here = dirname(fileURLToPath(import.meta.url));

// --- 载入原版实现（原文件不是 ES module，用 vm 在非严格模式下执行以保留其隐式全局） ---
const legacySource = readFileSync(join(here, '../legacy/LogicParser.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(legacySource, sandbox);
const { LogicParser, ModelGen, ViewGen } = sandbox;

/**
 * 原版 LogicParser 用「返回字符串」同时表达两件事：报错信息，和叶子节点（变量名 / '0' / '1'）。
 * 只能靠文案特征区分 —— 这是原版 API 本身的歧义，不是移植差异。
 */
function isLegacyError(v) {
  return (
    v === 'Empty String!' ||
    v.startsWith('Format Error') ||
    v === 'use wrong Name as variable'
  );
}

function legacyPipeline(expr) {
  try {
    const parsed = LogicParser(expr);
    if (typeof parsed === 'string' && isLegacyError(parsed)) return { error: parsed };
    // 原版对纯空白输入会返回 undefined，随后 ModelGen 抛异常 —— 归为「报错」。
    if (parsed === undefined) return { error: 'undefined (原版崩溃)' };
    return { graph: ViewGen(ModelGen(parsed)) };
  } catch (e) {
    return { error: `throw: ${e.message}` };
  }
}

function modernPipeline(expr) {
  const r = expressionToGraph(expr);
  if (!r.ok) return { error: r.message, code: r.code };
  return { graph: r.graph };
}

/** 只比较结构与拓扑，忽略 key 的数字/字符串差异（原版自身就不一致）。 */
function normalize(g) {
  return {
    nodes: g.nodeArray
      .map((n) => `${n.key}|${n.type}|${n.name ?? ''}`)
      .sort(),
    links: g.linkArray
      .map((l) => `${l.from}:${l.frompid}->${l.to}:${l.topid}`)
      .sort(),
  };
}

// --- 用例：手写样例 + 随机生成 ---
const handwritten = [
  'a b . fe >',
  'a b . fe ge > =',
  'a b ,',
  'a b .',
  'a <',
  'a b >',
  'a b =',
  'a a >',
  'a a < .',
  'a b , a b . < , .',
  'a b . a c . , b c . ,',
  'a < b < ,',
  '1',
  '0',
  'a',
  'a b c . .',
  'a b . c >',
  'x y , z .',
  // 错误用例
  '',
  '   ',
  'a b',
  'a b . c',
  'a .',
  ',',
  'a b <',
];

function randomExpr(depth, vars) {
  if (depth === 0) return vars[Math.floor(Math.random() * vars.length)];
  const r = Math.random();
  if (r < 0.15) return `${randomExpr(depth - 1, vars)} <`;
  const op = ['.', ',', '>', '='][Math.floor(Math.random() * 4)];
  return `${randomExpr(depth - 1, vars)} ${randomExpr(depth - 1, vars)} ${op}`;
}

const vars = ['a', 'b', 'c', 'd'];
const random = [];
for (let i = 0; i < 400; i++) {
  random.push(randomExpr(1 + Math.floor(Math.random() * 4), vars));
}

/**
 * 已知且「故意」的差异：原版对栈里剩余的操作数睁一只眼闭一只眼，
 * 静默丢弃后照样出一张图（'a b' 会画成只有 b）。新版按非法逆波兰式报错。
 */
const KNOWN_INTENTIONAL = new Map([
  ['a b', '原版静默丢弃 a，只画出 b'],
  ['a b . c', '原版静默丢弃 a b . ，只画出 c'],
]);

const cases = [...handwritten, ...random];

let pass = 0;
let fail = 0;
let knownDiff = 0;
const failures = [];

for (const expr of cases) {
  const legacy = legacyPipeline(expr);
  const modern = modernPipeline(expr);

  // 错误用例：两边都应当报错（文案可以不同）
  if (legacy.error !== undefined || modern.error !== undefined) {
    const bothErrored = legacy.error !== undefined && modern.error !== undefined;
    if (bothErrored) {
      pass++;
      continue;
    }
    if (KNOWN_INTENTIONAL.has(expr)) {
      knownDiff++;
      continue;
    }
    failures.push({
      expr,
      reason: '一边报错一边成功',
      legacy: legacy.error ?? '(ok)',
      modern: modern.error ?? '(ok)',
    });
    fail++;
    continue;
  }

  const a = JSON.stringify(normalize(legacy.graph));
  const b = JSON.stringify(normalize(modern.graph));
  if (a === b) {
    pass++;
  } else {
    fail++;
    failures.push({ expr, reason: '图结构不一致', legacy: a, modern: b });
  }
}

console.log(`用例总数:   ${cases.length}`);
console.log(`一致:       ${pass}`);
console.log(`已知故意差异: ${knownDiff}`);
console.log(`意外不一致:   ${fail}`);
if (failures.length) {
  console.log('\n--- 前 10 个差异 ---');
  for (const f of failures.slice(0, 10)) {
    console.log(`\n表达式: ${JSON.stringify(f.expr)}`);
    console.log(`原因:   ${f.reason}`);
    console.log(`原版:   ${String(f.legacy).slice(0, 300)}`);
    console.log(`新版:   ${String(f.modern).slice(0, 300)}`);
  }
}

if (fail > 0) {
  console.log('\n结果: 失败');
  process.exit(1);
}
console.log('\n结果: 全部通过');
