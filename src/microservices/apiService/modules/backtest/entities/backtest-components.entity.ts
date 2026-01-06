import { ObjectType, Field, Float } from '@nestjs/graphql';

@ObjectType()
export class ParamInfo {
  @Field()
  name: string;

  @Field()
  type: string;

  @Field()
  required: boolean;

  @Field({ nullable: true })
  default?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float, { nullable: true })
  min?: number;

  @Field(() => Float, { nullable: true })
  max?: number;
}

@ObjectType()
export class ComponentInfo {
  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => [ParamInfo])
  params: ParamInfo[];
}

@ObjectType()
export class BacktestComponents {
  @Field(() => [ComponentInfo])
  signals: ComponentInfo[];

  @Field(() => [ComponentInfo])
  filters: ComponentInfo[];

  @Field(() => [ComponentInfo])
  risk: ComponentInfo[];

  @Field(() => [ComponentInfo])
  exits: ComponentInfo[];
}
