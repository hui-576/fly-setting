# 现场复杂网络与视距通信智能规划工具

面向现场通信规划人员的 Windows 单用户离线工具。系统以真实 Mars3D 作为唯一地图引擎，结合 DTM/DSM 数据、道路和手绘区域，规划系留无人机升空位置、最低高度与 30km 连续覆盖范围。

## 当前状态

项目按 [`docs/delivery/contract.json`](docs/delivery/contract.json) 中封存的 `1.0.0` 基线交付。需求、技术方案、原型约束和任务契约位于 `docs/delivery/`。

## 工作区

- `apps/web`：Vue + TypeScript + Mars3D 地图工作台。
- `apps/desktop`：Electron 单实例桌面壳。
- `services/api`：FastAPI 本地服务与后续计算调度入口。
- `docs/delivery`：封存基线、任务、状态和验收证据。

## 开发命令

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

根命令已包含 Python 服务的 Ruff、mypy、pytest 和 wheel/sdist 构建。单独调试 API 时使用 `uv run --project services/api --extra test pytest`。

天地图 Key 只能通过本机环境配置注入，禁止写入代码或版本库。离线配置不得回退到任何公网地图服务。
