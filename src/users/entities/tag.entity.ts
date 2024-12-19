import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class Tag {
  @Field()
  tag: string;

  @Field()
  description: string;

  @Field()
  color: string;
}
