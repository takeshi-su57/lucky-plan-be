import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { TagsResolver } from './tags.resolver';
import { TagsService } from './tags.service';
import { TagCategoriesService } from './tag-categories.service';
import { TagCategoriesResolver } from './tag-categories.resolver';

@Module({
  providers: [
    UsersResolver,
    TagsResolver,
    TagsService,
    UsersService,
    TagCategoriesService,
    TagCategoriesResolver,
  ],
  exports: [UsersService, TagsService, TagCategoriesService],
})
export class UsersModule {}
