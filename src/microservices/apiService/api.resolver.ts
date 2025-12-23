import {
  Resolver,
  Mutation,
  Query,
  Field,
  ObjectType,
  Args,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserPermission } from '@prisma/client';

import { ApiService } from './api.service';
import { GqlAuthGuard } from './modules/auth/gql-auth.guard';
import { RolesGuard } from './modules/auth/gql-role.guard';
import { Roles } from './modules/auth/roles.decorator';
import { SecurityService } from '../../global/security.service';
import { MicroserviceStatus } from './entities/api.entities';

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
  startSubService(@Args('service') service: string) {
    return this.apiService.startSubService(service);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  killSubService(@Args('service') service: string) {
    return this.apiService.killSubService(service);
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
  async isSafeApp() {
    return await this.securityService.isSafeApp();
  }

  @Query(() => Boolean)
  systemStatus() {
    return this.apiService.isSystemPaused();
  }

  @Query(() => ServerTime)
  getServerTime() {
    return this.apiService.getServerTime();
  }

  @Query(() => [MicroserviceStatus])
  getMicroserviceStatus() {
    return this.apiService.getMicroserviceStatus();
  }
}
