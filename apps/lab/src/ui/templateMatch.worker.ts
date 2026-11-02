import { matchCrowns, type MatchJob } from "../geo/templateMatch";

self.onmessage = (event: MessageEvent<MatchJob>) => {
  try {
    const result = matchCrowns(event.data, (progress) => self.postMessage({ type: "progress", progress }));
    self.postMessage({ type: "result", ...result });
  } catch (error) { self.postMessage({ type: "error", error: error instanceof Error ? error.message : "Template matching failed." }); }
};
