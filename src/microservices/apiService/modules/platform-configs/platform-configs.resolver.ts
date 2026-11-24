import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Platform, UserPermission } from 'generated/prisma/client';

import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { Roles } from '../auth/roles.decorator';

import {
  PlatformConfigDashboard,
  PlatformConfigItem,
  PlatformConfigReport,
} from './entities/platform-config.entity';
import { PlatformConfigsService } from './platform-configs.service';

@Resolver()
export class PlatformConfigsResolver {
  constructor(
    private readonly platformConfigsService: PlatformConfigsService,
  ) {}

  @Query(() => PlatformConfigDashboard)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  platformConfigDashboard() {
    return this.platformConfigsService.getDashboard();
  }

  @Query(() => [PlatformConfigItem])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  platformConfigItems(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('chainId', { type: () => Int }) chainId: number,
  ) {
    return this.platformConfigsService.getItems(platform, chainId);
  }

  @Mutation(() => [PlatformConfigReport], {
    description: 'Compares chain / GMX API with the live config. Read-only.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  checkPlatformConfigs(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('chainId', { type: () => Int, nullable: true })
    chainId?: number | null,
  ) {
    return this.platformConfigsService.check(platform, chainId);
  }

  @Mutation(() => [PlatformConfigReport], {
    description:
      'Applies missing pairs/markets to the runtime overlay (Metadata). Other services pick it up within 5 minutes.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  syncPlatformConfigs(
    @Args('platform', { type: () => Platform }) platform: Platform,
    @Args('chainId', { type: () => Int, nullable: true })
    chainId?: number | null,
  ) {
    return this.platformConfigsService.sync(platform, chainId);
  }
}
