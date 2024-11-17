import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { PositionsService } from './positions.service';
import { Position } from './entities/position.entity';
import { FindPositionInput } from './dto/position.input';

@Resolver(() => Position)
export class PositionsResolver {
  constructor(private readonly positionsService: PositionsService) {}

  @Query(() => [Position])
  findAllPositions() {
    return this.positionsService.findAll();
  }

  @Query(() => Position, { nullable: true })
  findPositionById(@Args('id', { type: () => Int }) id: number) {
    return this.positionsService.findOne(id);
  }

  @Query(() => Position, { nullable: true })
  findPosition(@Args('input') input: FindPositionInput) {
    return this.positionsService.find(input.address, input.index);
  }
}
