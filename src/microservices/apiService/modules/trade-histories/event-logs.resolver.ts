import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { Platform, UserPermission } from 'generated/prisma/client';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';

import {
  PnlSnapshotV2DetailsConnection,
  PnlSnapshotV2InitializedFlag,
  PerpTradingEventLog,
  PerpTradeHistory,
} from './entities/event-logs.entity';

import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';

@Resolver(() => PerpTradingEventLog)
export class EventLogsResolver {
  constructor(
    private readonly eventLogsService: EventLogsService,
    private readonly pnlSnapshotsService: PnlSnapshotsService,
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
    this.pnlSnapshotsService.dynamicSnapshotBuild(platform, dateStr);

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

  @Query(() => [[PerpTradeHistory]])
  getPerpTradeHistories(
    @Args('addresses', { type: () => [String] }) addresses: string[],
    @Args('platform', { type: () => Platform }) platform: Platform,
  ) {
    return this.eventLogsService.getPerpTradeHistories(addresses, platform);
  }

  @Query(() => PnlSnapshotV2DetailsConnection)
  getPnlSnapshotsV2(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('isDesc', { type: () => Boolean }) isDesc: boolean,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => String, nullable: true }) after: string | null,
  ) {
    return this.pnlSnapshotsService.getPnlSnapshots(
      dateStr,
      platform,
      isDesc,
      first,
      after,
    );
  }
}
