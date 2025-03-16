import { Resolver, Mutation, Query, Field, ObjectType } from '@nestjs/graphql';

import { SystemService } from './system.service';
import { GqlAuthGuard } from './auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from './auth/gql-role.guard';
import { UserPermission } from '@prisma/client';
import { Roles } from './auth/roles.decorator';

@ObjectType()
class ServerTime {
  @Field(() => String)
  timezone: string;

  @Field(() => Number)
  timestamp: number;
}

@Resolver()
export class SystemResolver {
  constructor(private readonly systemsService: SystemService) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  pauseSystem() {
    return this.systemsService.pauseSystem();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  resumeSystem() {
    return this.systemsService.resumeSystem();
  }

  @Query(() => Boolean)
  systemStatus() {
    return this.systemsService.isSystemPaused();
  }

  @Query(() => ServerTime)
  getServerTime() {
    return this.systemsService.getServerTime();
  }
}
