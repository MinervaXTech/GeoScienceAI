import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface SandboxResult { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean; durationMs: number }
export interface SandboxOptions {
  python: string;
  runDir: string;
  /** Script path relative to `cwd` (inside the run folder). */
  script: string;
  args?: string[];
  /** Working directory inside the run folder; defaults to the run folder. */
  cwd?: string;
  timeoutMs: number;
  maxOutput?: number;
  signal?: AbortSignal;
  sandboxExec?: string;
}
const quote = (path: string) => `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * macOS sandbox profile for model-written code: no network, writes only inside the run folder, and no reads of the user's
 * home folder except the run folder and the Python installation. Everything else the interpreter needs stays readable.
 */
export function sandboxProfile(input: { runDir: string; readable: string[]; home: string }): string {
  return [
    "(version 1)", "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quote(input.runDir)}) (literal "/dev/null") (literal "/dev/dtracehelper"))`,
    `(deny file-read* (subpath ${quote(input.home)}))`,
    `(allow file-read* ${[input.runDir, ...input.readable].map(p => `(subpath ${quote(p)})`).join(" ")})`,
  ].join("\n");
}

/** Where the interpreter lives, so the sandbox can allow reading it even when it sits under the home folder. */
export async function interpreterRoots(python: string): Promise<string[]> {
  const roots = new Set<string>();
  const resolved = await realpath(python).catch(() => resolve(python));
  roots.add(dirname(dirname(resolved)));
  roots.add(dirname(dirname(resolve(python))));
  return [...roots];
}

/** Runs one Python script inside the sandbox with a hard time limit, an output cap and a minimal environment. */
export async function runSandboxed(options: SandboxOptions): Promise<SandboxResult> {
  const runDir = await realpath(options.runDir), cwd = options.cwd ? join(runDir, options.cwd) : runDir;
  if (!cwd.startsWith(runDir)) throw Error("The working directory must be inside the run folder.");
  await mkdir(join(runDir, ".tmp"), { recursive: true }); await mkdir(join(runDir, ".mpl"), { recursive: true });
  const profile = sandboxProfile({ runDir, readable: await interpreterRoots(options.python), home: await realpath(homedir()).catch(() => homedir()) });
  const env = { PATH: "/usr/bin:/bin", HOME: runDir, TMPDIR: join(runDir, ".tmp"), MPLCONFIGDIR: join(runDir, ".mpl"), MPLBACKEND: "Agg", PYTHONDONTWRITEBYTECODE: "1", PYTHONHASHSEED: "0", PYTHONUNBUFFERED: "1", LANG: "en_US.UTF-8" };
  const max = options.maxOutput ?? 200000, started = Date.now();
  return new Promise(resolveResult => {
    let stdout = "", stderr = "", truncated = false, timedOut = false, done = false;
    const child = spawn(options.sandboxExec ?? "/usr/bin/sandbox-exec", ["-p", profile, resolve(options.python), "-B", "-s", options.script, ...(options.args ?? [])], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
    const abort = () => stop(); options.signal?.addEventListener("abort", abort, { once: true });
    const take = (current: string, chunk: Buffer) => { const next = current + chunk.toString("utf8"); if (next.length > max) { truncated = true; return next.slice(0, max); } return next; };
    child.stdout.on("data", chunk => { stdout = take(stdout, chunk); }); child.stderr.on("data", chunk => { stderr = take(stderr, chunk); });
    const finish = (code: number | null, signal: string | null, extra = "") => { if (done) return; done = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); stop(); resolveResult({ code, signal, stdout, stderr: stderr + extra, timedOut, truncated, durationMs: Date.now() - started }); };
    child.on("error", error => finish(null, null, `\n[sandbox] ${error.message}`));
    child.on("close", (code, signal) => finish(code, signal));
  });
}
