import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { FollowerService } from './follower.service';
import { Follower } from './entities/follower.entity';
import { GetFollowerByAddressInput } from './dto/follower.input';

@Resolver(() => Follower)
export class FollowerResolver {
  constructor(private readonly followerService: FollowerService) {}

  @Mutation(() => Follower)
  generateNewFollower() {
    return this.followerService.generateNewFollower();
  }

  @Query(() => Follower)
  getFollowerByAddress(@Args('input') input: GetFollowerByAddressInput) {
    return this.followerService.getFollowerByAddress(input.address);
  }

  @Query(() => String)
  getFollowerPrivateKey(@Args('input') input: GetFollowerByAddressInput) {
    return this.followerService.getPrivateKey(input.address);
  }

  @Query(() => [Follower])
  getAllFollowers() {
    return this.followerService.getAllFollowers();
  }
}
