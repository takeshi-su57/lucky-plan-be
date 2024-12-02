import { Module } from '@nestjs/common';
import { FollowerService } from './follower.service';
import { FollowerResolver } from './follower.resolver';
import { UsersModule } from 'src/users/users.module';
import { ContractsModule } from 'src/contracts/contracts.module';

@Module({
  imports: [UsersModule, ContractsModule],
  providers: [FollowerResolver, FollowerService],
  exports: [FollowerService],
})
export class FollowerModule {}
