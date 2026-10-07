/**
 * 画布层 —— 用 JointJS 渲染二元决策图。
 *
 * 对应 2021 年版 ViewGen.js 里 `var graph = new joint.dia.Graph` 往下的部分。
 * 拓扑、端口 ID、连线走向都保持完全一致（SEL 的输出端口仍叫 N，变量仍从 OUT 出），
 * 所以旧版导出的 JSON 可以直接载入。
 *
 * 与旧版的差别只在实现方式：
 *   - 缩放/平移改用 JointJS 内建的 scale / translate，不再手改 CSS 去挪 div
 *   - 缩略图是第二个 Paper，视口框是叠加层，拖动直接换算 translate
 *   - 节点图形是内联 SVG，不再是 16×16 图标被硬拉到 50×50
 *
 * 一处刻意的改动：原版把节点类型写在 label 文字里（"SEL" / "Import" …），
 * 于是改个名就会让导出的 JSON 认不出类型、节点在图里凭空消失。
 * 这里把类型存成元素自身的属性，label 只负责显示中文说明，改名不再有副作用。
 */

import { dia, elementTools, highlighters, linkTools, shapes } from '@joint/core';
import { DirectedGraph } from '@joint/layout-directed-graph';
import type { GraphDesc, GraphLink, GraphNode, NodeType } from '../core/types';

const NODE_SIZE = 96;
const PORT_COLOR = '#64748b';
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

/** 网格点取中性灰，浅色/深色两种主题下都看得见。 */
const GRID_COLOR = 'rgba(125,135,155,0.38)';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 容器的实际像素尺寸，带兜底值，避免布局完成前拿到 0。 */
function sizeOf(el: HTMLElement): { width: number; height: number } {
  return { width: Math.max(el.clientWidth, 1), height: Math.max(el.clientHeight, 1) };
}

/** 每种节点一套配色：浅底 + 饱和描边，明暗主题下都清晰。 */
const PALETTE: Record<NodeType, { fill: string; stroke: string; text: string }> = {
  Import: { fill: '#eef2ff', stroke: '#6366f1', text: '#312e81' },
  '0': { fill: '#fff7ed', stroke: '#f97316', text: '#7c2d12' },
  '1': { fill: '#ecfeff', stroke: '#06b6d4', text: '#164e63' },
  Export: { fill: '#fdf2f8', stroke: '#db2777', text: '#831843' },
  SEL: { fill: '#f5f3ff', stroke: '#8b5cf6', text: '#4c1d95' },
};

/** 节点顶部的中文类型说明。 */
const CAPTION: Record<NodeType, string> = {
  Import: '输入',
  Export: '输出',
  SEL: '选择器',
  '0': '常量',
  '1': '常量',
};

/** JointJS markup 里的一个元素。 */
interface MarkupItem {
  tagName: string;
  selector?: string;
  attributes?: Record<string, string | number>;
  children?: MarkupItem[];
}

interface NodeSpec {
  /** 画在方格中央的图形，内联 SVG，缩放后依然锐利。 */
  glyph: MarkupItem[];
  /** 中央那一行文字（没有文字节点时为空串）。 */
  glyphText: string;
  ports: Array<{ group: 'in' | 'out'; id: string; label: string }>;
}

function specFor(node: GraphNode): NodeSpec {
  const name = node.name ?? '';
  switch (node.type) {
    case '0':
    case '1':
      return {
        glyph: [{ tagName: 'text', selector: 'glyphText' }],
        glyphText: node.type,
        ports: [{ group: 'out', id: 'OUT', label: 'OUT' }],
      };
    case 'Import':
      return {
        glyph: [{ tagName: 'text', selector: 'glyphText' }],
        glyphText: name,
        ports: [{ group: 'out', id: 'OUT', label: 'OUT' }],
      };
    case 'Export':
      return {
        // 出口箭头，替代原版那个被拉糊的漏斗图标。以 (49, 52) 为中心。
        glyph: [
          {
            tagName: 'path',
            selector: 'glyphPath',
            attributes: { d: 'M28 46 H50 V36 L70 52 L50 68 V58 H28 Z' },
          },
        ],
        glyphText: '',
        ports: [{ group: 'in', id: 'OUT', label: 'OUT' }],
      };
    default:
      return {
        // 2:1 多路选择器的标准梯形符号，以 (47, 52) 为中心
        glyph: [
          {
            tagName: 'path',
            selector: 'glyphPath',
            attributes: { d: 'M26 30 L68 42 L68 54 L26 66 Z' },
          },
          { tagName: 'text', selector: 'glyphText' },
        ],
        glyphText: 'MUX',
        ports: [
          { group: 'in', id: 'SI', label: 'SI' },
          { group: 'in', id: '0', label: '0' },
          { group: 'in', id: '1', label: '1' },
          { group: 'out', id: 'SO', label: 'SO' },
          { group: 'out', id: 'N', label: 'N' },
          { group: 'out', id: 'P', label: 'P' },
        ],
      };
  }
}

/**
 * 底部那行小字。
 * 输入节点的变量名已经写在正中央了，底部留给备注；
 * 输出节点没有中央文字，所以没备注时退而显示它的名称（"Out"）。
 */
function bottomTextFor(node: GraphNode, memo: string): string {
  if (memo) return memo;
  return node.type === 'Export' ? (node.name ?? '') : '';
}

export interface SelectionInfo {
  id: string;
  /** 节点类型（Import / Export / SEL / 0 / 1）。 */
  type: NodeType;
  /** 可编辑的名称。 */
  name: string;
  /** 可编辑的备注。 */
  memo: string;
}

export interface DiagramCallbacks {
  onSelect?: (info: SelectionInfo | null) => void;
  onViewportChange?: (zoom: number) => void;
}

export class LogicDiagram {
  private readonly graph: dia.Graph;
  private readonly paper: dia.Paper;
  private readonly miniPaper: dia.Paper;
  private readonly canvasEl: HTMLElement;
  private readonly minimapEl: HTMLElement;
  private readonly viewportEl: HTMLElement;
  private readonly callbacks: DiagramCallbacks;

  private selectedId: string | null = null;
  private readonly highlighted = new Set<string>();
  private observers: ResizeObserver[] = [];
  private disposed = false;

  constructor(
    canvasEl: HTMLElement,
    minimapEl: HTMLElement,
    viewportEl: HTMLElement,
    callbacks: DiagramCallbacks = {},
  ) {
    this.canvasEl = canvasEl;
    this.minimapEl = minimapEl;
    this.viewportEl = viewportEl;
    this.callbacks = callbacks;

    this.graph = new dia.Graph({}, { cellNamespace: shapes });

    // 用容器的实际像素尺寸而不是 '100%'，这样 getComputedSize() 一定准确
    const size = sizeOf(canvasEl);
    this.paper = new dia.Paper({
      el: canvasEl,
      model: this.graph,
      width: size.width,
      height: size.height,
      gridSize: 10,
      drawGrid: { name: 'dot', args: { color: GRID_COLOR, thickness: 1 } },
      background: { color: 'transparent' },
      // 空白处左键拖动 = 平移画布（原版为此手写了一整套 mousemove）
      panning: { enabled: true, eventTypes: ['leftMouseDown'] },
      cellViewNamespace: shapes,
    });

    const miniSize = sizeOf(minimapEl);
    this.miniPaper = new dia.Paper({
      el: minimapEl,
      model: this.graph,
      width: miniSize.width,
      height: miniSize.height,
      background: { color: 'transparent' },
      interactive: false,
      cellViewNamespace: shapes,
    });

    this.bindPaperEvents();
    this.bindMinimapDrag();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        this.resize();
        this.syncMinimap();
      });
      ro.observe(canvasEl);
      ro.observe(minimapEl);
      this.observers.push(ro);
    }
  }

  /** 容器尺寸变化后同步两个 Paper 的尺寸。 */
  resize(): void {
    const size = sizeOf(this.canvasEl);
    if (size.width > 0 && size.height > 0) this.paper.setDimensions(size.width, size.height);
    const miniSize = sizeOf(this.minimapEl);
    if (miniSize.width > 0 && miniSize.height > 0) {
      this.miniPaper.setDimensions(miniSize.width, miniSize.height);
    }
  }

  // -------------------------------------------------------------------------
  // 事件绑定
  // -------------------------------------------------------------------------

  private bindPaperEvents(): void {
    this.paper.on('element:pointerclick', (view: dia.ElementView) =>
      this.select(view.model.id.toString()),
    );
    this.paper.on('link:pointerclick', () => this.select(null));
    this.paper.on('blank:pointerdown', () => this.select(null));

    this.paper.on('element:mouseenter', (view: dia.ElementView) => {
      view.addTools(
        new dia.ToolsView({
          tools: [
            new elementTools.Remove({ x: '100%', y: '0%', offset: { x: -4, y: 4 } }),
            new elementTools.Boundary({ padding: 6, useModelGeometry: true }),
          ],
        }),
      );
    });

    this.paper.on('link:mouseenter', (view: dia.LinkView) => {
      view.addTools(
        new dia.ToolsView({
          tools: [
            new linkTools.Remove({ distance: -20 }),
            new linkTools.Boundary({ padding: 6, useModelGeometry: true }),
          ],
        }),
      );
    });

    this.paper.on('cell:mouseleave', (view: dia.CellView) => view.removeTools());

    // 删掉节点/连线后刷新缩略图
    this.graph.on('remove', () => {
      if (this.selectedId && !this.graph.getCell(this.selectedId)) this.select(null);
      this.syncMinimap();
    });

    // 滚轮缩放，以光标为锚点
    this.paper.el.addEventListener(
      'wheel',
      (evt: WheelEvent) => {
        evt.preventDefault();
        this.zoomAt(evt.clientX, evt.clientY, evt.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false },
    );
  }

  private bindMinimapDrag(): void {
    const panTo = (clientX: number, clientY: number) => {
      const rect = this.minimapEl.getBoundingClientRect();
      const m = this.minimapTransform(rect);
      // 缩略图坐标 → 主画布局部坐标 → 反推 translate，使该点落到视口中心
      const localX = (clientX - rect.left - m.tx) / m.scale;
      const localY = (clientY - rect.top - m.ty) / m.scale;
      const { sx } = this.paper.scale();
      const size = this.paper.getComputedSize();
      this.paper.translate(size.width / 2 - localX * sx, size.height / 2 - localY * sx);
      this.syncMinimap();
    };

    let dragging = false;

    this.viewportEl.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      dragging = true;
      this.viewportEl.setPointerCapture(evt.pointerId);
      panTo(evt.clientX, evt.clientY);
    });
    this.viewportEl.addEventListener('pointermove', (evt) => {
      if (dragging) panTo(evt.clientX, evt.clientY);
    });
    const stop = () => {
      dragging = false;
    };
    this.viewportEl.addEventListener('pointerup', stop);
    this.viewportEl.addEventListener('pointercancel', stop);

    // 点缩略图空白处也直接跳过去
    this.minimapEl.addEventListener('pointerdown', (evt) => {
      if (evt.target === this.viewportEl) return;
      panTo(evt.clientX, evt.clientY);
    });
  }

  // -------------------------------------------------------------------------
  // 渲染 / 导出
  // -------------------------------------------------------------------------

  render(desc: GraphDesc): void {
    const cells: dia.Cell[] = [];
    for (const node of desc.nodeArray) cells.push(this.createNode(node));
    for (const link of desc.linkArray) cells.push(this.createLink(link));

    this.clearHighlight();
    this.selectedId = null;
    this.callbacks.onSelect?.(null);
    this.graph.resetCells(cells);

    // 间距要留够：端口标签是画在节点外侧的，挨太近会互相压住
    DirectedGraph.layout(this.graph, {
      setLinkVertices: false,
      nodeSep: 110,
      edgeSep: 70,
      rankSep: 130,
      rankDir: 'LR',
    });

    this.zoomToFit();
  }

  /** 按原版 ELDump 的规则把画布上的图导回 JSON。 */
  dump(): GraphDesc {
    const result: GraphDesc = { nodeArray: [], linkArray: [] };

    for (const cell of this.graph.getCells()) {
      if (cell.isLink()) {
        const source = cell.source() as { id?: string; port?: string };
        const target = cell.target() as { id?: string; port?: string };
        result.linkArray.push({
          from: source.id ?? '',
          frompid: source.port ?? '',
          to: target.id ?? '',
          topid: target.port ?? '',
        });
      } else {
        const type = cell.get('nodeType') as NodeType | undefined;
        if (!type) continue;
        const node: GraphNode = { key: cell.id.toString(), type };
        if (type === 'Import' || type === 'Export') {
          node.name = String(cell.get('nodeName') ?? '');
        }
        const memo = cell.get('memo');
        if (typeof memo === 'string' && memo !== '') node.memo = memo;
        result.nodeArray.push(node);
      }
    }
    return result;
  }

  /** 依据 nodeType / nodeName / memo 这三个属性刷新节点上的显示文字。 */
  private refreshDisplay(cell: dia.Element): void {
    const type = cell.get('nodeType') as NodeType;
    const name = String(cell.get('nodeName') ?? '');
    const memo = String(cell.get('memo') ?? '');

    if (type === 'Import') cell.attr('glyphText/text', name);
    else if (type === 'SEL') cell.attr('glyphText/text', 'MUX');
    else if (type === '0' || type === '1') cell.attr('glyphText/text', type);

    cell.attr('name/text', bottomTextFor({ key: cell.id.toString(), type, name }, memo));
  }

  /**
   * 改选中节点的名称与备注。
   * 备注重任何节点都能改；名称只在输入/输出节点上有意义，
   * 常量和选择器的名称是固定符号（0 / 1 / MUX），改了会让人看不懂图。
   */
  renameSelected(name: string, memo: string): boolean {
    if (!this.selectedId) return false;
    const cell = this.graph.getCell(this.selectedId) as dia.Element | undefined;
    if (!cell) return false;

    const type = cell.get('nodeType') as NodeType | undefined;
    if (!type) return false;

    cell.set('memo', memo.trim());
    if (type === 'Import' || type === 'Export') cell.set('nodeName', name.trim());
    this.refreshDisplay(cell);
    return true;
  }

  /** 返回当前选中的节点 id。 */
  getSelection(): string | null {
    return this.selectedId;
  }

  select(id: string | null): void {
    this.clearHighlight();
    this.selectedId = id;

    if (!id) {
      this.callbacks.onSelect?.(null);
      return;
    }

    const cell = this.graph.getCell(id);
    if (!cell) {
      this.selectedId = null;
      this.callbacks.onSelect?.(null);
      return;
    }

    const view = cell.findView(this.paper);
    if (view) {
      highlighters.mask.add(view, cell.isLink() ? 'line' : 'root', 'selected', {
        padding: 5,
        attrs: { stroke: '#2563eb', 'stroke-width': 2 },
        deep: true,
      });
      this.highlighted.add(id);
    }

    // 相连的线一并高亮，方便看清它在图里的位置
    for (const link of this.graph.getLinks()) {
      const source = link.source() as { id?: string };
      const target = link.target() as { id?: string };
      if (source.id !== id && target.id !== id) continue;
      const linkView = link.findView(this.paper);
      if (!linkView) continue;
      highlighters.mask.add(linkView, 'line', 'related', {
        attrs: { stroke: '#60a5fa', 'stroke-width': 2 },
        deep: true,
      });
      this.highlighted.add(link.id.toString());
    }

    if (cell.isElement()) {
      const type = (cell.get('nodeType') as NodeType | undefined) ?? 'Import';
      this.callbacks.onSelect?.({
        id,
        type,
        name: String(cell.get('nodeName') ?? ''),
        memo: String(cell.get('memo') ?? ''),
      });
    }
  }

  private clearHighlight(): void {
    for (const id of this.highlighted) {
      const cell = this.graph.getCell(id);
      if (!cell) continue;
      const mainView = cell.findView(this.paper);
      if (mainView) dia.HighlighterView.remove(mainView);
    }
    this.highlighted.clear();
  }

  // -------------------------------------------------------------------------
  // 视口
  // -------------------------------------------------------------------------

  zoomBy(factor: number): void {
    const size = this.paper.getComputedSize();
    const rect = this.canvasEl.getBoundingClientRect();
    this.zoomAt(rect.left + size.width / 2, rect.top + size.height / 2, factor);
  }

  getZoom(): number {
    return this.paper.scale().sx;
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvasEl.getBoundingClientRect();
    const sx = this.paper.scale().sx;
    const next = clamp(sx * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - sx) < 1e-6) return;

    const { tx, ty } = this.paper.translate();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    // 让光标下的那个点保持不动
    this.paper.scale(next, next);
    this.paper.translate(px - (px - tx) * (next / sx), py - (py - ty) * (next / sx));
    this.syncMinimap();
  }

  zoomToFit(): void {
    this.paper.scale(1, 1);
    this.paper.translate(0, 0);
    this.paper.scaleContentToFit({ padding: 40, minScale: MIN_ZOOM, maxScale: 1 });
    this.centerContent();
    this.syncMinimap();
  }

  /** 缩放到刚好铺满可视区之后，把内容推进视口中间。 */
  private centerContent(): void {
    const size = this.paper.getComputedSize();
    const content = this.paper.getContentArea({ useModelGeometry: true });
    if (content.width === 0 || content.height === 0) return;

    const { sx, sy } = this.paper.scale();
    const { tx, ty } = this.paper.translate();
    const left = tx + content.x * sx;
    const top = ty + content.y * sy;
    const right = tx + (content.x + content.width) * sx;
    const bottom = ty + (content.y + content.height) * sy;

    let dx = 0;
    let dy = 0;
    if (left < 0) dx = -left;
    else if (right > size.width) dx = size.width - right;
    if (top < 0) dy = -top;
    else if (bottom > size.height) dy = size.height - bottom;

    this.paper.translate(tx + dx, ty + dy);
  }

  // -------------------------------------------------------------------------
  // 缩略图
  // -------------------------------------------------------------------------

  /** 缩略图自身的变换：把整张图缩进小框并居中。 */
  private minimapTransform(rect: DOMRect): { scale: number; tx: number; ty: number } {
    const pad = 10;
    const bbox = this.graph.getBBox() ?? { x: 0, y: 0, width: 1, height: 1 };
    const w = Math.max(bbox.width, 1);
    const h = Math.max(bbox.height, 1);
    const scale = Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h);
    return {
      scale,
      tx: (rect.width - w * scale) / 2 - bbox.x * scale,
      ty: (rect.height - h * scale) / 2 - bbox.y * scale,
    };
  }

  private syncMinimap(): void {
    if (this.disposed) return;
    const rect = this.minimapEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const m = this.minimapTransform(rect);
    this.miniPaper.scale(m.scale, m.scale);
    this.miniPaper.translate(m.tx, m.ty);

    // 主画布当前可见的局部坐标区域
    const size = this.paper.getComputedSize();
    const { sx } = this.paper.scale();
    const { tx, ty } = this.paper.translate();

    this.viewportEl.style.left = `${(-tx / sx) * m.scale + m.tx}px`;
    this.viewportEl.style.top = `${(-ty / sx) * m.scale + m.ty}px`;
    this.viewportEl.style.width = `${(size.width / sx) * m.scale}px`;
    this.viewportEl.style.height = `${(size.height / sx) * m.scale}px`;

    this.callbacks.onViewportChange?.(sx);
  }

  dispose(): void {
    this.disposed = true;
    for (const ro of this.observers) ro.disconnect();
    this.observers = [];
    this.paper.remove();
    this.miniPaper.remove();
    this.graph.clear();
  }

  // -------------------------------------------------------------------------
  // 节点与连线的构造
  // -------------------------------------------------------------------------

  private createNode(node: GraphNode): dia.Element {
    const spec = specFor(node);
    const palette = PALETTE[node.type] ?? PALETTE.Import;

    const markup: MarkupItem[] = [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'text', selector: 'label' },
      { tagName: 'g', selector: 'glyphGroup', children: spec.glyph },
      { tagName: 'text', selector: 'name' },
    ];

    const element = new shapes.standard.Rectangle({
      id: String(node.key),
      size: { width: NODE_SIZE, height: NODE_SIZE },
      attrs: {
        body: {
          fill: palette.fill,
          stroke: palette.stroke,
          strokeWidth: 2,
          rx: 14,
          ry: 14,
        },
        label: {
          text: CAPTION[node.type] ?? node.type,
          fontSize: 11,
          fontFamily: 'inherit',
          fontWeight: 600,
          fill: palette.text,
          opacity: 0.65,
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          x: 'calc(0.5*w)',
          y: 18,
        },
        glyphGroup: {
          fill: palette.text,
          stroke: palette.text,
          strokeWidth: 2.5,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        },
        glyphText: {
          text: spec.glyphText,
          textAnchor: 'middle',
          fontFamily: 'inherit',
          fill: palette.text,
          stroke: 'none',
          // 选择器中央的文字要待在梯形里面，字号和位置都另算
          fontSize: node.type === 'SEL' ? 10 : 30,
          fontWeight: node.type === 'SEL' ? 600 : 700,
          x: node.type === 'SEL' ? 45 : 48,
          y: node.type === 'SEL' ? 52 : 60,
        },
        glyphPath: { fill: 'none', stroke: palette.text },
        name: {
          text: bottomTextFor(node, node.memo ?? ''),
          fontSize: 11,
          fontFamily: 'inherit',
          fill: palette.text,
          opacity: 0.8,
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          x: 'calc(0.5*w)',
          y: 'calc(h-14)',
        },
      },
      markup,
      ports: {
        groups: {
          in: {
            position: { name: 'left' },
            attrs: {
              portBody: { magnet: true, r: 5, fill: PORT_COLOR, stroke: '#fff', strokeWidth: 2 },
              portLabel: {
                fill: PORT_COLOR,
                fontSize: 10,
                fontFamily: 'inherit',
                fontWeight: 500,
              },
            },
            // 标签放在端口的外侧偏上：连线是水平进出端口的，
            // 标签若和端口同高就会被箭头压住（原版就是这样，左边的 SI/0/1 全看不见）。
            markup: [
              { tagName: 'circle', selector: 'portBody' },
              {
                tagName: 'text',
                selector: 'portLabel',
                attributes: { x: -11, y: -7, 'text-anchor': 'end' },
              },
            ],
          },
          out: {
            position: { name: 'right' },
            attrs: {
              portBody: { magnet: true, r: 5, fill: PORT_COLOR, stroke: '#fff', strokeWidth: 2 },
              portLabel: {
                fill: PORT_COLOR,
                fontSize: 10,
                fontFamily: 'inherit',
                fontWeight: 500,
              },
            },
            markup: [
              { tagName: 'circle', selector: 'portBody' },
              { tagName: 'text', selector: 'portLabel', attributes: { x: 11, y: -7 } },
            ],
          },
        },
        items: spec.ports.map((p) => ({
          group: p.group,
          id: p.id,
          attrs: { portLabel: { text: p.label } },
        })),
      },
    });

    // 类型和名称都存在元素属性里，label 只负责显示，改名不会影响导出的 JSON
    element.set('nodeType', node.type);
    element.set('nodeName', node.name ?? '');
    element.set('memo', node.memo ?? '');
    return element;
  }

  private createLink(link: GraphLink): dia.Link {
    return new shapes.standard.Link({
      source: { id: String(link.from), magnet: 'portBody', port: link.frompid },
      target: { id: String(link.to), magnet: 'portBody', port: link.topid },
      attrs: {
        line: {
          stroke: '#94a3b8',
          strokeWidth: 2,
          targetMarker: {
            type: 'path',
            d: 'M 10 -5 0 0 10 5 z',
            fill: '#94a3b8',
            stroke: 'none',
          },
        },
      },
      connector: { name: 'jumpover', args: { size: 6 } },
      router: {
        name: 'metro',
        args: { step: 12, startDirections: ['right'], endDirections: ['left'] },
      },
    });
  }
}
