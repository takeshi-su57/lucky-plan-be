import { Resolver } from '@nestjs/graphql';
import { Action } from './entities/action.entity';

@Resolver(() => Action)
export class ActionsResolver {
  constructor() {}
}
