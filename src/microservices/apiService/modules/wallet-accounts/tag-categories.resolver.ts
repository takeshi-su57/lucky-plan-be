import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { TagCategoriesService } from './tag-categories.service';
import { TagCategory } from './entities/tag-category.entity';
import { TagCategoryInput } from './dto/tag-category.input';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { User } from 'src/microservices/apiService/modules/auth/entities/auth.entity';

@Resolver()
export class TagCategoriesResolver {
  constructor(private readonly tagCategoriesService: TagCategoriesService) {}

  @Mutation(() => TagCategory)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  upsertCategory(
    @Args('input') input: TagCategoryInput,
    @CurrentUser() user: User,
  ) {
    return this.tagCategoriesService.upsert(user.address, input);
  }

  @Mutation(() => TagCategory)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteCategory(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.tagCategoriesService.delete(user.address, id);
  }

  @Query(() => [TagCategory])
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllCategories(@CurrentUser() user: User) {
    return this.tagCategoriesService.findAll(user.address);
  }
}
