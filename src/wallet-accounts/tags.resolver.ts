import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { TagsService } from './tags.service';
import { Tag } from './entities/tag.entity';
import { TagInput } from './dto/tag.input';

@Resolver(() => Tag)
export class TagsResolver {
  constructor(private readonly tagsService: TagsService) {}

  @Mutation(() => Tag)
  upsertTag(@Args('input') input: TagInput) {
    return this.tagsService.upsert(input);
  }

  @Mutation(() => Tag)
  deleteTag(@Args('tag', { type: () => String }) tag: string) {
    return this.tagsService.delete(tag);
  }

  @Query(() => [Tag])
  getAllTags() {
    return this.tagsService.findAll();
  }
}
