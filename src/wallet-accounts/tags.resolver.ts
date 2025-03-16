import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { TagsService } from './tags.service';
import { Tag } from './entities/tag.entity';
import { TagInput } from './dto/tag.input';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';

@Resolver(() => Tag)
export class TagsResolver {
  constructor(private readonly tagsService: TagsService) {}

  @Mutation(() => Tag)
  @UseGuards(GqlAuthGuard)
  upsertTag(@Args('input') input: TagInput) {
    return this.tagsService.upsert(input);
  }

  @Mutation(() => Tag)
  @UseGuards(GqlAuthGuard)
  deleteTag(@Args('tag', { type: () => String }) tag: string) {
    return this.tagsService.delete(tag);
  }

  @Query(() => [Tag])
  @UseGuards(GqlAuthGuard)
  getAllTags() {
    return this.tagsService.findAll();
  }
}
