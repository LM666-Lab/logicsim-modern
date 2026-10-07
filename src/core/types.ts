/**
 * 逻辑引擎的数据类型。
 *
 * 这套类型对应原版 2021 年版 LogicParser.js / ViewGen.js 的数据形状，
 * 保持完全一致，以便兼容旧版导出的 JSON 文件。
 */

/** 二元决策树中的分支极性：'<' 表示取假分支，'>' 表示取真分支。 */
export type Polarity = '<' | '>';

/**
 * LogicParser 解析逆波兰表达式后得到的二元决策树节点（Shannon 展开形式）。
 *
 * `S` 是选择变量（或子树），`0` / `1` 分别是该变量取假 / 取真时的分支。
 * 叶子位置可能出现字符串：变量名、或者常量 '0' / '1'。
 */
export interface DecisionNode {
  S: DecisionNode | string;
  0: DecisionNode | string;
  1: DecisionNode | string;
}

/** 决策树叶子位置可能出现的字符串。 */
export type LeafValue = string;

/**
 * ModelGen 的产物：把决策树化简成一组「路径 → 终值」的表示。
 *
 * `order` 是化简后仍然相关的变量顺序；
 * `value` 中每一项都是一条完整路径，键为变量名、值为该变量的极性，
 * 特殊键 `'.'` 表示这条路径的终值（'>' 为真，'<' 为假）。
 */
export interface BddModel {
  value: BddPath[];
  order: string[];
}

export type BddPath = { '.': Polarity } & Record<string, Polarity | undefined>;

/** 图的节点类型。与原版一致：常量 0 / 常量 1 / 输入变量 / 输出 / 选择器。 */
export type NodeType = '0' | '1' | 'Import' | 'Export' | 'SEL';

/** 原版中节点 key 既有字符串也有数字，为保持 JSON 兼容性此处保留联合类型。 */
export type NodeKey = string | number;

export interface GraphNode {
  key: NodeKey;
  type: NodeType;
  name?: string;
  /** 用户通过检查器添加的备注。原版存在 JSON 里但渲染时未使用，此处保留字段。 */
  memo?: string;
}

export interface GraphLink {
  from: NodeKey;
  frompid: string;
  to: NodeKey;
  topid: string;
}

/** 可用于渲染 / 导入导出的图描述。 */
export interface GraphDesc {
  nodeArray: GraphNode[];
  linkArray: GraphLink[];
}

/** 解析失败时的错误分类，用于给出针对性的中文提示。 */
export type ParseErrorCode =
  | 'EMPTY'
  | 'NOT_ENOUGH_ARGS'
  | 'TOO_MANY_ARGS'
  | 'RESERVED_NAME';

export interface ParseSuccess {
  ok: true;
  tree: DecisionNode | string;
  /** 按首次出现顺序记录的变量名。 */
  variables: string[];
}

export interface ParseFailure {
  ok: false;
  code: ParseErrorCode;
  message: string;
  /** 出错位置（原表达式中第几个 token，从 0 开始），用于高亮。 */
  tokenIndex?: number;
}

export type ParseResult = ParseSuccess | ParseFailure;
