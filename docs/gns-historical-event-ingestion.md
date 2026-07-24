# GNS historical event ingestion (2023 to present)

This change extends the existing Gains Network (`GNS`) event-log pipeline backward from the October 2024 parser boundary to the first 2023 Polygon and Arbitrum callback stacks.

The runtime uses **event-only ABIs** rather than the full administrative contract ABIs. This keeps `eth_getLogs` decoding small while preserving the exact official event tuple layouts and topic hashes.

## Contract ranges

`toBlock` is inclusive. `0` means open-ended in the existing seed convention.

### Polygon PoS (`chainId = 137`)

| Runtime version | Collateral / emitter | Contract address | fromBlock | toBlock | Runtime ABI |
| --- | --- | --- | ---: | ---: | --- |
| `V6_V7` | Legacy DAI callbacks | `0xb454d8a8c98035c65bb73fe2a11567b9b044e0fa` | 36,865,608 | 40,827,038 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | DAI callbacks | `0x82e59334da8c667797009bbe82473b55c7a6b311` | 40,827,039 | 58,241,479 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | WETH callbacks | `0x0bbed2eac3237ba128643670b7cf3be475933755` | 52,650,382 | 58,241,479 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | USDC callbacks | `0x2ac6749d0affd42c8d61ef25e433f92e375a1aef` | 52,650,382 | 58,241,479 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V8_V9_2` | Merged diamond | `0x209a9a01980377916851af2ca075c2b170452018` | 58,241,480 | 62,908,498 | `v8-v9.2/abi/GNSMultiCollatDiamond.ts` |
| `V9` | Existing parser range | `0x209a9a01980377916851af2ca075c2b170452018` | 62,908,499 | 74,793,869 | Existing V9 ABI/parser |
| `V10` | Existing parser range | `0x209a9a01980377916851af2ca075c2b170452018` | 74,793,870 | 0 | Existing V10 ABI/parser |

### Arbitrum One (`chainId = 42161`)

| Runtime version | Collateral / emitter | Contract address | fromBlock | toBlock | Runtime ABI |
| --- | --- | --- | ---: | ---: | --- |
| `V6_V7` | Legacy DAI callbacks | `0x6c612c804c84e3d20e3109c8efd06cd2d8b28f46` | 49,275,558 | 74,190,310 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | DAI callbacks | `0x298a695906e16aea0a184a2815a76ead1a0b7522` | 74,190,311 | 190,420,045 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | WETH callbacks | `0x62a9f50c92a57c719ff741133caa55c7a81ce019` | 173,285,454 | 190,420,045 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V6_V7` | USDC callbacks | `0x4542256c583bcad66a19a525b57203773a6485bf` | 173,285,454 | 190,420,045 | `v6-v7/abi/GNSTradingCallbacks.ts` |
| `V8_V9_2` | Merged diamond | `0xff162c694eaa571f685030649814282ea457f169` | 190,420,046 | 262,719,376 | `v8-v9.2/abi/GNSMultiCollatDiamond.ts` |
| `V9` | Existing parser range | `0xff162c694eaa571f685030649814282ea457f169` | 262,719,377 | 364,917,632 | Existing V9 ABI/parser |
| `V10` | Existing parser range | `0xff162c694eaa571f685030649814282ea457f169` | 364,917,633 | 0 | Existing V10 ABI/parser |

The DAI, WETH, and USDC callback ranges overlap intentionally: they were parallel collateral-specific emitters. The replacement boundary is the first merged-diamond block, not the start of the additional collateral contracts.

## ABI/event families

### Legacy callback stack (`V6_V7`)

| Event | Topic 0 | Notes |
| --- | --- | --- |
| `MarketExecuted` | `0x2739a12dffae5d66bd9e126a286078ed771840f2288f0afa5709ce38c3330997` | V6 callback tuple |
| `MarketExecuted` | `0xca42b0e44cd853d207b87e8f8914eaefef9c9463a8c77ca33754aa62f6904f00` | V7 adds `collateralPriceUsd` |
| `LimitExecuted` | `0x165b0f8d6347f7ebe92729625b03ace41aeea8fd7ebf640f89f2593ab0db63d1` | Earliest callback tuple |
| `LimitExecuted` | `0x1ab0771256522e5114b583b488c490436d6f8fe02b1e1c9697443e8704c4e840` | Adds `exactExecution` |
| `LimitExecuted` | `0xa97091b8c54bf9d1906c2a06322d0ea74fedde4538cdcdf95d81d0ffdca41857` | V7 adds collateral price and exact execution |

The parser derives collateral from the emitting callback address. Legacy trade indices were pair-scoped, so the opaque position key now contains `pairIndex` to prevent a trader's index `0` on two pairs from being merged.

### Early merged diamond (`V8_V9_2`)

| Event | Topic 0 | Conversion support |
| --- | --- | --- |
| `MarketExecuted` | `0xbbd5cfa7b4ec0d44d4155fcaad32af9cf7e65799d6b8b08f233b930de7bcd9a8` | Full `PurePerpTradeHistory` conversion |
| `LimitExecuted` | `0xc10f67c0e22c53149183a414c16a62334103432a2c48b839a057cd9bd5fdeb99` | Full conversion; all V8 pending-order types classified |
| `PositionSizeDecreaseExecuted` | `0x55eb5f89c70aca28886aa8ef325c490fcde181e2644a29be3ee8e99f0ada207c` | ABI decode only; see limitation below |
| `PositionSizeIncreaseExecuted` | `0x63436e10a2625186e471ce7bf020ce763b4f6f3caa2d7e33e73981aa1bf4c6b6` | ABI decode only; see limitation below |
| `PositionSizeDecreaseExecuted` | `0xe74b50af866d7f8e3577bc959bf73a2690841f0abce22ab0cfb1b1c84122a7d7` | Full V9.2 conversion |
| `PositionSizeIncreaseExecuted` | `0xf09a9c949c4bd4cbe75b424bea11c683c3ae55e7cdb8321c3ec37e01af72c8d5` | Full V9.2 conversion |

The V8 SDK represents leverage with three decimals; `10_000` is therefore converted to `10x`.

## Source provenance

The address and ABI snapshots come from the official Gains Network repositories:

- `GainsNetwork-org/sdk`, `src/contracts/addresses.json`
  - `d45295f07acadf31b0290d044d0e641d457a0456` for V6.3.2 callback addresses.
  - `4aeed7f55c5f0fe17b4414e5bed125edccb4019d` for the multicollateral callback/diamond address set.
- `GainsNetwork-org/sdk`, `abi/`
  - `bdc1a85a6a55f316811d360e8a1e0a17b0887ea4` for `GNSTradingCallbacksV6_3_2.json`.
  - `4aeed7f55c5f0fe17b4414e5bed125edccb4019d` for `GNSTradingCallbacks.json` and the first merged-diamond ABI.
  - `2def614de4468c0019d5dc07b99d30305cc6a2b5` for the final V9.2 SDK ABI.
- `GainsNetwork-org/gtrade-stats-subgraph`
  - `e3365695c59663cf74ca2b1784812fd01738b027` records the Polygon and Arbitrum multicollateral callback start blocks.
  - `8be94ab4ea4d58cb2439d6f7018ed586a6345207` and the later official configs record the first V8 diamond ranges.
  - `7cea18ccdf807463a6e903a2cf175eff11c42365` records the current V10 restart blocks used by the existing seed.

The official SDK preserves the deprecated addresses and ABIs but does not publish deployment receipts for the first replaced DAI callback proxies. Their safe ingestion starts (`36,865,608`, `49,275,558`, `40,827,039`, and `74,190,311`) are taken from the historical Gains deployment configs in `messari/subgraphs` and corroborated by explorer logs carrying the official V6 event topic. This distinction is intentional: ABI/address authority is Gains; the earliest scanner block is chain-index evidence.

## Known historical limitation

The first V9 partial-size overloads (`0x55eb...` and `0x6343...`) omit both trade direction and collateral USD price. The ABI includes them so the log shape and topic are known, but the current `eventToPerpTradeHistory` API is stateless and cannot reconstruct those fields safely. Those overloads return `null` rather than writing incorrect history. The self-contained V9.2 overloads are fully converted.

The same principle applies to pre-current leverage-update events that omit the information required by `PurePerpTradeHistory`: this change does not fabricate values. A future stateful backfill can resolve them by replaying the preceding open trade and collateral-price context.

## Database and runtime wiring

- Prisma enum values added: `V6_V7`, `V8_V9_2`.
- Migration: `prisma/migrations/20260721190000_add_gns_historical_versions/migration.sql`.
- `prisma/seed.ts` includes all historical rows above.
- `src/web3/utils.ts` routes each version to its ABI, event topics, action parser, and history parser.
- Every history conversion call now passes `contract.address`, which is required to identify the collateral for callback-era logs.

## Validation

```bash
npm ci

DATABASE_URL='postgresql://user:pass@localhost:5432/lucky' npx prisma generate

npm run build
```

The historical test suite verifies all topic hashes from the ABI declarations, legacy pair-scoped position keys, callback-address collateral routing, close PnL, V8 leverage scaling, V8 order-type classification, V9.2 partial increase/decrease conversion, and rejection of non-self-contained V9 partial overloads.

