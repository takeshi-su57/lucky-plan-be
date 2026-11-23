import { UseGuards } from '@nestjs/common';
import { Args, Float, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { RpcEndpointState, UserPermission } from 'generated/prisma/client';

import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { Roles } from '../auth/roles.decorator';

import {
  CreateRpcEndpointsInput,
  UpdateRpcEndpointInput,
} from './dto/rpc-endpoint.input';
import {
  RpcEndpointCheckResult,
  RpcWorkerDashboard,
} from './entities/rpc-worker.entity';
import { RpcWorkersService } from './rpc-workers.service';

@Resolver()
export class RpcWorkersResolver {
  constructor(private readonly rpcWorkersService: RpcWorkersService) {}

  @Query(() => RpcWorkerDashboard)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  rpcWorkerDashboard() {
    return this.rpcWorkersService.getDashboard();
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  pauseRpcEndpoint(@Args('id', { type: () => Int }) id: number) {
    return this.rpcWorkersService.setState(id, RpcEndpointState.Paused);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  resumeRpcEndpoint(@Args('id', { type: () => Int }) id: number) {
    return this.rpcWorkersService.setState(id, RpcEndpointState.Active);
  }

  @Mutation(() => Int, {
    description: 'Returns the number of endpoints created.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createRpcEndpoints(@Args('input') input: CreateRpcEndpointsInput) {
    return this.rpcWorkersService.createEndpoints(input);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateRpcEndpoint(@Args('input') input: UpdateRpcEndpointInput) {
    return this.rpcWorkersService.updateEndpoint(input);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  setRpcRateGroupLimit(
    @Args('key') key: string,
    @Args('limit', { type: () => Int }) limit: number,
    @Args('ratePerSecond', {
      type: () => Float,
      nullable: true,
      description: 'Requests per second; 0 removes the rate limit.',
    })
    ratePerSecond?: number | null,
  ) {
    return this.rpcWorkersService.setRateGroupLimit(key, limit, ratePerSecond);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteRpcEndpoint(@Args('id', { type: () => Int }) id: number) {
    return this.rpcWorkersService.deleteEndpoint(id);
  }

  @Mutation(() => [RpcEndpointCheckResult], {
    description:
      'Health-checks endpoints (eth_blockNumber). With no filter, checks all.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  checkRpcEndpoints(
    @Args('ids', { type: () => [Int], nullable: true }) ids?: number[] | null,
    @Args('tokenId', { type: () => String, nullable: true })
    tokenId?: string | null,
    @Args('chainId', { type: () => Int, nullable: true })
    chainId?: number | null,
  ) {
    return this.rpcWorkersService.checkEndpoints({ ids, tokenId, chainId });
  }

  @Mutation(() => Int, {
    description: 'Pauses or resumes every chain of a token. Returns the count.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  setRpcTokenState(
    @Args('tokenId') tokenId: string,
    @Args('state', { type: () => RpcEndpointState }) state: RpcEndpointState,
  ) {
    if (state === RpcEndpointState.Disabled) {
      throw new BadRequestException('Use Active or Paused');
    }

    return this.rpcWorkersService.setTokenState(tokenId, state);
  }

  @Mutation(() => Int, { description: 'Adds chains to an existing token.' })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  addRpcTokenChains(
    @Args('tokenId') tokenId: string,
    @Args('chainIds', { type: () => [Int] }) chainIds: number[],
  ) {
    return this.rpcWorkersService.addTokenChains(tokenId, chainIds);
  }

  @Mutation(() => Int, {
    description: 'Deletes every endpoint of a token. Returns the count.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteRpcToken(@Args('tokenId') tokenId: string) {
    return this.rpcWorkersService.deleteToken(tokenId);
  }

  @Mutation(() => Boolean, {
    description:
      'When true, backfills use only Paid-tier endpoints. Endpoint states are kept.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  setRpcBackfillPaidOnly(@Args('enabled') enabled: boolean) {
    return this.rpcWorkersService.setPaidOnly(enabled);
  }

  @Mutation(() => Int, {
    description:
      'Sets max block range (0 = learn it) and/or parallel requests on every chain of a token.',
  })
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateRpcToken(
    @Args('tokenId') tokenId: string,
    @Args('maxBlockRange', { type: () => Int, nullable: true })
    maxBlockRange?: number | null,
    @Args('concurrency', { type: () => Int, nullable: true })
    concurrency?: number | null,
  ) {
    return this.rpcWorkersService.updateToken(tokenId, {
      maxBlockRange,
      concurrency,
    });
  }
}
