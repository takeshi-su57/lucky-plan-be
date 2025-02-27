import { Resolver } from '@nestjs/graphql';
import { Position } from './entities/position.entity';

@Resolver(() => Position)
export class PositionsResolver {
  constructor() {}
}
