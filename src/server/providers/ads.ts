/**
 * Optional advertising. Watching an ad never gives the player anything: no Wood, Stone, lives,
 * cooldown, yield, allocation or voting power. Skipping never penalises.
 *
 * Only the simulated provider exists today. Before any real network is enabled: verify its current
 * publisher policies (including whether charity-support messaging is allowed and whether its
 * rewarded format demands an in-game reward), consent/privacy requirements, invalid-traffic
 * protections and frequency limits. Revenue enters the Community Heart Pool only through finalized,
 * received provider statements (services/pool.ts), never from per-impression estimates.
 */
export type AdSlot = { adId: string; simulated: boolean; durationMs: number; creative: { title: string; body: string } };

export interface AdProvider {
  readonly name: string;
  readonly simulated: boolean;
  request(placement: string): Promise<AdSlot | null>;
}

export class SimulatedAdProvider implements AdProvider {
  readonly name = "simulated";
  readonly simulated = true;
  async request(placement: string): Promise<AdSlot> {
    return {
      adId: `sim-${placement}-${Date.now().toString(36)}`,
      simulated: true,
      durationMs: 5000,
      creative: { title: "Simulated ad", body: "This is a placeholder. No advertiser, no impression and no revenue are involved." },
    };
  }
}

/** Real networks are intentionally not wired: production ads stay disabled until approved. */
export function adProvider(_productionEnabled: boolean): AdProvider {
  return new SimulatedAdProvider();
}
