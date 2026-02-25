import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Args, Int, Float, Mutation } from '@nestjs/graphql';
import {
  PnlSnapshotKind,
  Platform,
  UserPermission,
} from 'generated/prisma/client';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';

import {
  PnlSnapshotV2DetailsConnection,
  PnlSnapshotV2InitializedFlag,
  PerpTradingEventLog,
} from './entities/event-logs.entity';

import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { ExportFilter } from './dto/event-logs.input';
import { WholeCompressedHistoriesV2 } from './entities/trade-history.entity';
import { BacktestService } from './backtest.service';

@Resolver(() => PerpTradingEventLog)
export class EventLogsResolver {
  constructor(
    private readonly eventLogsService: EventLogsService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
    private readonly backtestService: BacktestService,
  ) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async buildPnlSnapshotsV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    this.pnlSnapshotsService.buildSnapshots(platform, dateStr, isForceBuild);

    return true;
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async dynamicSnapshotBuildV2(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    this.pnlSnapshotsService.dynamicSnapshotBuild(
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
    this.pnlSnapshotsService.initializePnlSnapshot(
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
    return this.pnlSnapshotsService.isPnlSnapshotInitialized(platform, dateStr);
  }

  @Query(() => [PnlSnapshotV2InitializedFlag])
  getPnlSnapshotV2InitializedFlag(
    @Args('platform', { type: () => Platform }) platform: Platform,
  ) {
    return this.pnlSnapshotsService.getAllPnlSnapshotInitializedFlag(platform);
  }

  @Query(() => [[PerpTradingEventLog]])
  getPerpEventLogs(
    @Args('addresses', { type: () => [String] }) addresses: string[],
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('limit', { type: () => Int, nullable: true }) limit: number | null,
  ) {
    return this.eventLogsService.getPerpEventLogs(addresses, platform, limit);
  }

  @Query(() => PnlSnapshotV2DetailsConnection)
  getPnlSnapshotsV2(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('kind', { type: () => PnlSnapshotKind }) kind: PnlSnapshotKind,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
    @Args('minSlope', { type: () => Float }) minSlope: number,
    @Args('minR2', { type: () => Float }) minR2: number,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshots(
      dateStr,
      platform,
      kind,
      first,
      after,
      minSlope,
      minR2,
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
