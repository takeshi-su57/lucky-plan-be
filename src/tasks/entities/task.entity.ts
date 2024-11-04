import { ObjectType, Field, Int } from '@nestjs/graphql';
import { TaskStatus } from '@prisma/client';

@ObjectType()
export class Task {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  missionId: number;

  @Field(() => Int)
  actionId: number;

  @Field()
  status: TaskStatus;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
