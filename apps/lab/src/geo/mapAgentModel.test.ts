import { expect, it } from "vitest";
import { resolveAgentModel } from "./mapAgent";

it("routes routine and complex requests locally, and preserves context for short continuations", () => {
  expect(resolveAgentModel("auto", "Hide SAM masks")).toBe("muse-spark-1.3");
  expect(resolveAgentModel("auto", "Analyze the selected area")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("auto", "Capture crowns and then detect them")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("auto", "Continue", "muse-wonder-1.0")).toBe("muse-wonder-1.0");
  expect(resolveAgentModel("muse-spark-1.2", "Analyze and compare everything")).toBe("muse-spark-1.2");
});
