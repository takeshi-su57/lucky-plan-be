import { Resolver } from '@nestjs/graphql';

import { FollowerAction } from './entities/follower-action.entity';

@Resolver(() => FollowerAction)
export class FollowerActionsResolver {
  constructor() {}
}
