# 第三方依赖许可

本项目自身是 2021 年版 <https://kuangdash.gitlab.io/logicsim> 的重写，
使用的第三方依赖及其许可如下。所有依赖都以**未修改**的形式作为库使用。

| 依赖 | 版本 | 许可 | 说明 |
| --- | --- | --- | --- |
| [@joint/core](https://www.npmjs.com/package/@joint/core) | 4.3.3 | MPL-2.0 | 图形绘制库 JointJS 的开源内核 |
| [@joint/layout-directed-graph](https://www.npmjs.com/package/@joint/layout-directed-graph) | 4.3.0 | MPL-2.0 | JointJS 的有向图自动布局（封装 dagre） |
| [React](https://react.dev/) | 19.3.0 | MIT | 界面框架 |
| [Vite](https://vite.dev/) | 8.3.3 | MIT | 构建工具 |

## 关于 MPL-2.0

JointJS 以 Mozilla Public License 2.0 发布。MPL-2.0 是**文件级**的弱著佐权许可：
以未修改的形式把 JointJS 作为依赖使用，不会影响本项目自身代码的授权方式。

按 MPL-2.0 第 3.2 条的要求，在此声明：本项目分发的构建产物中包含
JointJS 的源代码，其源代码形式受 MPL-2.0 约束，许可全文见
<https://www.mozilla.org/en-US/MPL/2.0/>。
JointJS 的完整源代码可从 npm 包 `@joint/core` 与其
[官方仓库](https://github.com/clientIO/joint) 获取。

## 关于原版

2021 年原版的逻辑算法（`LogicParser.js`）以参考与测试基准的目的收录在
本仓库的 `legacy/` 目录下，**未作修改**。
