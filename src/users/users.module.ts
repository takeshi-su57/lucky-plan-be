import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { TagsResolver } from './tags.resolver';
import { TagsService } from './tags.service';

@Module({
  providers: [UsersResolver, TagsResolver, TagsService, UsersService],
  exports: [UsersService, TagsService],
})
export class UsersModule {}
