import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import {
  AddUserInput,
  ChangeUserRoleInput,
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
  changeRole(@Args('input') input: ChangeUserRoleInput) {
    return this.usersService.changeRole(input.address, input.role);
  }

  @Query(() => User, { nullable: true })
  getUserByAddress(@Args('input') input: GetUserByAddressInput) {
    return this.usersService.getUserByAddress(input.address);
  }
}
