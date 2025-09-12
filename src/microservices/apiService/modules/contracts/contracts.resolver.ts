import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserPermission } from '@prisma/client';

import { ContractsService } from './contracts.service';
import { Contract } from './entities/contract.entity';

import { Roles } from '../auth/roles.decorator';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/entities/auth.entity';

@Resolver(() => Contract)
export class ContractsResolver {
  constructor(private readonly contractsService: ContractsService) {}

  @Query(() => [Contract])
  getAllContracts() {
    return this.contractsService.findAll();
  }

  @Query(() => Contract)
  findContract(@Args('id', { type: () => Int }) id: number) {
    return this.contractsService.findOne(id);
  }

  @Query(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAdaptionStatus(@CurrentUser() _user: User) {
    return this.contractsService.getAdaptionStatus();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  startAdaption(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('shouldRestart', { type: () => Boolean }) shouldRestart: boolean,
    @CurrentUser() _user: User,
  ) {
    return this.contractsService.startAdaption(contractId, shouldRestart);
  }

  @Mutation(() => Contract)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  liveContract(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('fromBlock', { type: () => Int, nullable: true })
    fromBlock: number | null,
    @CurrentUser() _user: User,
  ) {
    return this.contractsService.liveContract(contractId, fromBlock);
  }

  @Mutation(() => Contract)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  disableContract(
    @Args('contractId', { type: () => Int }) contractId: number,
    @CurrentUser() _user: User,
  ) {
    return this.contractsService.disableContract(contractId);
  }
}
