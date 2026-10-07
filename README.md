# 逻辑仿真器 · 现代化重写

把 2021 年的 <https://kuangdash.gitlab.io/logicsim> 用现代前端技术栈重写了一遍。

**功能完全没变**：输入逆波兰逻辑表达式，解析后画出对应的二元决策图（BDD）。
改造的只是外壳 —— 技术栈、布局、视觉、以及若干原版就存在的缺陷。

---

## 这个工具做什么

输入一个**逆波兰（后缀）逻辑表达式**，把它转换成一张逻辑电路图。

支持五种操作符：

| 写法 | 符号 | 含义 |
| --- | --- | --- |
| `a b .` | ∧ | a 与 b |
| `a b ,` | ∨ | a 或 b |
| `a <` | ¬ | 非 a |
| `a b >` | → | a 推出 b |
| `a b =` | ↔ | a 与 b 等价（同或） |

例如 `a b . fe >` 表示「a 与 b 推出 fe」。

处理流程与数学含义：

1. `LogicParser` 把逆波兰表达式解析成一棵 **Shannon 展开**形式的决策树；
2. `ModelGen` 对决策树做**常量折叠与路径合并**，得到化简后的 BDD；
3. `ViewGen` 把化简结果展开成节点 / 连线，其中 `SEL` 节点就是 2:1 多路选择器。

图中四类节点：`Import`（输入变量）、`Zero` / `One`（常量）、`SEL`（多路选择器）、`Export`（输出）。

---

## 改造前后

| | 2021 年原版 | 本仓库 |
| --- | --- | --- |
| 框架 | jQuery + Backbone + Lodash | React 19 + TypeScript |
| 构建 | 无，直接 `<script>` 引入 | Vite 8 |
| 图形库 | JointJS 3.3.1 | JointJS 4.3.3 |
| 样式 | W3.CSS + 浮动布局 | CSS 设计令牌 + Grid，含深色模式 |
| 中文字体 | 自带 1.6 MB TTF | 系统字体栈，0 字节 |
| 产物体积 | 约 3.6 MB | **220 KB（gzip）** |
| 主题 | 仅浅色 | 浅色 / 深色，记住选择 |
| 缩放 | 仅滚轮 | 滚轮 + 按钮 + 一键适应窗口 |
| 窄屏 | 布局塌陷 | 右栏自动折到下方 |

### 顺手修掉的原版缺陷

这些都不是新功能，是原版确实做错的地方：

1. **首屏就报错。** 原版 JSON 文本框的默认值 `{nodeArray: [], linkArray: []}` 键名没加引号，不是合法 JSON，一进页面状态栏就是 "JSON format Error"。现已改为合法空图。
2. **非法表达式被静默接受。** 输入 `a b`（栈里剩两个值）时，原版悄悄丢掉 `a`、只画出 `b` 的图，不给任何提示。现在会明确报「操作数过多」。
3. **改名会让节点凭空消失。** 原版把节点类型写在 label 文字里，改个名之后导出的 JSON 里 `type` 就认不出来了，该节点再从 JSON 载入时会渲染不出来。现在类型单独存在元素属性上，改名不影响导出。
4. **元素备注存不下来。** 原版有「元素备注」输入框，但导出 JSON 时把备注丢了。现在会一并保存。
5. **端口标签看不见。** 原版左侧的 `SI` / `0` / `1` 和连线箭头画在同一水平线上，被完全盖住。现在标签移到端口外侧偏上。
6. **图标被拉糊。** 原版把 16×16 的 IcoMoon 图标硬拉到 50×50，很模糊。现在改用内联 SVG 绘制（梯形选择器、出口箭头）。
7. **不可选中文本。** 原版全局 `user-select: none`，连报错信息都复制不了。现在只对画布禁用。
8. **死代码。** 删掉了引用不存在元素 `#sheet3` 的 select2 初始化，以及引用未定义字段 `chosedElements.Sheets` 的死函数。

---

## 本地运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 产物输出到 dist/
npm run preview    # 预览构建产物
npm run typecheck  # 类型检查
```

`vite.config.ts` 里 `base` 设为 `'./'`，所以 `dist/` 放在任何子路径下都能直接用，
不需要为 GitHub Pages 的子路径改配置。

## 部署到 GitHub Pages

仓库里已经配好 `.github/workflows/deploy.yml`，推送到 `main` 就会自动构建并发布。

只需要在仓库里做一次设置：

> **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**

之后每次 `git push` 都会自动重新部署。

---

## 测试

```bash
npm run test:logic   # 差分测试：与原版 2021 版逐例对比
```

`tests/logic.test.mjs` 会把原版 `legacy/LogicParser.js` 和本仓库的 TypeScript 移植版
放在一起跑 425 个表达式（手写样例 + 400 个随机生成），逐一比对产出的图结构。

当前结果：**423 个完全一致，2 个是上面第 2 条里说明的、故意修掉的差异，0 个意外差异。**

```bash
npm run test:e2e     # 端到端：需要先 npm run preview
```

`tests/e2e.test.mjs` 用真实浏览器跑一遍主要流程（解析、绘图、往返导出、缩放、
主题切换、报错处理、窄屏），检查节点/连线数量与 JSON 是否一致、节点类型是否原样保留。

---

## 目录结构

```
src/
  core/
    types.ts            逻辑引擎的数据类型
    logic.ts            逆波兰解析 → BDD 化简 → 图描述（移植自原版 LogicParser.js）
  canvas/
    LogicDiagram.ts     JointJS 画布、缩略图、缩放平移（移植自原版 ViewGen.js）
  components/
    GraphCanvas.tsx     画布区域的 React 封装
  styles/
    app.css             设计令牌与全部样式
  App.tsx               主界面
legacy/
  LogicParser.js        2021 年原版实现，留作差分测试的基准
```

---

## 兼容性

导出的图 JSON 与原版格式一致（`nodeArray` / `linkArray`，节点类型 `0` / `1` /
`Import` / `Export` / `SEL`，端口 ID 沿用 `OUT` / `SI` / `0` / `1` / `SO` / `N` / `P`），
**原版导出的文件可以直接载入**。新增的 `memo` 字段是可选的，旧文件里没有也不影响。
