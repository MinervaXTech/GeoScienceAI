import { computePlanningRoutes, type PlanningPoints } from "../geo/planningPoints";
self.onmessage = (event: MessageEvent<PlanningPoints>) => {
  try { self.postMessage({ routes: computePlanningRoutes(event.data) }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "Route calculation failed." }); }
};
