import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { GRAPHIFY_VERSION, PAPER_TEXT_LIMIT } from "./knowledgeExtract.ts";
export const INSTALL_GRAPHIFY = `uv tool install "graphifyy[pdf]==${GRAPHIFY_VERSION}"`;
export const validEntryId = (id: string) => /^[a-z0-9-]{8,64}$/.test(id);
export function entryDirectory(root: string, id: string) {
  if (!validEntryId(id)) throw Error("Invalid knowledge entry ID.");
  const directory = resolve(root, id);
  if (!directory.startsWith(resolve(root) + sep)) throw Error("Knowledge path escaped its directory.");
  return directory;
}
export interface ProcessResult { code: number; stdout: string; stderr: string }
export type ProcessRunner = (command: string, args: string[], cwd: string, signal: AbortSignal, maxBuffer?: number) => Promise<ProcessResult>;
export const graphifyEnvironment = (cwd: string) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "en_US.UTF-8", GRAPHIFY_BACKEND: "none", PYTHONUTF8: "1" });
export const runProcess: ProcessRunner = (command, args, cwd, signal, maxBuffer = 128000) => new Promise((resolveResult, reject) => {
  execFile(command, args, { cwd, env: graphifyEnvironment(cwd), signal, timeout: 60000, maxBuffer, encoding: "utf8" }, (error, stdout, stderr) => {
    if (error && (error.code === "ENOENT" || error.name === "AbortError" || error.killed || typeof error.code !== "number")) { reject(error); return; }
    resolveResult({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
  });
});
export async function graphifyPython(bin: string) {
  const paths = bin.includes(sep) ? [resolve(bin)] : (process.env.PATH ?? "").split(delimiter).map(p => join(p, bin));
  for (const candidate of paths) {
    try { await access(candidate); const python = join(dirname(await realpath(candidate)), "python"); await access(python); return python; } catch { /* Try the next installed executable. */ }
  }
  throw Error(`Graphify Python environment not found. Install with ${INSTALL_GRAPHIFY}.`);
}
export async function extractPdf(bin: string, file: string, cwd: string, signal: AbortSignal, runner: ProcessRunner) {
  const python = await graphifyPython(bin);
  const script = "import sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\npages=[]\nfor p in r.pages:\n t=p.extract_text() or ''\n if not t.strip(): raise ValueError('A page has no readable text. OCR is not supported; provide a text PDF.')\n pages.append(t)\n if sum(map(len,pages))>120000: raise ValueError('Paper text exceeds the 120000 character limit; the whole paper cannot be ingested.')\nprint('\\n\\f\\n'.join(pages))";
  const output = await runner(python, ["-c", script, file], cwd, signal, PAPER_TEXT_LIMIT * 4 + 4096);
  if (output.code) throw Object.assign(Error("PDF text extraction failed."), { processResult: output });
  return output.stdout;
}
