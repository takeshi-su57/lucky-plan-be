import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { FollowerActionsService } from './follower-actions.service';
import {
  FollowerAction,
  FollowerActionDetails,
} from './entities/follower-action.entity';

@Resolver(() => FollowerAction)
export class FollowerActionsResolver {
  constructor(
    private readonly followerActionsService: FollowerActionsService,
  ) {}

  @Query(() => [FollowerAction])
  findAllFollowerActions() {
    return this.followerActionsService.findAll();
  }

  @Query(() => FollowerActionDetails, { nullable: true })
  findFollowerAction(@Args('id', { type: () => Int }) id: number) {
    return this.followerActionsService.findOne(id);
  }
}
