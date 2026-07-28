# GMX V1 Historical Event Backfill

## Scope

The GMX V1 Vault integration is a bounded historical source. It scans the
legacy Vault contracts from the official GMX subgraph start blocks and stops at
the configured inclusive `toBlock` immediately before the selected
`2025-01-01T00:00:00.000Z` cutoff.

The GMX V2 EventEmitter integrations remain unchanged and continue to cover the
V2 era.

## Deployment matrix

| Network   | Chain ID | Vault                                        | `fromBlock` | Inclusive `toBlock` |
| --------- | -------: | -------------------------------------------- | ----------: | ------------------: |
| Arbitrum  |    42161 | `0x489ee077994b6658eafa855c308275ead8097c4a` |      227000 |           290687173 |
| Avalanche |    43114 | `0x9ab2de34a33fb459b538c43f251eb825645e8595` |     8351228 |            55159595 |

The cutoff timestamp is Unix `1735689600`. The stored `toBlock` values are the
blocks immediately preceding the timestamp-boundary blocks used for
`2025-01-01T00:00:00Z`, so this data source deliberately excludes the later GMX
V1 tail.

## Official GMX sources

- Current GMX interface deployment map:
  <https://github.com/gmx-io/gmx-interface/blob/master/sdk/src/configs/contracts.ts>
- GMX production chain IDs:
  <https://github.com/gmx-io/gmx-interface/blob/master/sdk/src/configs/chainIds.ts>
- Arbitrum V1 raw subgraph manifest (Vault address and start block):
  <https://github.com/gmx-io/gmx-subgraph/blob/master/gmx-arbitrum-raw/subgraph.yaml>
- Avalanche V1 raw subgraph manifest (Vault address and start block):
  <https://github.com/gmx-io/gmx-subgraph/blob/master/gmx-avalanche-raw/subgraph.yaml>
- Legacy Vault event definitions and emission order:
  <https://github.com/gmx-io/gmx-contracts/blob/master/contracts/core/Vault.sol>
- Official subgraph Vault ABI:
  <https://github.com/gmx-io/gmx-subgraph/blob/master/gmx-arbitrum-raw/abis/Vault.json>

The timestamp-to-block boundary is chain data rather than GMX contract
metadata. The cutoff snapshot was checked against a binary-search script that
targets Unix timestamp `1735689600`:

- <https://github.com/RSS3-Network/Node-NetworkParams-Script/blob/main/main.go>
- <https://github.com/RSS3-Network/Node-NetworkParams-Script/blob/main/config.json>

## Indexed ABI events

The runtime uses an event-only ABI because the service only reads logs. It
requests these Vault events in a single `viem` `getLogs` call:

- `IncreasePosition`
- `DecreasePosition`
- `LiquidatePosition`
- `UpdatePosition`
- `ClosePosition`
- `UpdatePnl`
- `CollectMarginFees`

GMX V1 spreads one trade across several logs. Before a primary event is passed
to the existing action and trade-history paths, the normalizer groups logs by
transaction and reconstructs one enriched trade event:

- `IncreasePosition` + preceding `CollectMarginFees` + following
  `UpdatePosition`
- `DecreasePosition` + preceding `CollectMarginFees` and `UpdatePnl` +
  following `UpdatePosition` or `ClosePosition`
- `LiquidatePosition` + preceding `CollectMarginFees`

This preserves full margin fees when the fee was deducted from remaining
collateral and reconstructs the post-operation size/collateral state needed to
classify opens, closes, size changes, and leverage changes.

## Seed behavior

`prisma/seed.ts` imports `gmxV1VaultDeployments`, so reseeding writes both V1
Vault rows with `Version.V1` and their fixed block ranges. The leaderboard
cursor starts at `fromBlock - 1`, so both fresh Continue and explicit rebuild
runs include the first configured block. The monitor cursor stays at
`fromBlock`, but the contracts remain `Dead` and are never part of the live
copy-trading polling loop.

## V1 pair resolution

GMX V1 pair identity must not be resolved through the GMX V2 market or token
configuration. V1 does not emit a V2 market-token address: each position event
contains its `indexToken`, and the V1 Vault validates that address directly as a
non-stable / shortable token.

`src/web3/platform/gmx/v1/configs/tokens.ts` therefore owns a closed,
chain-specific registry of the eight V1 index-token addresses used by the
Arbitrum and Avalanche Vaults in this historical scope. The registry keeps the
actual token symbol (for example `BTC.b` versus `WBTC.e`) separate from the
canonical underlying pair (`btc/usd`). Unknown addresses throw a descriptive
error instead of silently creating records with an empty pair.

The stored normalized event JSON already contains `indexToken` and
`collateralToken`, while the pair is derived when records are read. Correcting
this resolver therefore fixes existing raw GMX V1 event rows without a database
migration or a chain re-scan. Previously materialized simulation or position
caches should still be rebuilt so their cached pair labels are refreshed.
