import { Resolver, Query, Args, Int } from '@nestjs/graphql';

import { ContractsService } from './contracts.service';
import {
  Contract,
  TradeCollateral,
  TradePair,
} from './entities/contract.entity';

import { GnsV10Service } from 'src/global/gnsV10.service';

@Resolver(() => Contract)
export class ContractsResolver {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly gnsV10Service: GnsV10Service,
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
    return this.gnsV10Service.getTradePairs(contractIds);
  }

  @Query(() => [TradeCollateral])
  getTradeCollaterals(
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.gnsV10Service.getTradeCollaterals(contractId);
  }
}
