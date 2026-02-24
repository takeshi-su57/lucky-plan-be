import { ObjectType, Field, Int, Float, ID } from '@nestjs/graphql';

@ObjectType()
export class RobustnessStepResult {
  @Field(() => ID)
  candidateId: string;

  @Field()
  configId: string;

  @Field(() => Int)
  stepIndex: number;

  @Field(() => Float, { nullable: true })
  sharpeRatio?: number | null;

  @Field(() => Float, { nullable: true })
  totalPnl?: number | null;

  @Field(() => Float, { nullable: true })
  maxDrawdown?: number | null;

  @Field(() => String)
  status: string;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;
}
