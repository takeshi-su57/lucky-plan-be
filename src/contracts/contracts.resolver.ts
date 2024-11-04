import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { ContractsService } from './contracts.service';
import { Contract } from './entities/contract.entity';
import { CreateContractInput, UpdateContractInput } from './dto/contract.input';

@Resolver(() => Contract)
export class ContractsResolver {
  constructor(private readonly contractsService: ContractsService) {}

  @Mutation(() => Contract)
  createContract(@Args('input') input: CreateContractInput) {
    return this.contractsService.create(input);
  }

  @Query(() => [Contract])
  findAllContracts() {
    return this.contractsService.findAll();
  }

  @Query(() => Contract, { nullable: true })
  findContract(@Args('id', { type: () => Int }) id: number) {
    return this.contractsService.findOne(id);
  }

  @Mutation(() => Contract, { nullable: true })
  updateContract(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateContractInput,
  ) {
    return this.contractsService.update(id, input);
  }

  @Mutation(() => Contract, { nullable: true })
  removeContract(@Args('id', { type: () => Int }) id: number) {
    return this.contractsService.remove(id);
  }
}
