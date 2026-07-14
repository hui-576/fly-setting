# 自主决策

按时间追加自治阶段发生的非显然实现决策、依据、影响范围和回退方式。不要重复已经写入需求、方案或 ADR 的内容。

## 2026-07-15 TASK-001：TypeScript 7 的 Vue 类型检查路线

- 决策：保留封存方案指定的 TypeScript 7.0.2；Web 工作区使用官方 `tsc` 检查独立 TypeScript 模块，并由 Vite 编译 Vue SFC，不使用当前依赖 TypeScript 私有 `lib/tsc` 路径的 `vue-tsc`。
- 依据：`vue-tsc` 3.2.5 与 3.3.7 在 TypeScript 7.0.2 下均因 `ERR_PACKAGE_PATH_NOT_EXPORTED` 无法启动；降级 TypeScript 会违背封存技术基线。
- 影响：组件业务规则必须下沉到 `.ts` 模块并由 Vitest 覆盖；Vite build 作为 SFC 语法与模板编译门禁。TASK-001 之后持续复核 `vue-tsc` 的 TS7 兼容版本，兼容后可无行为变化地恢复模板级类型检查。
- 回退：若 Vite 无法可靠编译或业务逻辑无法保持模块化，则重新评估经用户批准的技术基线，而不是静默降低检查标准。

## 2026-07-15 TASK-001：Mars3D 运行时 CSP 最小例外

- 决策：本地 FastAPI 响应的 `script-src` 保留 `'unsafe-eval'` 与 `'wasm-unsafe-eval'`，其他脚本、连接、Worker、图片和字体来源仍限制为同源及 Cesium 必需的 `blob:`/`data:`。
- 依据：Mars3D 3.11.5 的实际生产构建在启动时使用字符串求值；移除 `'unsafe-eval'` 会被浏览器 CSP 阻止并导致真实 Mars3D 无法初始化。
- 影响：这是当前固定 Mars3D 版本的最小兼容例外；Electron 仍启用 sandbox、上下文隔离、禁用 Node 集成并阻断外部导航。
- 回退：Mars3D 升级后先在真实 Electron 与断网 E2E 中移除该例外验证，只有全部通过才收紧策略。

## 2026-07-15 TASK-001：在线地图与高程仅用于开发调试

- 决策：按用户授权，开发模式允许通过本机 `.env.local` 注入天地图 Key 和在线高程 URL；生产构建检测到天地图或开发在线高程配置时直接失败，离线模式不设置公网回退。
- 依据：TASK-002 的正式本地数据包尚未交付，在线数据可用于先行调试 Mars3D 交互和地形效果，但不能改变最终离线部署边界。
- 影响：开发人员可设置 `VITE_MAP_PROVIDER=tianditu`、`VITE_TDT_KEY` 和可选 `VITE_DEV_TERRAIN_URL`；Key、URL 与在线资源均不提交。
- 回退：本地 XYZ、Quantized Mesh 与地理数据包完成后删除本地开发变量即可恢复纯离线调试。
