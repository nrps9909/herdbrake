# HerdBrake Taiwan

HerdBrake is an interactive hackathon demonstrator for a narrow but consequential failure mode in agentic finance: every treasury agent may pass its individual policy while the combined batch still creates unsafe liquidity concentration.

The product intervenes before signing or settlement:

`OBSERVE → MEASURE → HOLD → HUMAN AUTHORIZE → STAGED RELEASE → RECOMPUTE`

## Demo in 90 seconds

1. Open **Command Center** and show 30 individually compliant intents converging on one defensive action.
2. Point to `CRITICAL`, the projected liquidity buffer, and the deterministic reason code `HB-LIQ-003`.
3. Open **Breaker controls**, prioritize critical suppliers, and authorize five simulated intents.
4. Open **Intent Ledger** to show individual `PASS` beside aggregate `HOLD`.
5. Open **Evidence**, run the replay attack, and download the JSON evidence pack.
6. Open **Scenario Lab** to switch between stablecoin, FX, settlement, supplier, receivables, and shared-feed shocks.

## Run locally

```bash
npm install
npm test
npm run dev
```

Production validation:

```bash
npm run lint
npm run build
```

## Product boundary

- Synthetic data and simulated payments only.
- No custody, bank connection, token transfer, or autonomous signing.
- An LLM may generate agent intents, but risk scoring and breaker decisions remain deterministic.
- A production deployment would require organization-specific RBAC, dual control, audit retention, security review, payment-provider signing, and legal/compliance validation.

## Architecture

- `lib/herdbrake.ts`: deterministic scenario, intent, aggregate-risk, and safe-release engine.
- `app/page.tsx`: shared interactive surface for people and WebMCP-capable agents.
- `tests/risk-engine.test.ts`: breaker and safe-release invariants.

The prototype intentionally keeps all state client-side. This makes the judging flow fast and reproducible without implying that the demo is a regulated payment service.
