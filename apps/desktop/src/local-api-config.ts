import { join } from "node:path";

export interface ApiProcessCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface ApiProcessCommandInput {
  readonly apiProjectPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
}

function parseCommandOverride(value: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FLY_SETTING_API_COMMAND must be a JSON array of command arguments");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.some((part) => typeof part !== "string" || part.length === 0)
  ) {
    throw new Error("FLY_SETTING_API_COMMAND must be a non-empty JSON array of strings");
  }
  return parsed as string[];
}

export function resolveApiProcessCommand(input: ApiProcessCommandInput): ApiProcessCommand {
  const configured = input.environment.FLY_SETTING_API_COMMAND;
  if (configured) {
    const [command, ...args] = parseCommandOverride(configured);
    if (!command) throw new Error("FLY_SETTING_API_COMMAND must include an executable");
    return {
      args,
      command,
      cwd: input.environment.FLY_SETTING_API_WORKING_DIRECTORY ?? input.apiProjectPath,
    };
  }

  if (!input.isPackaged) {
    return {
      args: ["run", "--project", input.apiProjectPath, "fly-setting-api"],
      command: "uv",
      cwd: input.apiProjectPath,
    };
  }

  const apiDirectory = join(input.resourcesPath, "api");
  return {
    args: [],
    command: join(
      apiDirectory,
      input.platform === "win32" ? "fly-setting-api.exe" : "fly-setting-api",
    ),
    cwd: apiDirectory,
  };
}
