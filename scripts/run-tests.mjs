import { spawnSync } from "node:child_process";

const packageAliases = new Map([
  ["desktop-shell", "@fly-setting/desktop-shell"],
  ["map-workbench", "@fly-setting/map-workbench"],
]);
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("无法定位当前 pnpm CLI");

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readFilters(args) {
  const filters = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--filter") {
      throw new Error(`不支持的测试参数：${args[index]}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error("--filter 必须提供工作区名称");
    filters.push(packageAliases.get(value) ?? value);
    index += 1;
  }
  return filters;
}

const filters = readFilters(process.argv.slice(2));
const workspaceArguments = filters.flatMap((filter) => ["--filter", filter]);
run(process.execPath, [pnpmCli, ...workspaceArguments, "-r", "--if-present", "run", "test"]);

if (filters.length === 0) {
  run("uv", ["run", "--project", "services/api", "--extra", "test", "pytest"]);
}
