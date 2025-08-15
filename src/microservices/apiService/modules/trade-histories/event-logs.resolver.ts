import { UseGuards, Inject } from '@nestjs/common';
import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { ClientProxy } from '@nestjs/microservices';
import { PnlSnapshotKind, Platform, UserPermission } from '@prisma/client';

import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';

import {
  PnlSnapshotV2DetailsConnection,
  PnlSnapshotV2InitializedFlag,
  PerpTradingEventLog,
} from './entities/event-logs.entity';

import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsV2Service } from './pnlsnapshotV2.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

@Resolver(() => PerpTradingEventLog)
export class EventLogsResolver {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly eventLogsService: EventLogsService,
    private readonly pnlSnapshotsV2Service: PnlSnapshotsV2Service,
  ) {}

  @Mutation(() => PnlSnapshotV2InitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async buildPnlSnapshotsV2(
    @Args('dateStr', { type: () => String }) dateStr: string,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return await new Promise<PnlSnapshotV2InitializedFlag>(
      (resolve, reject) => {
        this.redisClient
          .send(PATTERNS.Leaderboard.BuildPnlSnapshotV2, {
            dateStr,
            isForceBuild,
          })
          .subscribe({
            next: (data) => resolve(data),
            error: (err) => reject(err),
          });
      },
    );
  }

  @Mutation(() => PnlSnapshotV2InitializedFlag, { nullable: true })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async dynamicSnapshotBuildV2(
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return await new Promise<PnlSnapshotV2InitializedFlag>(
      (resolve, reject) => {
        this.redisClient
          .send(PATTERNS.Leaderboard.DynamicSnapshotV2Build, {
            dateStr,
          })
          .subscribe({
            next: (data) => resolve(data),
            error: (err) => reject(err),
          });
      },
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async initializePnlSnapshotV2(
    @Args('beginingDate', { type: () => Date }) beginingDate: Date,
    @Args('isForceBuild', { type: () => Boolean }) isForceBuild: boolean,
  ) {
    return await new Promise<PnlSnapshotV2InitializedFlag>(
      (resolve, reject) => {
        this.redisClient
          .send(PATTERNS.Leaderboard.InitializePnlSnapshotV2, {
            beginingDate,
            isForceBuild,
          })
          .subscribe({
            next: (data) => resolve(data),
            error: (err) => reject(err),
          });
      },
    );
  }

  @Query(() => PnlSnapshotV2InitializedFlag, { nullable: true })
  isPnlSnapshotV2Initialized(
    @Args('dateStr', { type: () => String }) dateStr: string,
  ) {
    return this.pnlSnapshotsV2Service.isPnlSnapshotInitialized(dateStr);
  }

  @Query(() => [PnlSnapshotV2InitializedFlag])
  getPnlSnapshotV2InitializedFlag() {
    return this.pnlSnapshotsV2Service.getAllPnlSnapshotInitializedFlag();
  }

  @Query(() => [PerpTradingEventLog])
  getPerpEventLogs(
    @Args('address') address: string,
    @Args('platform', { type: () => Platform }) platform: Platform,
  ) {
    return this.eventLogsService.getPerpEventLogs([address], platform);
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
}
