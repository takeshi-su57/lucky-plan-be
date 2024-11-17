import { InputType, Int, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class CreateContractInput {
  @IsNotEmpty()
  @Field(() => Int)
  chainId: number;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsString()
  @Field(() => String, { nullable: true })
  description: string | null;
}
