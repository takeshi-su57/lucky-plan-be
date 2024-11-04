import { Module } from '@nestjs/common';
import { FollowerService } from './follower.service';
import { FollowerResolver } from './follower.resolver';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [UsersModule],
  providers: [FollowerResolver, FollowerService],
})
export class FollowerModule {}
