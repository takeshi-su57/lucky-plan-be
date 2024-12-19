import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import {
  AddUserInput,
  ChangeUserTagInput,
  GetUserByAddressInput,
} from './dto/user.input';

@Resolver(() => User)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Mutation(() => User)
  addUser(@Args('input') input: AddUserInput) {
    return this.usersService.addUser(input.address);
  }

  @Mutation(() => User)
  addTagToUser(@Args('input') input: ChangeUserTagInput) {
    return this.usersService.addTag(input);
  }

  @Mutation(() => User)
  removeTagFromUser(@Args('input') input: ChangeUserTagInput) {
    return this.usersService.removeTag(input);
  }

  @Query(() => User)
  getUserByAddress(@Args('input') input: GetUserByAddressInput) {
    return this.usersService.getUserByAddress(input.address);
  }

  @Query(() => [User])
  getAllUsers() {
    return this.usersService.getAllUsers();
  }
}
