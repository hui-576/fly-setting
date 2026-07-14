import { spawn, type SpawnOptions } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";

import type { ApiProcessCommand } from "./local-api-config.js";

const LOOPBACK_HOST = "127.0.0.1";
const DIAGNOSTIC_LIMIT = 16_384;

export interface ApiChildProcess {
  readonly pid?: number | undefined;
  readonly stderr: Readable | null;
  readonly stdout: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export interface LocalApiDependencies {
  readonly checkHealth: (url: string) => Promise<boolean>;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly environment: NodeJS.ProcessEnv;
  readonly reservePort: () => Promise<number>;
  readonly spawnProcess: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ApiChildProcess;
}

function appendDiagnostic(existing: string, chunk: unknown): string {
  const combined = existing + String(chunk);
  return combined.slice(-DIAGNOSTIC_LIMIT);
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const body = await response.json() as { status?: unknown };
    return body.status === "ok";
  } catch {
    return false;
  }
}

const defaultDependencies: LocalApiDependencies = {
  checkHealth,
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  environment: process.env,
  reservePort: reserveLoopbackPort,
  spawnProcess: (command, args, options) => spawn(command, args, options),
};

function terminateProcessTree(child: ApiChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    const terminator = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { shell: false, stdio: "ignore", windowsHide: true },
    );
    terminator.once("error", () => child.kill("SIGTERM"));
    terminator.once("exit", (code) => {
      if (code !== 0) child.kill("SIGTERM");
    });
    terminator.unref();
    return;
  }
  child.kill("SIGTERM");
}

export class LocalApiService {
  readonly #command: ApiProcessCommand;
  readonly #dependencies: LocalApiDependencies;
  readonly #serviceEnvironment: NodeJS.ProcessEnv;
  readonly #onUnexpectedExit: ((error: Error) => void) | undefined;
  #child: ApiChildProcess | null = null;
  #baseUrl: string | null = null;
  #startPromise: Promise<string> | null = null;
  #lifecycle = 0;

  constructor(
    command: ApiProcessCommand,
    dependencies: LocalApiDependencies = defaultDependencies,
    serviceEnvironment: NodeJS.ProcessEnv = {},
    onUnexpectedExit?: (error: Error) => void,
  ) {
    this.#command = command;
    this.#dependencies = dependencies;
    this.#serviceEnvironment = serviceEnvironment;
    this.#onUnexpectedExit = onUnexpectedExit;
  }

  start(): Promise<string> {
    if (this.#baseUrl) return Promise.resolve(this.#baseUrl);
    if (this.#startPromise) return this.#startPromise;
    const lifecycle = ++this.#lifecycle;
    this.#startPromise = this.#startOnce(lifecycle).catch((error: unknown) => {
      if (lifecycle === this.#lifecycle) this.#startPromise = null;
      throw error;
    });
    return this.#startPromise;
  }

  #startupError(reason: string, diagnostics: string): Error {
    const details = diagnostics ? `\n${diagnostics}` : "";
    return new Error(
      `Local API ${reason} (command=${this.#command.command}, cwd=${this.#command.cwd})${details}`,
    );
  }

  async #startOnce(lifecycle: number): Promise<string> {
    const port = await this.#dependencies.reservePort();
    if (lifecycle !== this.#lifecycle) throw this.#startupError("startup cancelled", "");
    const baseUrl = `http://${LOOPBACK_HOST}:${port}/`;
    let diagnostics = "";
    let exited: string | null = null;
    const child = this.#dependencies.spawnProcess(this.#command.command, this.#command.args, {
      cwd: this.#command.cwd,
      env: {
        ...this.#dependencies.environment,
        ...this.#serviceEnvironment,
        FLY_SETTING_API_HOST: LOOPBACK_HOST,
        FLY_SETTING_API_PORT: String(port),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    child.stdout?.on("data", (chunk) => {
      diagnostics = appendDiagnostic(diagnostics, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      diagnostics = appendDiagnostic(diagnostics, chunk);
    });
    child.once("error", (error) => {
      exited = `failed to start: ${error.message}`;
    });
    child.once("exit", (code, signal) => {
      exited = `exited (code=${String(code)}, signal=${String(signal)})`;
      if (this.#child === child) {
        const wasRunning = this.#baseUrl !== null;
        this.#child = null;
        this.#baseUrl = null;
        this.#startPromise = null;
        this.#lifecycle += 1;
        if (wasRunning) this.#onUnexpectedExit?.(this.#startupError(exited, diagnostics));
      }
    });

    const healthUrl = new URL("api/v1/health", baseUrl).toString();
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (exited) {
        this.#child = null;
        throw this.#startupError(exited, diagnostics);
      }
      const healthy = await this.#dependencies.checkHealth(healthUrl);
      if (healthy && !exited && this.#child === child) {
        this.#baseUrl = baseUrl;
        return baseUrl;
      }
      await this.#dependencies.delay(100);
      if (lifecycle !== this.#lifecycle) {
        if (exited) throw this.#startupError(exited, diagnostics);
        throw this.#startupError("startup cancelled", diagnostics);
      }
    }
    this.stop();
    throw this.#startupError("health check timed out", diagnostics);
  }

  stop(): void {
    const child = this.#child;
    this.#child = null;
    this.#baseUrl = null;
    this.#startPromise = null;
    this.#lifecycle += 1;
    if (child) terminateProcessTree(child);
  }
}
