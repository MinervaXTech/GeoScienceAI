import { createPlanningClusters, type ClusterSettings } from "../geo/planningClusters";
import type { RoadReference } from "../geo/roadReference";
import type { PlanningPoints } from "../geo/planningPoints";
self.onmessage = (event: MessageEvent<{ set: PlanningPoints; settings: ClusterSettings; heights?: Record<string, number>; road?: RoadReference }>) => {
  try { self.postMessage({ result: createPlanningClusters(event.data.set, event.data.settings, event.data.heights, event.data.road) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Clustering failed." }); }
};
