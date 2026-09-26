import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';

import { MAX_ENGINE_RESPONSE_BYTES } from '../protocol.js';

/** How to start one engine process on a prepared working copy. */
export interface EngineCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export type EngineCommandFactory = (options: {
  readonly dataDirectory: string;
  readonly port: number;
  readonly homeDirectory: string;
  readonly temporaryDirectory: string;
}) => EngineCommand;

/**
 * The pinned engine's serve command.
 *
 * Loopback only, bounded results, a short query timeout, and none of the optional surfaces: no
 * update endpoint, no cross-origin access, no metrics, no synonym file.
 */
export function engineServeCommand(options: {
  readonly javaExecutable: string;
  readonly engineArchive: string;
  readonly heap: string;
}): EngineCommandFactory {
  return ({ dataDirectory, homeDirectory, port, temporaryDirectory }) => ({
    args: [
      `-Xmx${options.heap}`,
      '-XX:+ExitOnOutOfMemoryError',
      // The serving user has no account entry, so the runtime is told where its home is.
      `-Duser.home=${homeDirectory}`,
      `-Djava.io.tmpdir=${temporaryDirectory}`,
      '-jar',
      options.engineArchive,
      'serve',
      '-data-dir',
      dataDirectory,
      '-listen-ip',
      '127.0.0.1',
      '-listen-port',
      String(port),
      '-max-results',
      '20',
      '-max-reverse-results',
      '5',
      '-query-timeout',
      '2',
    ],
    executable: options.javaExecutable,
  });
}

export interface EngineResponse {
  readonly status: number;
  readonly body: Buffer;
}

export type EngineCallResult =
  | { readonly kind: 'response'; readonly response: EngineResponse }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'too_large' };

const OUTPUT_LINES = 40;

/**
 * One running engine process on one working copy.
 *
 * It owns its own keep-alive connection pool, so stopping it destroys every connection it ever
 * opened: no socket from one load can carry a request into the next.
 */
export class EngineProcess {
  readonly #child: ChildProcess;
  readonly #port: number;
  readonly #agent = new Agent({ keepAlive: true, maxSockets: 64 });
  readonly #inFlight = new Set<AbortController>();
  readonly #output: string[] = [];
  #exited = false;
  #exitCode: number | null = null;
  readonly exited: Promise<number | null>;

  private constructor(child: ChildProcess, port: number) {
    this.#child = child;
    this.#port = port;
    const record = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length === 0) continue;
        this.#output.push(line.slice(0, 512));
        if (this.#output.length > OUTPUT_LINES) this.#output.shift();
      }
    };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => {
        this.#exited = true;
        this.#exitCode = code;
        resolve(code);
      });
      child.once('error', () => {
        this.#exited = true;
        resolve(null);
      });
    });
  }

  static start(options: {
    readonly command: EngineCommand;
    readonly port: number;
    readonly home: string;
    readonly temporaryDirectory: string;
    readonly path: string | undefined;
  }): EngineProcess {
    // A minimal, explicit environment: nothing from the host process leaks into the engine,
    // including runtime options that would change its networking.
    const child = spawn(options.command.executable, [...options.command.args], {
      cwd: options.home,
      env: {
        HOME: options.home,
        LANG: 'C.UTF-8',
        PATH: options.path ?? '/usr/local/bin:/usr/bin:/bin',
        TMPDIR: options.temporaryDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new EngineProcess(child, options.port);
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get hasExited(): boolean {
    return this.#exited;
  }

  /** The exit status once the process has exited; null when a signal ended it. */
  get exitCode(): number | null {
    return this.#exitCode;
  }

  /** The engine's last output lines, for the host's own log only. Never served. */
  get recentOutput(): readonly string[] {
    return [...this.#output];
  }

  /** Resident and peak resident memory of the engine process, where the platform reports it. */
  async memory(): Promise<{ readonly resident: number; readonly peak: number } | null> {
    const pid = this.#child.pid;
    if (pid === undefined || this.#exited || process.platform !== 'linux') return null;
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const field = (name: string) => {
        const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, 'm').exec(status);
        return match === null ? null : Number(match[1]) * 1024;
      };
      const resident = field('VmRSS');
      const peak = field('VmHWM');
      return resident === null || peak === null ? null : { peak, resident };
    } catch {
      return null;
    }
  }

  /** One GET against the engine on loopback, bounded in size and time, and abortable. */
  get(
    path: string,
    parameters: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<EngineCallResult> {
    const url = new URL(path, `http://127.0.0.1:${this.#port}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const controller = new AbortController();
    this.#inFlight.add(controller);
    return new Promise<EngineCallResult>((resolve) => {
      let settled = false;
      const finish = (result: EngineCallResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#inFlight.delete(controller);
        resolve(result);
      };
      const request = httpRequest(
        url,
        {
          agent: this.#agent,
          headers: { accept: 'application/json' },
          method: 'GET',
          signal: controller.signal,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_ENGINE_RESPONSE_BYTES) {
              request.destroy();
              finish({ kind: 'too_large' });
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            finish({
              kind: 'response',
              response: { body: Buffer.concat(chunks), status: response.statusCode ?? 0 },
            }),
          );
          response.on('error', () =>
            finish(controller.signal.aborted ? { kind: 'aborted' } : { kind: 'unreachable' }),
          );
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        finish({ kind: 'timeout' });
      }, timeoutMs);
      request.on('error', () =>
        finish(controller.signal.aborted ? { kind: 'aborted' } : { kind: 'unreachable' }),
      );
      request.end();
    });
  }

  /** Aborts every request in flight to this engine and destroys its connections. */
  abortAll(): void {
    for (const controller of this.#inFlight) controller.abort();
    this.#inFlight.clear();
    this.#agent.destroy();
  }

  /** Stops the process: a polite signal first, then a forced one. */
  async stop(graceMs = 10_000): Promise<void> {
    this.abortAll();
    if (this.#exited) return;
    this.#child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!this.#exited) this.#child.kill('SIGKILL');
    }, graceMs);
    await this.exited;
    clearTimeout(timer);
  }
}
