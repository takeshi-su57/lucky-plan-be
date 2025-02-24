import { Resolver, Mutation, Query, Field, ObjectType } from '@nestjs/graphql';

import { SystemService } from './system.service';

@ObjectType()
class ServerTime {
  @Field(() => String)
  timezone: string;

  @Field(() => Number)
  timestamp: number;
}

@Resolver()
export class SystemResolver {
  constructor(private readonly systemsService: SystemService) {}

  @Mutation(() => Boolean)
  pauseSystem() {
    return this.systemsService.pauseSystem();
  }

  @Mutation(() => Boolean)
  resumeSystem() {
    return this.systemsService.resumeSystem();
  }

  @Query(() => Boolean)
  systemStatus() {
    return this.systemsService.isSystemPaused();
  }

  @Query(() => ServerTime)
  getServerTime() {
    return this.systemsService.getServerTime();
  }
}
