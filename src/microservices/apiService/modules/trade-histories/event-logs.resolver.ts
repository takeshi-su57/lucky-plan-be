import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { PnlSnapshotKind, Platform, UserPermission } from '@prisma/client';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';

import {
  PnlSnapshotV2DetailsConnection,
  PnlSnapshotV2InitializedFlag,
  PerpTradingEventLog,
  PnlSnapshotV2DetailsForPagination,
} from './entities/event-logs.entity';

import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsV2Service } from './pnlsnapshotV2.service';
import { ExportFilter } from './dto/trade-history.input';
import { WholeCompressedHistoriesV2 } from './entities/trade-history.entity';
import { BacktestV2Service } from './backtest-v2.service';

@Resolver(() => PerpTradingEventLog)
export class EventLogsResolver {
  constructor(
    private readonly eventLogsService: EventLogsService,
    private readonly pnlSnapshotsV2Service: PnlSnapshotsV2Service,
    private readonly backtestService: BacktestV2Service,
  ) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async buildPnlSnapshotsV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    this.pnlSnapshotsV2Service.buildSnapshots(platform, dateStr, isForceBuild);

    return true;
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async dynamicSnapshotBuildV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    this.pnlSnapshotsV2Service.dynamicSnapshotBuild(
      platform,
      dateStr,
      // payload.isForceBuild,
    );

    return true;
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async initializePnlSnapshotV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('beginingDate', { type: () => Date }) beginingDate: Date,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    this.pnlSnapshotsV2Service.initializePnlSnapshot(
      platform,
      beginingDate,
      isForceBuild,
    );

    return true;
  }

  @Query(() => PnlSnapshotV2InitializedFlag, { nullable: true })
  isPnlSnapshotV2Initialized(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return this.pnlSnapshotsV2Service.isPnlSnapshotInitialized(
      platform,
      dateStr,
    );
  }

  @Query(() => [PnlSnapshotV2InitializedFlag])
  getPnlSnapshotV2InitializedFlag(
    @Args('platform', { type: () => Platform }) platform: Platform,
  ) {
    return this.pnlSnapshotsV2Service.getAllPnlSnapshotInitializedFlag(
      platform,
    );
  }

  @Query(() => [[PerpTradingEventLog]])
  getPerpEventLogs(
    @Args('addresses', { type: () => [String] }) addresses: string[],
    @Args('platform', { type: () => Platform }) platform: Platform,
  ) {
    return this.eventLogsService.getPerpEventLogs(addresses, platform);
  }

  @Query(() => PnlSnapshotV2DetailsConnection)
  getPnlSnapshotsV2(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('kind', { type: () => PnlSnapshotKind }) kind: PnlSnapshotKind,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.pnlSnapshotsV2Service.getPnlSnapshots(
      dateStr,
      platform,
      kind,
      first,
      after,
    );
  }

  @Query(() => PnlSnapshotV2DetailsForPagination)
  getPnlsnpashotsV2ByPagination(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('kind', { type: () => PnlSnapshotKind }) kind: PnlSnapshotKind,
    @Args('page', { type: () => Int }) page: number,
    @Args('limit', { type: () => Int }) limit: number,
  ) {
    return this.pnlSnapshotsV2Service.getPnlSnapshotsByPagination(
      dateStr,
      platform,
      kind,
      page,
      limit,
    );
  }

  @Query(() => WholeCompressedHistoriesV2)
  getWholeCompressedHistoriesV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('filterParams', { type: () => [ExportFilter] })
    filterParams: ExportFilter[],
  ) {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return this.backtestService.getWholeCompressedHistories(
      platform,
      startDate,
      filterParams,
    );
  }
}
