/**
 * 画布区域：主画布 + 缩略图导航 + 缩放控件。
 *
 * JointJS 是命令式的，用 ref 挂载在 React 之外；
 * 这里只负责生命周期和把控件事件转发给 LogicDiagram。
 */

import { useEffect, useRef, useState } from 'react';
import { LogicDiagram } from '../canvas/LogicDiagram';
import type { SelectionInfo } from '../canvas/LogicDiagram';

interface Props {
  /** 图数据变化时传入新的描述，由画布渲染。null 表示不渲染。 */
  diagram: LogicDiagram | null;
  onSelect: (info: SelectionInfo | null) => void;
  /** 把创建好的 LogicDiagram 交给上层，用于后续的渲染/导出操作。 */
  onReady: (diagram: LogicDiagram) => void;
}

export function GraphCanvas({ diagram, onSelect, onReady }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  // 用 ref 保存回调，避免它们变化时重建整个 LogicDiagram
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const minimapEl = minimapRef.current;
    const viewportEl = viewportRef.current;
    if (!canvasEl || !minimapEl || !viewportEl) return;

    const diagram = new LogicDiagram(canvasEl, minimapEl, viewportEl, {
      onSelect: (info) => onSelectRef.current(info),
      onViewportChange: (sx) => setZoom(sx),
    });
    onReadyRef.current(diagram);

    return () => {
      diagram.dispose();
    };
    // 只创建一次：容器元素在整个生命周期内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="canvas-host">
        <div className="canvas" ref={canvasRef} />

        <div className="minimap" title="缩略图：拖动方框或点击可快速定位">
          <div className="minimap-inner" ref={minimapRef} />
          <div className="minimap-viewport" ref={viewportRef} />
        </div>

        <div className="zoom-controls">
          <button
            type="button"
            className="icon-btn"
            title="缩小"
            onClick={() => diagram?.zoomBy(1 / 1.2)}
          >
            −
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            title="放大"
            onClick={() => diagram?.zoomBy(1.2)}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="适应窗口"
            onClick={() => diagram?.zoomToFit()}
          >
            ⤢
          </button>
        </div>
      </div>
    </>
  );
}
