import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { User, UserHistory } from './entities/user.entity';
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
  addLeader(@Args('input') input: AddUserInput) {
    return this.usersService.addLeader(input.address);
  }

  @Mutation(() => User)
  changeUserRole(@Args('input') input: ChangeUserRoleInput) {
    return this.usersService.changeRole(input.address, input.role);
  }

  @Query(() => User, { nullable: true })
  getUserByAddress(@Args('input') input: GetUserByAddressInput) {
    return this.usersService.getUserByAddress(input.address);
  }

  @Query(() => [UserHistory])
  getAllLeaders(@Args('contractId', { type: () => Int }) contractId: number) {
    return this.usersService.getAllLeaders(contractId);
  }

  @Query(() => [User])
  getAllUsers() {
    return this.usersService.getAllUsers();
  }
}
