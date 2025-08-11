import { InputType, Int, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class CreatePositionInput {
  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @Field(() => Int)
  index: number;
}

@InputType()
export class FindPositionInput extends CreatePositionInput {}
