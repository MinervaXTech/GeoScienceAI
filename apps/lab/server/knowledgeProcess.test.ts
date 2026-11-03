// @vitest-environment node
import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: fake }));
import { runProcess } from "./knowledgeGraphify";
it("uses execFile argument arrays and a secret-free environment with every backend disabled", async () => {
  fake.mockImplementation((_bin, _args, _options, callback) => { callback(null, "answer", ""); });
  const args = ["query", "$(do-not-execute)", "--graph", "/tmp/paper/graphify-out/graph.json"];
  expect(await runProcess("graphify", args, "/tmp/paper", new AbortController().signal)).toEqual({ code: 0, stdout: "answer", stderr: "" });
  const call = fake.mock.calls[0]!; expect(call[1]).toBe(args); expect(call[2].shell).toBeUndefined(); expect(call[2].env.GRAPHIFY_BACKEND).toBe("none"); expect(Object.keys(call[2].env).sort()).toEqual(["GRAPHIFY_BACKEND", "HOME", "LANG", "PATH", "PYTHONUTF8"]);
});
