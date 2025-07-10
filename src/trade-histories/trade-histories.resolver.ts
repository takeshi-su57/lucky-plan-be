import { Resolver, Query, Args, Int, Mutation, Float } from '@nestjs/graphql';
import { TradeHistoriesService } from './trade-histories.service';
import {
  AccPnl,
  PnlSnapshotDetailsConnection,
  PnlSnapshotDevDetails,
  PnlSnapshotDevDetailsV5,
  PnlSnapshotInitializedFlag,
  TestingReport,
  TestingReportConnection,
  TestingReportV2Connection,
  TestingReportV3Connection,
  TestingReportV5Connection,
  TradeHistory,
  TradeTransactionCount,
  WholeCompressedHistories,
} from './entities/trade-history.entity';
import { PnlSnapshotKind, UserPermission } from '@prisma/client';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { PnlSnapshot } from './entities/trade-history.entity';
import {
  ExportFilter,
  ExportFilterV2,
  ExportFilterV3,
  ExportFilterV5,
  GetUserTransactionCountsInput,
} from './dto/trade-history.input';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from 'src/auth/gql-role.guard';
import { Roles } from 'src/auth/roles.decorator';
import { BacktestService } from './backtest.service';
import { BacktestV2Service } from './backtestV2.service';
import { BacktestV3Service } from './backtestV3.service';
import { BacktestV4Service } from './backtestV4.service';
import { BacktestV5Service } from './backtestV5.service';

@Resolver(() => TradeHistory)
export class TradeHistoriesResolver {
  constructor(
    private readonly tradeHistoriesService: TradeHistoriesService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
    private readonly backtestService: BacktestService,
    private readonly backtestServiceV2: BacktestV2Service,
    private readonly backtestServiceV3: BacktestV3Service,
    private readonly backtestServiceV4: BacktestV4Service,
    private readonly backtestServiceV5: BacktestV5Service,
  ) {}

  @Mutation(() => PnlSnapshotInitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  buildPnlSnapshots(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return this.pnlSnapshotsService.buildSnapshots(dateStr, isForceBuild);
  }

  @Mutation(() => PnlSnapshotInitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  dynamicSnapshotBuild(
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return this.pnlSnapshotsService.dynamicSnapshotBuild(dateStr);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  initializePnlSnapshot(
    @Args('beginingDate', { type: () => Date }) beginingDate: Date,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return this.pnlSnapshotsService.initializePnlSnapshot(
      beginingDate,
      isForceBuild,
    );
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
    @Args('filterParams', { type: () => ExportFilter })
    filterParams: ExportFilter,
  ) {
    return this.backtestService.getDevPnlSnapshots(dateStr, filterParams);
  }

  @Query(() => [TradeHistory])
  getMonthlyDevPnlSnapshots(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('filterParams', { type: () => ExportFilter })
    filterParams: ExportFilter,
  ) {
    return this.backtestService.getMonthlyDevPnlSnapshots(
      dateStr,
      filterParams,
    );
  }

  @Query(() => [TradeHistory])
  getWholeResultHistories(
    @Args('filterParams', { type: () => ExportFilter })
    filterParams: ExportFilter,
  ) {
    return this.backtestService.getWholeResultHistories(filterParams);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistories(
    @Args('filterParams', { type: () => ExportFilter })
    filterParams: ExportFilter,
  ) {
    return this.backtestService.getWholeCompressedHistories(filterParams);
  }

  @Query(() => TestingReportConnection)
  getTestingReport(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.backtestService.getTestingReport(first, after);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistoriesV2(
    @Args('filterParams', { type: () => [ExportFilterV2] })
    filterParams: ExportFilterV2[],
  ) {
    return this.backtestServiceV2.getWholeCompressedHistoriesV2(filterParams);
  }

  @Query(() => TestingReportV2Connection)
  getTestingReportV2(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.backtestServiceV2.getTestingReportV2(first, after);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistoriesV3(
    @Args('filterParams', { type: () => [ExportFilterV3] })
    filterParams: ExportFilterV3[],
  ) {
    return this.backtestServiceV3.getWholeCompressedHistoriesV3(filterParams);
  }

  @Query(() => TestingReportV3Connection)
  getTestingReportV3(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.backtestServiceV3.getTestingReportV3(first, after);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistoriesV4(
    @Args('filterParams', { type: () => [ExportFilterV3] })
    filterParams: ExportFilterV3[],
    @Args('ratio', { type: () => Float }) ratio: number,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('isTestnet', { type: () => Boolean }) isTestnet: boolean,
  ) {
    return this.backtestServiceV4.getWholeCompressedHistoriesV4(
      startDate,
      filterParams,
      ratio,
      isTestnet,
    );
  }

  @Query(() => [PnlSnapshotDevDetails])
  getDevPnlSnapshotsV4(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('filterParams', { type: () => [ExportFilterV3] })
    filterParams: ExportFilterV3[],
    @Args('ratio', { type: () => Float }) ratio: number,
  ) {
    return this.backtestServiceV4.getDevPnlSnapshotsV4(
      dateStr,
      filterParams,
      ratio,
    );
  }

  @Query(() => TestingReportV3Connection)
  getTestingReportV4(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.backtestServiceV4.getTestingReportV4(first, after);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  autoTestingV4(@Args('startDate', { type: () => String }) startDate: string) {
    return this.backtestServiceV4.autoTesting(startDate);
  }

  @Query(() => [PnlSnapshotDevDetailsV5])
  getDevPnlSnapshotsV5(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('filterParams', { type: () => [ExportFilterV5] })
    filterParams: ExportFilterV5[],
  ) {
    return this.backtestServiceV5.getDevPnlSnapshotsV5(dateStr, filterParams);
  }

  @Query(() => WholeCompressedHistories)
  getWholeCompressedHistoriesV5(
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('isTestnet', { type: () => Boolean }) isTestnet: boolean,
    @Args('filterParams', { type: () => [ExportFilterV5] })
    filterParams: ExportFilterV5[],
  ) {
    return this.backtestServiceV5.getWholeCompressedHistoriesV5(
      startDate,
      filterParams,
      isTestnet,
    );
  }

  @Query(() => TestingReportV5Connection)
  getTestingReportV5(
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.backtestServiceV5.getTestingReportV5(first, after);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  autoTestingV5() {
    return this.backtestServiceV5.autoTesting();
  }
}
