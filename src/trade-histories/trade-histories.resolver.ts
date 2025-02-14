import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { TradeHistoriesService } from './trade-histories.service';
import {
  PnlSnapshotDetailsConnection,
  TradeHistory,
  TradeTransactionCount,
} from './entities/trade-history.entity';
import { PnlSnapshotKind } from '@prisma/client';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { PnlSnapshot } from './entities/trade-history.entity';
import { GetUserTransactionCountsInput } from './dto/trade-history.input';
@Resolver(() => TradeHistory)
export class TradeHistoriesResolver {
  constructor(
    private readonly tradeHistoriesService: TradeHistoriesService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
  ) {}

  @Mutation(() => Boolean)
  initalizePnlSnapshot() {
    return this.pnlSnapshotsService.initialBuild();
  }

  @Query(() => TradeTransactionCount)
  getTradeTransactionCounts(
    @Args('contractIds', { type: () => [Int] }) contractIds: number[],
    @Args('addresses', { type: () => [String] }) addresses: string[],
  ) {
    return this.tradeHistoriesService.getTradeTransactionCounts(
      contractIds,
      addresses,
    );
  }

  @Query(() => [TradeTransactionCount])
  getUserTransactionCounts(
    @Args('inputs', { type: () => [GetUserTransactionCountsInput] })
    inputs: GetUserTransactionCountsInput[],
  ) {
    return this.tradeHistoriesService.getUserTransactionCounts(inputs);
  }

  @Query(() => [TradeHistory])
  getTradeHistories(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.tradeHistoriesService.getTradeHistories([address], contractId);
  }

  @Query(() => [PnlSnapshot])
  getPnlSnapshotsByAddress(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshotsByAddress(
      contractId,
      address.toLowerCase(),
    );
  }

  @Query(() => PnlSnapshotDetailsConnection)
  getPnlSnapshots(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('kind', { type: () => PnlSnapshotKind }) kind: PnlSnapshotKind,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshots(
      contractId,
      kind,
      first,
      after,
    );
  }
}
