import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

@InputType()
export class SLTPRequestInput {
  @IsNotEmpty()
  @IsString()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsString()
  @Field()
  positionKey: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  condition: string;
}
