import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { TagsService } from './tags.service';
import { Tag } from './entities/tag.entity';
import { TagInput } from './dto/tag.input';
import { Roles } from 'src/auth/roles.decorator';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/user.decorator';
import { User } from 'src/auth/entities/auth.entity';
import { RolesGuard } from 'src/auth/gql-role.guard';
import { UserPermission } from '@prisma/client';

@Resolver(() => Tag)
export class TagsResolver {
  constructor(private readonly tagsService: TagsService) {}

  @Mutation(() => Tag)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  upsertTag(@Args('input') input: TagInput, @CurrentUser() user: User) {
    return this.tagsService.upsert(user.address, input);
  }

  @Mutation(() => Tag)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteTag(
    @Args('tag', { type: () => String }) tag: string,
    @CurrentUser() user: User,
  ) {
    return this.tagsService.delete(user.address, tag);
  }

  @Query(() => [Tag])
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllTags(@CurrentUser() user: User) {
    return this.tagsService.findAll(user.address);
  }
}
