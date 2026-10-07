/**
 * 主界面。
 *
 * 功能与 2021 年版完全一致：
 *   逆波兰表达式 → 解析文本 → 文本转图 / 图转文本 / 载入文本 / 保存文本 / 修改元素名称
 * 只是把外壳从 W3.CSS + 浮动布局换成了现代的布局与组件。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import type { LogicDiagram, SelectionInfo } from './canvas/LogicDiagram';
import { expressionToGraph } from './core/logic';
import type { GraphDesc } from './core/types';

type StatusKind = 'idle' | 'ok' | 'error';
interface Status {
  text: string;
  kind: StatusKind;
}

const EMPTY_DESC: GraphDesc = { nodeArray: [], linkArray: [] };

/** 原版默认文本框里放的是非法 JSON（键没加引号），一进页面就报错。这里放合法的空图。 */
const EMPTY_JSON = JSON.stringify(EMPTY_DESC);

const OPERATOR_HELP = [
  { token: 'a b .', symbol: '∧', text: 'a 与 b' },
  { token: 'a b ,', symbol: '∨', text: 'a 或 b' },
  { token: 'a <', symbol: '¬', text: '非 a' },
  { token: 'a b >', symbol: '→', text: 'a 推出 b' },
  { token: 'a b =', symbol: '↔', text: 'a 与 b 等价' },
];

const EXAMPLE = 'a b . fe >';

export default function App() {
  const [expression, setExpression] = useState(EXAMPLE);
  const [modelJson, setModelJson] = useState(EMPTY_JSON);
  const [status, setStatus] = useState<Status>({
    text: '就绪。输入逆波兰逻辑表达式后点「解析文本」。',
    kind: 'idle',
  });
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [fileName, setFileName] = useState('logicsim-diagram');
  const [diagram, setDiagram] = useState<LogicDiagram | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('logicsim-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('logicsim-theme', theme);
  }, [theme]);

  const handleReady = useCallback((d: LogicDiagram) => {
    setDiagram(d);
    // 首屏渲染一张空图，和原版 app.load() 的行为一致
    d.render(EMPTY_DESC);
  }, []);

  const handleSelect = useCallback((info: SelectionInfo | null) => {
    setSelection(info);
    setNameInput(info ? info.name : '');
    setMemoInput(info ? info.memo : '');
  }, []);

  // --- 解析文本：逆波兰表达式 → 图 JSON -------------------------------------

  const handleParse = () => {
    const result = expressionToGraph(expression);
    if (!result.ok) {
      setStatus({ text: result.message, kind: 'error' });
      return;
    }
    setModelJson(JSON.stringify(result.graph));
    setStatus({
      text: '表达式已解析为图 JSON。接着点「文本转图」即可绘制。',
      kind: 'ok',
    });
  };

  // --- 文本转图：JSON → 画布 -------------------------------------------------

  const handleRenderFromJson = useCallback(
    (json: string) => {
      let desc: GraphDesc;
      try {
        const parsed = JSON.parse(json) as GraphDesc;
        if (!parsed || !Array.isArray(parsed.nodeArray) || !Array.isArray(parsed.linkArray)) {
          throw new Error('缺少 nodeArray / linkArray');
        }
        desc = parsed;
      } catch (err) {
        diagram?.render(EMPTY_DESC);
        setStatus({
          text: `JSON 格式有误，已清空画布：${(err as Error).message}`,
          kind: 'error',
        });
        return;
      }
      diagram?.render(desc);
      setStatus({ text: '已按 JSON 绘制图形。', kind: 'ok' });
    },
    [diagram],
  );

  const handleLoad = () => handleRenderFromJson(modelJson);

  // --- 图转文本：画布 → JSON -------------------------------------------------

  const handleSave = () => {
    if (!diagram) return;
    setModelJson(JSON.stringify(diagram.dump()));
    setStatus({ text: '已把画布内容导出为图 JSON。', kind: 'ok' });
  };

  // --- 本地文件 --------------------------------------------------------------

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', (evt) => {
      const text = String(evt.target?.result ?? '');
      setModelJson(text);
      handleRenderFromJson(text);
    });
    reader.readAsText(file, 'UTF-8');
    // 允许重复选择同一个文件
    event.target.value = '';
  };

  const handleDownload = () => {
    const blob = new Blob([modelJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName.trim() || 'logicsim-diagram';
    link.click();
    URL.revokeObjectURL(url);
    setStatus({ text: `已保存为 ${fileName.trim() || 'logicsim-diagram'}`, kind: 'ok' });
  };

  // --- 修改元素名称与备注 -----------------------------------------------------

  const handleChangeName = () => {
    if (!diagram || !selection) {
      setStatus({ text: '请先在画布上点选一个元素。', kind: 'error' });
      return;
    }
    const name = nameInput.trim();
    if (canRename && name === '') {
      setStatus({ text: '元素名称不能为空。', kind: 'error' });
      return;
    }
    if (!diagram.renameSelected(name, memoInput)) {
      setStatus({ text: '修改失败，元素可能已被删除。', kind: 'error' });
      return;
    }
    setModelJson(JSON.stringify(diagram.dump()));
    setStatus({ text: '已保存元素修改。', kind: 'ok' });
  };

  // 名称只对输入/输出节点有意义；常量和选择器的名称是固定符号。备注则所有节点都能写。
  const canRename = selection !== null && ['Import', 'Export'].includes(selection.type);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">逻辑仿真器</span>
          <span className="brand-sub">逆波兰表达式 → 二元决策图</span>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="切换明暗主题"
        >
          {theme === 'dark' ? '☀ 浅色' : '☾ 深色'}
        </button>
      </header>

      <div className="workspace">
        <main className="canvas-area">
          <div className="expr-bar">
            <label className="expr-label" htmlFor="expr">
              逆波兰逻辑表达式
            </label>
            <textarea
              id="expr"
              className="expr-input"
              spellCheck={false}
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="例如：a b . fe >"
            />
            <button type="button" className="primary-btn" onClick={handleParse}>
              解析文本
            </button>
          </div>

          <GraphCanvas diagram={diagram} onSelect={handleSelect} onReady={handleReady} />
        </main>

        <aside className="side-panel">
          <section className="panel-section">
            <h2 className="panel-title">图数据（JSON）</h2>
            <textarea
              className="json-input"
              spellCheck={false}
              value={modelJson}
              onChange={(e) => setModelJson(e.target.value)}
              aria-label="图 JSON"
            />
            <div className="btn-row">
              <button type="button" className="btn" onClick={handleLoad}>
                文本转图
              </button>
              <button type="button" className="btn" onClick={handleSave}>
                图转文本
              </button>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
              >
                载入文本
              </button>
              <button type="button" className="btn" onClick={handleDownload}>
                保存文本
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.txt,application/json"
              className="visually-hidden"
              onChange={handleFileChange}
            />
            <input
              className="text-input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              aria-label="保存文件名"
            />
          </section>

          <section className="panel-section">
            <h2 className="panel-title">元素属性</h2>
            <label className="field-label" htmlFor="er-name">
              元素名称
            </label>
            <input
              id="er-name"
              className="text-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="在画布上点选元素后可编辑"
              readOnly={!canRename}
            />
            <label className="field-label" htmlFor="er-memo">
              元素备注
            </label>
            <textarea
              id="er-memo"
              className="text-input"
              rows={2}
              value={memoInput}
              onChange={(e) => setMemoInput(e.target.value)}
              placeholder="仅作标注，不影响逻辑"
              readOnly={selection === null}
            />
            <button
              type="button"
              className="btn wide"
              onClick={handleChangeName}
              disabled={selection === null}
            >
              保存修改
            </button>
            {selection === null && <p className="hint">先在画布上点选一个元素。</p>}
            {selection !== null && !canRename && (
              <p className="hint">
                「{selection.type}」节点的名称是固定符号，不能改；备注可以直接编辑。
              </p>
            )}
          </section>

          <section className="panel-section">
            <h2 className="panel-title">操作符说明</h2>
            <p className="hint">用空格分隔，操作符写在操作数之后。</p>
            <table className="op-table">
              <tbody>
                {OPERATOR_HELP.map((op) => (
                  <tr key={op.token}>
                    <td className="op-symbol">{op.symbol}</td>
                    <td>
                      <code>{op.token}</code>
                      <span className="op-text">{op.text}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              例：<code>a b . fe &gt;</code> 表示「a 与 b 推出 fe」；
              <code>a b . fe ge &gt; =</code> 表示「a 与 b 等价于 fe 推出 ge」。
            </p>
          </section>
        </aside>
      </div>

      <footer className={`statusbar statusbar--${status.kind}`}>
        <span className="status-dot" aria-hidden="true" />
        <span>{status.text}</span>
      </footer>
    </div>
  );
}
