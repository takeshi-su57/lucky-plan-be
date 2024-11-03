import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class GetTokenResponse {
  @Field()
  accessToken: string;
}
