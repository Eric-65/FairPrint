# FairPrint

**Know what you're actually paying.**

FairPrint is a pre-trade execution-quality layer for tokenized equities on Solana. It keeps an executable token price separate from the underlying stock reference, measures the gap, measures how much the route can actually fill, and gates execution when either axis is unsafe.

**Live demo:** [https://temporary-fleet-gust-kpypgd3.vercel.app](https://temporary-fleet-gust-kpypgd3.vercel.app)

## The problem

Tokenized stocks are not interchangeable with shares. Retail users receive economic exposure without voting rights, dividends compound into the token rather than paying cash, and redemption for the underlying share is restricted to qualified investors. A normal user who enters at a bad secondary-market price may only be able to exit through the same fragmented market.

Observed dislocations have been material:

- TSLAr traded near **$299** while TSLA had closed at **$416**, a gap of roughly **37%**.
- TSLAx traded near **$295** while TSLA was near **$347**, a gap of roughly **29%**, before later rebounding toward **$382**.
- A Birdeye study measured a Solana xStocks deviation corridor of approximately **−5.02% to +3.45%** through May 2026.

Price is only one axis. A token can show a small premium and still have so little route depth that a modest order incurs severe price impact.

## Why Solana

The premium and off-hours drift exist because these assets trade on-chain around the clock while the US reference market closes. On Solana, FairPrint can request an executable route for a specific transaction size and measure its depth and price impact before the user signs—a level of per-transaction execution evidence a brokerage order book does not expose to the user.

## Who this is for

FairPrint is for non-US retail users, often trading outside US market hours, for whom a tokenized stock is the only path that executes—and who currently have no way to tell whether the price in front of them is fair.

## What FairPrint measures

- Jupiter Price v3 last-swap USD price for the verified Solana mint.
- Issuer or Pyth reference price, with source provenance and Pyth publish age.
- Signed premium or discount against the reference.
- Pyth confidence interval and whether the on-chain marker sits inside it.
- Maximum fillable USDC notional before Jupiter route impact exceeds a selected tolerance.
- Meteora DLMM TVL and 24-hour volume as supporting pool context.
- Estimated all-in execution cost at the entered order size.
- Fair, caution, overpay, halted, and unavailable execution decisions.
- A PostgreSQL archive of one observation per tracked ticker per minute, including degraded observations. Route depth is probed for a rotating subset of tickers each minute (`DEPTH_SYMBOLS_PER_RUN`, default 4) so Jupiter quote traffic stays inside the free-tier limit; the watchlist shows each ticker's most recent depth reading from the last 30 minutes.

## Screenshots

Twenty-symbol watchlist sorted by absolute premium:

![FairPrint twenty-symbol watchlist](public/screenshots/watchlist.png)

Depth-aware execution gate with relative reference freshness. This real INTCx measurement has a near-zero premium but a $5,000 order exceeds $2,831 of measured depth, forcing the gate to overpay:

![FairPrint depth-aware execution gate](public/screenshots/detail.png)

## Data sources

- [xStocks Public API](https://docs.xstocks.fi/apis/openapi): asset metadata, verified deployments, issuer reference quotes, market periods, halts, and Pyth feed identifiers.
- [Pyth Hermes](https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes): reference update price, exponent, confidence, and publish time.
- [Jupiter Price v3](https://dev.jup.ag/docs/price/v3): on-chain last-swap prices.
- [Jupiter Metis Quote API](https://dev.jup.ag/docs/swap/get-quote): route output, impact, and route fees.
- [Meteora DLMM Data API](https://docs.meteora.ag/api-reference/dlmm/pools/pools): pool TVL and 24-hour volume.

FairPrint never labels an on-chain swap price as an official stock print and never replaces a missing feed with a guessed value.

## Quick start

Requirements: Node.js 22+, PostgreSQL, and npm.

1. Clone the repository and run `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a random `CRON_SECRET`.
3. Start the app with `npm run dev`. Tables are created automatically on the first archive access; `npx drizzle-kit push` is optional.
4. Optionally set `PYTH_API_KEY` (Pyth Hermes requires a bearer token since August 2026) and `JUPITER_API_KEY` (a free key from portal.jup.ag doubles the quote budget from 30 to 60 requests per minute and moves off the deprecated keyless host).
5. Open `http://localhost:3000`. To record a poll, call `/api/cron/observe` with `Authorization: Bearer <CRON_SECRET>`.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/observe
```

## Vercel deployment

1. Import the public GitHub repository into Vercel.
2. Provision PostgreSQL and set `DATABASE_URL`.
3. Set a random `CRON_SECRET`.
4. Optionally set `PYTH_API_KEY`.
5. Deploy. The schema is bootstrapped automatically on first use. `vercel.json` schedules only the daily rollup at 00:15 UTC.

Vercel Hobby cron jobs run at most once per day, so they cannot collect one-minute observations. The free path is an external scheduler that calls the protected route every minute:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-project.vercel.app/api/cron/observe
```

Configure the external scheduler to send the same bearer token stored as `CRON_SECRET` in Vercel. Vercel Pro is the alternative: Pro supports per-minute cron scheduling, so `/api/cron/observe` can be added to the project cron configuration there. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` for its own cron invocations.

## Open-source components and assets

FairPrint declares the following open-source runtime and build components:

- Next.js and React
- Tailwind CSS and `@tailwindcss/postcss`
- TanStack Query
- Motion
- Number Flow for React
- Drizzle ORM and Drizzle Kit
- node-postgres (`pg`)
- Archivo Variable from Fontsource, licensed under the SIL Open Font License
- TypeScript, ESLint, PostCSS, and their type packages

The São Paulo night photograph is by Rafael Rodrigues via Pexels and is credited in the application footer.

## Archive sizing

At 20 symbols and one poll per minute, 90 days of raw data is approximately **2,592,000 observations**. Degraded rows are retained because an unpriceable venue is itself an execution-quality finding.

## Compliance and data licensing open item

Before charging for commercial access, the operator must review the current terms of Pyth, Jupiter, Meteora, and the xStocks issuer. Redistribution of raw market data may be restricted even where redistribution of derived analytics is treated differently. FairPrint does not assume those rights in code.

## Disclaimer

FairPrint reports measured execution cost. It is not investment advice, a price feed of record, or a quotation. xStocks are intended for eligible non-US users and are not available to US persons.

## License

FairPrint is released under the [MIT License](LICENSE).
