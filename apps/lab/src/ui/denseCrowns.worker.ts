import { denseCrownCoverage, type DenseCrownJob } from "../geo/denseCrowns";
self.onmessage = (event: MessageEvent<DenseCrownJob>) => {
  try { const output = denseCrownCoverage(event.data); self.postMessage({ output }, { transfer: [output.mask.buffer] }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "Dense crown coverage failed." }); }
};
