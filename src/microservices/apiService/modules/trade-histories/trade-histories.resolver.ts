import { Inject, UseGuards } from '@nestjs/common';
import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { PnlSnapshotKind, UserPermission } from '@prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';

import {
  PnlSnapshotDetailsConnection,
  PnlSnapshotDevDetails,
  PnlSnapshotInitializedFlag,
  StatisticData,
  TestingReportConnection,
  TradeHistory,
  TradeTransactionCount,
  WholeCompressedHistories,
} from './entities/trade-history.entity';
import { PnlSnapshot } from './entities/trade-history.entity';
import {
  ExportFilter,
  GetUserTransactionCountsInput,
} from './dto/trade-history.input';

import { TradeHistoriesService } from './trade-histories.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

@Resolver(() => TradeHistory)
export class TradeHistoriesResolver {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly tradeHistoriesService: TradeHistoriesService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
    private readonly backtestService: BacktestService,
  ) {}

  @Mutation(() => PnlSnapshotInitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async buildPnlSnapshots(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return await new Promise<PnlSnapshotInitializedFlag>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Leaderboard.BuildPnlSnapshot, {
          dateStr,
          isForceBuild,
        })
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  @Mutation(() => PnlSnapshotInitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async dynamicSnapshotBuild(
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return await new Promise<PnlSnapshotInitializedFlag>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Leaderboard.DynamicSnapshotBuild, { dateStr })
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async initializePnlSnapshot(
    @Args('beginingDate', { type: () => Date }) beginingDate: Date,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return await new Promise<PnlSnapshotInitializedFlag>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Leaderboard.InitializePnlSnapshot, {
          beginingDate,
          isForceBuild,
        })
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  @Query(() => PnlSnapshotInitializedFlag, { nullable: true })
  isPnlSnapshotInitialized(
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return this.pnlSnapshotsService.isPnlSnapshotInitialized(dateStr);
  }

  @Query(() => [PnlSnapshotInitializedFlag])
  getPnlSnapshotInitializedFlag() {
    return this.pnlSnapshotsService.getAllPnlSnapshotInitializedFlag();
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
    @Args('contractId', { type: () => Int })
    contractId: number,
  ) {
    return this.tradeHistoriesService.getTradeHistories([address], contractId);
  }

  @Query(() => [PnlSnapshot])
  getPnlSnapshotsByAddress(
    @Args('address') address: string,
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshotsByAddress(
      dateStr,
      address.toLowerCase(),
    );
  }

  @Query(() => PnlSnapshotDetailsConnection)
  getPnlSnapshots(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('kind', { type: () => PnlSnapshotKind }) kind: PnlSnapshotKind,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshots(
      dateStr,
      kind,
      first,
      after,
    );
  }

  @Query(() => [PnlSnapshotDevDetails])
  getDevPnlSnapshots(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('filterParams', { type: () => [ExportFilter] })
    filterParams: ExportFilter[],
  ) {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.getDevPnlSnapshots(dateStr, filterParams);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistories(
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('isTestnet', { type: () => Boolean }) isTestnet: boolean,
    @Args('filterParams', { type: () => [ExportFilter] })
    filterParams: ExportFilter[],
  ) {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.getWholeCompressedHistories(
      startDate,
      filterParams,
      isTestnet,
    );
  }

  @Query(() => TestingReportConnection)
  getTestingReport(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.getTestingReport(first, after);
  }

  @Query(() => [StatisticData])
  getStatisticData() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.getStatisticData();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  autoTesting() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.autoTesting();
  }
}
