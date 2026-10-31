/**
 * Live model calls are prepared but disabled in this phase. Nothing reads
 * `enabled` to make a call; the header only shows the readout.
 */
export interface LiveConfig {
  enabled: boolean;
  callLimit: number;
  callsUsed: number;
  estimatedUsd: number;
}

export const LIVE_CONFIG: Readonly<LiveConfig> = Object.freeze({
  enabled: false,
  callLimit: 10,
  callsUsed: 0,
  estimatedUsd: 0,
});

export function costReadout(c: LiveConfig = LIVE_CONFIG): string {
  if (!c.enabled) return "Live calls off";
  return `Local mode: ${c.callsUsed} of ${c.callLimit} calls used, est. USD ${c.estimatedUsd.toFixed(2)}`;
}
