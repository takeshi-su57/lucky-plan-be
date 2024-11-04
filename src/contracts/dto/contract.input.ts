import { InputType, Int, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';
import { Address } from 'viem';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class CreateContractInput {
  @IsNotEmpty()
  @Field(() => Int)
  id: number;

  @IsNotEmpty()
  @Field(() => Int)
  chainId: number;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: Address;
}

@InputType()
export class UpdateContractInput extends PartialType(
  OmitType(CreateContractInput, ['id']),
) {}
