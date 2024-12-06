import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { TradeHistoriesService } from './trade-histories.service';
import {
  PnlSnapshotDetailsConnection,
  TradeHistory,
} from './entities/trade-history.entity';
import { PnlSnapshotKind } from '@prisma/client';
import { PnlSnapshotsService } from './pnlsnapshot.service';

@Resolver(() => TradeHistory)
export class TradeHistoriesResolver {
  constructor(
    private readonly tradeHistoriesService: TradeHistoriesService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
  ) {}

  @Query(() => [TradeHistory])
  getTradeHistories(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.tradeHistoriesService.getTradeHistories(address, contractId);
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
