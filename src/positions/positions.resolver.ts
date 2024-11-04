import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { PositionsService } from './positions.service';
import { Position } from './entities/position.entity';
import { CreatePositionInput, FindPositionInput } from './dto/position.input';

@Resolver(() => Position)
export class PositionsResolver {
  constructor(private readonly positionsService: PositionsService) {}

  @Mutation(() => Position)
  createPosition(
    @Args('createPositionInput') createPositionInput: CreatePositionInput,
  ) {
    return this.positionsService.create(createPositionInput);
  }

  @Query(() => [Position])
  findAllPositions() {
    return this.positionsService.findAll();
  }

  @Query(() => Position)
  findPositionById(@Args('id', { type: () => Int }) id: number) {
    return this.positionsService.findOne(id);
  }

  @Query(() => Position)
  findPosition(@Args('input') input: FindPositionInput) {
    return this.positionsService.find(input.address, input.index);
  }
}
