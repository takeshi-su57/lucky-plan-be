import { ObjectType, Field, Int, Float, ID } from '@nestjs/graphql';

@ObjectType()
export class WfaCompletionPreviewResult {
  @Field(() => Int)
  currentCount: number;

  @Field(() => Int)
  passedCount: number;

  @Field(() => Int)
  failedCount: number;
}

@ObjectType()
export class WfaWindowResult {
  @Field(() => ID)
  candidateId: string;

  @Field()
  configId: string;

  @Field(() => Int)
  windowIndex: number;

  @Field(() => Float, { nullable: true })
  consistency?: number | null;

  @Field(() => Float, { nullable: true })
  degradation?: number | null;

  @Field(() => String)
  status: string;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;
}
