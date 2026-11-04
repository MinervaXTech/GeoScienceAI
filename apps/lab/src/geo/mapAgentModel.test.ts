import { expect, it } from "vitest";
import { resolveAgentModel, validateMapAgentCall } from "./mapAgent";

it("routes routine and complex requests locally, and preserves context for short continuations", () => {
  expect(resolveAgentModel("auto", "Hide SAM masks")).toBe("muse-spark-1.3");
  expect(resolveAgentModel("auto", "Analyze the selected area")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("auto", "Capture crowns and then detect them")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("auto", "Continue", "muse-wonder-1.0")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("muse-spark-1.2", "Analyze and compare everything")).toBe("muse-spark-1.2");
});

it("lets add_map carry a name, so Muse can save a map at the current view", () => {
  expect(validateMapAgentCall({ action: "add_map", parameters: {} }).parameters).toEqual({});
  expect(validateMapAgentCall({ action: "add_map", parameters: { name: "Block C" } }).parameters).toEqual({ name: "Block C" });
  expect(() => validateMapAgentCall({ action: "add_map", parameters: { name: "  " } })).toThrow(/Invalid name/);
  expect(() => validateMapAgentCall({ action: "add_map", parameters: { name: "x".repeat(81) } })).toThrow(/Invalid name/);
  expect(() => validateMapAgentCall({ action: "add_map", parameters: { place: "Kluang" } })).toThrow(/Invalid place/);
});
