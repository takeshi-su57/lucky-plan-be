import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { ContractsService } from './contracts.service';
import { Contract, TradePair } from './entities/contract.entity';
import {
  CreateContractInput,
  ChangeContractStatusInput,
} from './dto/contract.input';
import { TradingVariableService } from 'src/global/trading-variable.service';

@Resolver(() => Contract)
export class ContractsResolver {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly tradingVariableService: TradingVariableService,
  ) {}

  @Mutation(() => Contract)
  createContract(@Args('input') input: CreateContractInput) {
    return this.contractsService.create(input);
  }

  @Mutation(() => Contract)
  changeContractStatus(@Args('input') input: ChangeContractStatusInput) {
    return this.contractsService.changeStatus(input);
  }

  @Query(() => [Contract])
  getAllContracts() {
    return this.contractsService.findAll();
  }

  @Query(() => Contract)
  findContract(@Args('id', { type: () => Int }) id: number) {
    return this.contractsService.findOne(id);
  }

  @Query(() => [TradePair])
  getTradePairs(@Args('contractId', { type: () => Int }) contractId: number) {
    return this.tradingVariableService.getTradePairs(contractId);
  }
}
