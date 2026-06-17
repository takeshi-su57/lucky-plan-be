import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class MicroserviceStatus {
  @Field(() => String)
  service: string;

  @Field(() => [Int])
  pids: number[];
}
