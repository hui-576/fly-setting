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

### 交付提交与远端同步

- TASK-001 验收提交：`c296267e895bf9e7fd1b32ddbcb9bc25a7ca1bbe`。
- 远端引用：`origin/feature/los-planning-v1`。
- 同步复核：`git ls-remote` 返回 `c296267e895bf9e7fd1b32ddbcb9bc25a7ca1bbe`，与本地 `HEAD` 一致；`check_repository.py` 通过。

## TASK-002 地理数据包安装、校验与双遮挡模式

### REQ-009 / REQ-010 / REQ-016 规格、安全与质量审查

- 规格符合性：独立复审通过。版本化数据包可安装、切换和激活；后台分别解析 DTM/DSM；真实 Mars3D 使用同源版本化 XYZ、Quantized Mesh 和 MVT 道路资源；开发在线瓦片/高程许可未改变生产离线和零公网回退边界。
- 安全复审：独立攻击复审通过。导入使用单遍 no-follow 受限复制，核对 `lstat/fstat`、文件身份、大小和修改时间，拒绝 symlink/junction/reparse、路径重叠及容量越界，超限探测字节不写入 staging。
- 内容真实性：严格校验 SHA-256 清单、栅格 CRS/范围/像元/NoData/垂直单位/有效像元与 DTM/DSM 对齐；XYZ/MVT/TMS 地形金字塔覆盖、`layer.json.available`、Quantized Mesh 顶点增量/高水位索引/三角形/边索引/包围球和 MVT 与权威道路来源一致性均有负例。
- 许可真实性：官方许可仅接受审阅的 SPDX 3.26 标识；自定义许可只接受 `LicenseRef-*`，且审批必须由包外 HMAC-SHA256 信任库验证，并绑定包 ID、版本、许可 ID、许可文本摘要、规范化清单摘要与来源；无默认测试密钥，禁止包或托管存储自带信任库。
- 容量与性能：PNG 32 MiB、Quantized Mesh 32 MiB、MVT 16 MiB、`layer.json` 1 MiB、道路 GeoJSON 64 MiB；栅格轴/总像元/block 有界并在首个有效 block 后停止。MVT 完整解码前执行 protobuf 预算预检，前端每瓦片最多 5,000 要素/50,000 坐标，请求并发 4，缓存同时受 96 瓦片、64 MiB 和 25 万坐标约束。
- 代码质量：独立复审通过。所有函数不超过 60 行；数据包存储、资源访问、许可、MVT 预算、来源匹配和地图适配器已按职责拆分。长时间安装不使用 15 秒短超时，避免服务端继续导入而前端误报失败。

### 自动化与运行证据

- `pnpm lint`：通过；Web/Desktop TypeScript 与 API Ruff 全部通过。
- `pnpm typecheck`：通过；Web/Desktop TypeScript 与 API strict mypy 23 个源文件全部通过。
- `pnpm test --filter data-package`：通过；Web 55 项、API 90 项。
- `pnpm test`：通过；Desktop 38 项、Web 55 项、API 105 项，共 198 项。
- `pnpm build`：通过；Web、Desktop preload、API wheel 与 sdist 均成功生成。
- `pnpm test:e2e`：通过；Electron、1440×900、1366×768 共 5 项，单实例后端使用 `workers: 1` 消除跨视口活动版本竞态。
- 完整 E2E 实际经 UI 安装 `2026.08.0` / `2026.09.0`、选择 DSM、切换活动版本、重载 Mars3D、切换道路图层，并请求版本化 XYZ、Terrain、MVT；5/5 无 404、无公网请求。
- Chromium 原生 `fetch` receiver 回归已覆盖；默认道路加载真实路径与完整 E2E 均通过。
- `git diff --check`：通过；封存 requirements、plan、DESIGN、tasks、contract 与原型目录无差异。

### 视觉证据

- `docs/delivery/evidence/TASK-002/data-package-settings-desktop-1440.png`：1440×900 数据包安装、版本与 DTM/DSM 设置。
- `docs/delivery/evidence/TASK-002/data-package-settings-desktop-1366.png`：1366×768 设置弹窗与状态覆盖。
- `docs/delivery/evidence/TASK-002/data-package-desktop-1440.png`：真实 Mars3D 本地数据包摘要和图层状态。
- `docs/delivery/evidence/TASK-002/data-package-desktop-1366.png`：紧凑视口地图工作台。

### 已知后续边界

- 当前证据使用明确标注为非业务数据的合成包，不冒充真实湖北生产数据；最终真实数据许可、精度和硬件性能在 TASK-011 根验收。
- HMAC 信任库依赖部署时使用 Windows ACL 限制受信任管理员读写；密钥轮换或撤销需要重启服务。
- NumPy 与 Starlette 共 60 条上游弃用警告不影响当前结果，需在依赖升级前处理。

### 交付提交与远端同步

- TASK-002 验收提交、远端引用和同步结果将在任务提交推送后追加。
