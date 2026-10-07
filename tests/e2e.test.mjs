/**
 * 端到端检查：用真实浏览器跑一遍主要流程。
 * 运行前先起一个静态服务器指向 dist/（默认 http://127.0.0.1:8090）。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8090/';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-initial.png` });

// --- 首次加载不应报错 ---
const statusText = await page.textContent('.statusbar');
check('首屏无 JSON 报错', !statusText.includes('格式有误'), statusText.trim());

// --- 解析文本 ---
await page.fill('#expr', 'a b . fe >');
await page.click('button:has-text("解析文本")');
await page.waitForTimeout(400);
const json = await page.inputValue('.json-input');
check('解析后生成图 JSON', json.includes('SEL') && json.includes('"Import"'), `${json.length} 字符`);

// --- 文本转图 ---
await page.click('button:has-text("文本转图")');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/02-graph.png` });

const nodeCount = await page.locator('.canvas .joint-element').count();
const linkCount = await page.locator('.canvas .joint-link').count();
check('画布渲染出节点', nodeCount > 0, `${nodeCount} 个节点`);
check('画布渲染出连线', linkCount > 0, `${linkCount} 条连线`);

// 图 JSON 里的节点数应与画布一致
const parsed = JSON.parse(json);
check(
  '节点数与 JSON 一致',
  nodeCount === parsed.nodeArray.length,
  `画布 ${nodeCount} / JSON ${parsed.nodeArray.length}`,
);
check(
  '连线数与 JSON 一致',
  linkCount === parsed.linkArray.length,
  `画布 ${linkCount} / JSON ${parsed.linkArray.length}`,
);

// --- 缩略图视口框应有尺寸 ---
const vpBox = await page.locator('.minimap-viewport').boundingBox();
check('缩略图视口框有尺寸', !!vpBox && vpBox.width > 2 && vpBox.height > 2,
  vpBox ? `${Math.round(vpBox.width)}×${Math.round(vpBox.height)}` : 'null');

// --- 选中节点 → 元素属性可编辑 ---
await page.locator('.canvas .joint-element').first().click();
await page.waitForTimeout(400);
const nameValue = await page.inputValue('#er-name');
const nameReadOnly = await page.locator('#er-name').getAttribute('readonly');
check('点选节点后带出名称', nameValue.length > 0, JSON.stringify(nameValue));
check('选中的是 SEL 时名称只读', nameReadOnly !== null, `只读=${nameReadOnly !== null}`);
await page.screenshot({ path: `${OUT}/03-selected.png` });

// --- 图转文本：round-trip ---
await page.click('button:has-text("图转文本")');
await page.waitForTimeout(400);
const roundTripped = await page.inputValue('.json-input');
const rt = JSON.parse(roundTripped);
check(
  '图转文本往返后节点数不变',
  rt.nodeArray.length === parsed.nodeArray.length,
  `${rt.nodeArray.length} vs ${parsed.nodeArray.length}`,
);

// 节点类型必须原样保留 —— 只比数量会漏掉「类型被写成中文说明」这类问题
const typeOf = (g) =>
  g.nodeArray
    .map((n) => `${n.key}:${n.type}`)
    .sort()
    .join(',');
check('往返后节点类型不变', typeOf(rt) === typeOf(parsed), typeOf(rt));
check(
  '往返后连线不变',
  JSON.stringify(rt.linkArray.map((l) => `${l.from}:${l.frompid}->${l.to}:${l.topid}`).sort()) ===
    JSON.stringify(parsed.linkArray.map((l) => `${l.from}:${l.frompid}->${l.to}:${l.topid}`).sort()),
);

// 用往返后的 JSON 重新绘图，图应当还是同样的规模
await page.click('button:has-text("文本转图")');
await page.waitForTimeout(1200);
check(
  '往返后的 JSON 能重新绘图',
  (await page.locator('.canvas .joint-element').count()) === parsed.nodeArray.length,
  `${await page.locator('.canvas .joint-element').count()} 个节点`,
);

// --- 缩放控件 ---
const zoomBefore = await page.textContent('.zoom-value');
await page.click('button[title="放大"]');
await page.waitForTimeout(300);
const zoomAfter = await page.textContent('.zoom-value');
check('放大按钮生效', zoomBefore !== zoomAfter, `${zoomBefore} → ${zoomAfter}`);

await page.click('button[title="适应窗口"]');
await page.waitForTimeout(300);
check('适应窗口可用', (await page.textContent('.zoom-value')) !== null);

// --- 深色主题 ---
await page.click('button:has-text("深色")');
await page.waitForTimeout(500);
const theme = await page.getAttribute('html', 'data-theme');
check('切换到深色主题', theme === 'dark', String(theme));
await page.screenshot({ path: `${OUT}/04-dark.png` });

// --- 错误表达式应给出中文提示 ---
await page.fill('#expr', 'a b <');
await page.click('button:has-text("解析文本")');
await page.waitForTimeout(300);
const errText = await page.textContent('.statusbar');
check('非法表达式给出中文报错', errText.includes('操作数'), errText.trim());
check('报错时状态栏为 error 样式', (await page.getAttribute('.statusbar', 'class')).includes('error'));

// --- 深色模式下的非法 JSON ---
await page.fill('.json-input', 'not json at all');
await page.click('button:has-text("文本转图")');
await page.waitForTimeout(500);
const errText2 = await page.textContent('.statusbar');
check('非法 JSON 给出提示并清空画布',
  errText2.includes('JSON 格式有误') && (await page.locator('.canvas .joint-element').count()) === 0,
  errText2.trim());

// --- 回到浅色，跑一个复杂表达式 ---
await page.click('button:has-text("浅色")');
await page.fill('#expr', 'a b . a c . , b c . ,');
await page.click('button:has-text("解析文本")');
await page.click('button:has-text("文本转图")');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/05-complex.png` });
check('三变量表达式渲染成功',
  (await page.locator('.canvas .joint-element').count()) > 5,
  `${await page.locator('.canvas .joint-element').count()} 个节点`);

// --- 窄屏布局 ---
await page.setViewportSize({ width: 780, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/06-narrow.png`, fullPage: true });
check('窄屏不出现横向滚动',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));

console.log('\n--- 浏览器控制台错误 ---');
console.log(errors.length ? errors.join('\n') : '（无）');

const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
