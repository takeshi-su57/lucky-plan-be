import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { FollowerService } from './follower.service';
import { FollowerDetail } from './entities/follower.entity';
import {
  GetFollowerByAddressInput,
  WithdrawAllInput,
} from './dto/follower.input';

@Resolver(() => FollowerDetail)
export class FollowerResolver {
  constructor(private readonly followerService: FollowerService) {}

  @Mutation(() => FollowerDetail)
  generateNewFollower() {
    return this.followerService.generateNewFollower();
  }

  @Mutation(() => Boolean)
  withdrawAll(@Args('input') input: WithdrawAllInput) {
    return this.followerService.withdrawAll(input.address, input.contractId);
  }

  @Query(() => String)
  getFollowerPrivateKey(@Args('input') input: GetFollowerByAddressInput) {
    return this.followerService.getPrivateKey(input.address);
  }

  @Query(() => [FollowerDetail])
  getAllFollowers(@Args('contractId', { type: () => Int }) contractId: number) {
    return this.followerService.findAll(contractId);
  }
}
