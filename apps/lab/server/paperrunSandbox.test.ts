// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSandboxed, sandboxProfile } from "./paperrunSandbox";
const python = resolve(__dirname, "../paperruns/.venv/bin/python");
const available = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && existsSync(python);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const run = async (code: string, timeoutMs = 20000) => { const dir = await mkdtemp(join(tmpdir(), "paperrun-sbx-")); dirs.push(dir); await writeFile(join(dir, "t.py"), code); return { dir, result: await runSandboxed({ python, runDir: dir, script: "t.py", timeoutMs }) }; };

it("builds a profile that denies network and outside writes and allows only the run folder and interpreter", () => {
  const p = sandboxProfile({ runDir: "/runs/a", readable: ["/py"], home: "/Users/x" });
  expect(p).toContain("(deny network*)"); expect(p).toContain("(deny file-write*)"); expect(p).toContain('(allow file-write* (subpath "/runs/a")');
  expect(p).toContain('(deny file-read* (subpath "/Users/x"))'); expect(p).toContain('(allow file-read* (subpath "/runs/a") (subpath "/py"))');
  expect(sandboxProfile({ runDir: '/we"ird', readable: [], home: "/h" })).toContain('(subpath "/we\\"ird")');
});
describe.runIf(available)("sandboxed Python", () => {
  it("runs scripts and numpy, and returns output and exit codes", async () => {
    const ok = await run("import numpy as np\nprint(int(np.arange(5).sum()))\n"); expect(ok.result).toMatchObject({ code: 0, stdout: "10\n", timedOut: false });
    const bad = await run("import sys\nsys.stderr.write('boom')\nsys.exit(3)\n"); expect(bad.result).toMatchObject({ code: 3, stderr: "boom" });
  });
  it("blocks network access", async () => {
    const { result } = await run("import socket\ntry:\n    socket.create_connection(('93.184.216.34', 80), timeout=3)\n    print('CONNECTED')\nexcept Exception as e:\n    print('BLOCKED', type(e).__name__)\n");
    expect(result.stdout).toContain("BLOCKED"); expect(result.stdout).not.toContain("CONNECTED");
  });
  it("allows writes inside the run folder only", async () => {
    const outside = join(tmpdir(), `paperrun-outside-${Date.now()}.txt`);
    const { dir, result } = await run(`import os\nopen('inside.txt','w').write('ok')\ntry:\n    open(${JSON.stringify(outside)},'w').write('x')\n    print('WROTE OUTSIDE')\nexcept Exception as e:\n    print('DENIED', type(e).__name__)\n`);
    expect(result.stdout).toContain("DENIED"); expect(result.stdout).not.toContain("WROTE OUTSIDE"); expect(existsSync(outside)).toBe(false);
    expect(await readFile(join(dir, "inside.txt"), "utf8")).toBe("ok");
  });
  it("cannot read the real home folder (HOME inside the sandbox is the run folder)", async () => {
    const { result } = await run(`import os\nfor p in [${JSON.stringify(homedir())}, ${JSON.stringify(join(homedir(), 'Desktop'))}]:\n    try:\n        print('LISTED', len(os.listdir(p)))\n    except Exception as e:\n        print('DENIED', type(e).__name__)\n`);
    expect(result.stdout).not.toContain("LISTED"); expect(result.stdout).toContain("DENIED");
    const secret = await run(`try:\n    print('READ', len(open(${JSON.stringify(join(homedir(), ".zshrc"))}).read()))\nexcept Exception as e:\n    print('DENIED', type(e).__name__)\n`);
    expect(secret.result.stdout).toContain("DENIED");
  });
  it("kills a runaway script at the time limit and caps its output", async () => {
    const slow = await run("import time\nwhile True:\n    time.sleep(0.05)\n", 1200); expect(slow.result.timedOut).toBe(true); expect(slow.result.durationMs).toBeLessThan(8000);
    const dir = await mkdtemp(join(tmpdir(), "paperrun-sbx-")); dirs.push(dir); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "t.py"), "print('x' * 500000)\n");
    const loud = await runSandboxed({ python, runDir: dir, script: "t.py", timeoutMs: 20000, maxOutput: 1000 }); expect(loud.truncated).toBe(true); expect(loud.stdout.length).toBeLessThanOrEqual(1000);
  });
  it("gives the script a minimal environment", async () => {
    const { result } = await run("import os\nprint(sorted(k for k in os.environ if k.startswith(('MODEL','GOOGLE','AWS','ANTHROPIC'))), 'PATH' in os.environ)\n");
    expect(result.stdout.trim()).toBe("[] True");
  });
});
