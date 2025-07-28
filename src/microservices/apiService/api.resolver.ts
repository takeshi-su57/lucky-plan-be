import {
  Resolver,
  Mutation,
  Query,
  Field,
  ObjectType,
  Args,
} from '@nestjs/graphql';

import { ApiService } from './api.service';
import { GqlAuthGuard } from '../../auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../../auth/gql-role.guard';
import { UserPermission } from '@prisma/client';
import { Roles } from '../../auth/roles.decorator';
import { SecurityService } from '../../global/security.service';

@ObjectType()
class ServerTime {
  @Field(() => String)
  timezone: string;

  @Field(() => Number)
  timestamp: number;
}

@Resolver()
export class ApiResolver {
  constructor(
    private readonly apiService: ApiService,
    private readonly securityService: SecurityService,
  ) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  pauseSystem() {
    return this.apiService.pauseSystem();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  resumeSystem(
    @Args('password', { type: () => String, nullable: true })
    password: string | null,
  ) {
    return this.apiService.resumeSystem(password);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  makeSafeApp(@Args('password') password: string) {
    return this.apiService.makeSafeApp(password);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  changePassword(
    @Args('oldPassword') oldPassword: string,
    @Args('newPassword') newPassword: string,
  ) {
    return this.apiService.changePassword(oldPassword, newPassword);
  }

  @Query(() => Boolean)
  isSafeApp() {
    return this.securityService.isSafeApp;
  }

  @Query(() => Boolean)
  systemStatus() {
    return this.apiService.isSystemPaused();
  }

  @Query(() => ServerTime)
  getServerTime() {
    return this.apiService.getServerTime();
  }
}
