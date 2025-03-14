import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class AddUserInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;
}

@InputType()
export class ChangeUserTagInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @Field()
  tag: string;
}

@InputType()
export class GetUserByAddressInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;
}
