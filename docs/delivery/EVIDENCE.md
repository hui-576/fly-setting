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
