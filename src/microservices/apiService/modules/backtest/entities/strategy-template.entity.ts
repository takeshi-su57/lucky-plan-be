import { ObjectType, Field, Int, registerEnumType, ID } from '@nestjs/graphql';
import { StrategyCategory, Prisma } from 'generated/prisma/client';
import { JSONScalar } from 'src/global/global.module';

registerEnumType(StrategyCategory, {
  name: 'StrategyCategory',
  description: 'Category of trading strategy',
});

@ObjectType()
export class StrategyTemplate {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => StrategyCategory)
  category: StrategyCategory;

  @Field(() => JSONScalar, {
    description: 'Factory configuration (same structure as OptimizationParams)',
  })
  factoryConfig: Prisma.JsonValue;

  @Field(() => Boolean)
  isActive: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class StrategyTemplateWithStats extends StrategyTemplate {
  @Field(() => Int, {
    description: 'Total number of searches using this template',
  })
  totalSearches: number;

  @Field(() => Int, {
    description: 'Total number of backtest tasks using this template',
  })
  totalTasks: number;
}
