// @vitest-environment node
import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Each dev-server plugin claims every URL that starts with its prefix. A prefix that begins with another plugin's prefix is taken by whichever plugin comes first.
it("gives every dev-server plugin a route prefix that no other plugin's prefix begins with", () => {
  const prefixes = readdirSync(__dirname).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).flatMap(f => [...readFileSync(join(__dirname, f), "utf8").matchAll(/req\.url\?\.startsWith\("(\/api\/[a-z/-]*)"\)/g)].map(m => m[1]!));
  expect(prefixes.length).toBeGreaterThanOrEqual(13); expect(new Set(prefixes).size).toBe(prefixes.length);
  // One overlap is deliberate: the pyramid plugin is listed before the general Muse plugin in vite.config.ts.
  const deliberate = new Set(["/api/muse/pyramid"]);
  for (const a of prefixes) for (const b of prefixes) if (a !== b && !deliberate.has(b)) expect(b.startsWith(a), `${b} begins with ${a}`).toBe(false);
  const config = readFileSync(join(__dirname, "../vite.config.ts"), "utf8"); expect(config.indexOf("musePyramidPlugin()")).toBeLessThan(config.indexOf("musePlugin("));
});
