import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';

import { TagCategoriesService } from './tag-categories.service';
import { TagCategory } from './entities/tag-category.entity';
import { TagCategoryInput } from './dto/tag-category.input';

@Resolver()
export class TagCategoriesResolver {
  constructor(private readonly tagCategoriesService: TagCategoriesService) {}

  @Mutation(() => TagCategory)
  upsertTag(@Args('input') input: TagCategoryInput) {
    return this.tagCategoriesService.upsert(input);
  }

  @Mutation(() => TagCategory)
  deleteTag(@Args('id', { type: () => Int }) id: number) {
    return this.tagCategoriesService.delete(id);
  }

  @Query(() => [TagCategory])
  getAllCategories() {
    return this.tagCategoriesService.findAll();
  }
}
