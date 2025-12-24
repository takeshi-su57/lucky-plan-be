import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { User, UserPermission } from 'generated/prisma/client';

import { SLTPRequest } from './entities/sltp.entity';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { SLTPRequestInput } from './dto/sltp.input';
import { SLTPService } from './sltp.service';

@Resolver()
export class SLTPResolver {
  constructor(private readonly sltpService: SLTPService) {}

  @Mutation(() => SLTPRequest)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createSLTP(
    @Args('input') input: SLTPRequestInput,
    @CurrentUser() _user: User,
  ) {
    return this.sltpService.createSLTP(input);
  }

  @Mutation(() => SLTPRequest)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteSLTP(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() _user: User,
  ) {
    return this.sltpService.deleteSLTP(id);
  }

  @Query(() => [SLTPRequest])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getALLSLTPs(@CurrentUser() _user: User) {
    return this.sltpService.getAllSLTPs();
  }
}
