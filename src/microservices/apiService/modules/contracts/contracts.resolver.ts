import { Resolver, Query, Args, Int } from '@nestjs/graphql';

import { ContractsService } from './contracts.service';
import {
  Contract,
  TradeCollateral,
  TradePair,
} from './entities/contract.entity';

import { GnsService } from 'src/global/gns.service';

@Resolver(() => Contract)
export class ContractsResolver {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly gnsService: GnsService,
  ) {}

  @Query(() => [Contract])
  getAllContracts() {
    return this.contractsService.findAll();
  }

  @Query(() => Contract)
  findContract(@Args('id', { type: () => Int }) id: number) {
    return this.contractsService.findOne(id);
  }

  @Query(() => [TradePair])
  getTradePairs(
    @Args('contractId', { type: () => [Int] }) contractIds: number[],
  ) {
    return this.gnsService.getTradePairs(contractIds);
  }

  @Query(() => [TradeCollateral])
  getTradeCollaterals(
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.gnsService.getTradeCollaterals(contractId);
  }
}
