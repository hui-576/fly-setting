# 验收证据

按任务追加规格符合性审查、代码质量审查、命令结果、截图或人工检查证据。每条证据必须引用 `TASK-NNN` 和相关 `REQ-NNN`；交付后还必须记录验收提交 SHA、远端引用和同步检查结果。

## 基线 1.0.0

- 批准与封存：用户于 2026-07-15 批准四阶段基线和完整 Git 策略；`seal_baseline.py` 成功封存 17 个权威文件。
- 基础分支：`origin/main@7b645a4081eba0d2a7740ae7f4e59649e5de61f9`。
- 工作分支：`feature/los-planning-v1`。
- 基线提交：`0908b9080ca2c02cdbec7f9036fa6d776b1a1222`。
- 远端同步：`origin/feature/los-planning-v1` 返回相同 SHA。
- Git 权限：当前凭据具备 push、maintain、admin；仓库允许 squash merge。
- 原型核验：稳定快照零远程 URL；1440×900 与 1366×768 可离线打开；用户明确接受其作为视觉交互参考，生产地图强制使用真实 Mars3D。

## TASK-001 真实 Mars3D 离线应用启动与地图工作台

### REQ-001 / REQ-009 / REQ-016 / REQ-018 规格与质量审查

- 规格符合性：独立复审通过。Electron 单实例安全壳、FastAPI loopback 动态端口、一次性启动握手、真实 Mars3D、湖北定位回落、开发在线/生产离线边界和关键视口均满足 TASK-001；本地数据包、局域网接口和安装包分别保留给 TASK-002、TASK-010、TASK-011。
- 代码质量：独立复审通过，未发现剩余 TASK-001 阻断问题。安全边界包括 sandbox、上下文隔离、禁用 Node 集成、单文件 CommonJS preload、精确 renderer origin、HttpOnly SameSite 会话、生产 CSP 与 TASK-010 前禁止 LAN。
- 地图引擎：生产代码动态加载 `mars3d@3.11.5` 并创建真实 `mars3d.Map`；`mars3d-cesium@1.143.0` Workers、Assets、Widgets 与运行资源由构建复制到本地；未复用原型 `terrain-map.js`，未引入其他地图引擎。
- 数据状态：未安装 TASK-002 数据包时明确显示“本地底图待安装”，不把空数据冒充已安装地图；离线模式拒绝公网 XYZ 且无自动回退。用户授权的在线瓦片与高程仅允许 Vite 开发服务器显式配置，任意 Vite 生产构建检测到 Key 或在线高程变量都会失败。

### 自动化与运行证据

- `pnpm install --frozen-lockfile`：通过。
- `pnpm lint`：通过；Web/Desktop TypeScript 检查与 API Ruff 全部通过。
- `pnpm typecheck`：通过；Web/Desktop TypeScript 与 API strict mypy 全部通过。
- `pnpm test`：通过；Desktop 38 项、Web 18 项、API 15 项，共 71 项。仅有 FastAPI TestClient 的上游 httpx2 迁移弃用警告。
- `pnpm test --filter desktop-shell --filter map-workbench`：通过；根测试编排正确解析封存任务的工作区过滤参数。
- `pnpm test:e2e`：通过，Electron、1440×900、1366×768 共 3 项。浏览器运行无公网请求、无 4xx/5xx、无页面异常、无视口溢出；真实 Mars3D Canvas PNG 合成像素统计为非空且非纯色。
- `pnpm test:e2e --project electron --grep "应用启动|Mars3D|单实例"`：通过。真实 Electron 从动态 loopback URL 加载，sandbox preload 暴露最小 `desktopApi`，一次性握手成功，第二实例立即退出且首实例仍只有一个窗口，关闭后 API 健康端点不可达。
- `pnpm build`：通过；Web 生产包、单文件 `dist/preload.cjs`、API wheel 与 sdist 均成功生成。Mars3D 主块约 8.06 MB，保持动态加载，稳定生产 source map 已关闭。
- 生产在线配置负例：设置 `VITE_TDT_KEY` 后执行 Web 生产构建被明确拒绝，证明 Key 与开发在线高程不能进入可发布产物。
- CSP 运行验证：Mars3D 3.11.5 所需 `'unsafe-eval'` / `'wasm-unsafe-eval'` 为已记录最小例外；脚本、连接、Worker、图片和字体其余来源仍受同源策略约束。

### 视觉证据

- `docs/delivery/evidence/TASK-001/map-workbench-desktop-1440.png`：1440×900，布局无重叠或溢出，缺数据状态清晰。
- `docs/delivery/evidence/TASK-001/map-workbench-desktop-1366.png`：1366×768，布局无重叠或溢出。
- `docs/delivery/evidence/TASK-001/electron-map-workbench-1440.png`：真实 Electron 窗口、真实 Mars3D/Cesium Canvas 与本地底图待安装状态。

### 已知后续边界

- 正式本地 XYZ、Quantized Mesh、矢量道路与数据包损坏诊断由 TASK-002 交付。
- Windows 自包含安装包、完整第三方许可证归档和干净机离线验收由 TASK-011 交付。
- 当前未使用真实湖北项目数据，不声明后续 5 分钟计算或 1 秒覆盖加载性能已通过。
