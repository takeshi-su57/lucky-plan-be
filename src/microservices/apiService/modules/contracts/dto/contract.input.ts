import { InputType, Int, Field } from '@nestjs/graphql';
import { ContractStatus } from 'generated/prisma/client';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

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

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;

  @IsNotEmpty()
  @Field(() => Int)
  lastBlockNumber: number;
}

@InputType()
export class ChangeContractStatusInput {
  @IsNotEmpty()
  @Field(() => Int)
  id: number;

  @IsNotEmpty()
  @IsIn([ContractStatus.Live, ContractStatus.Dead])
  @Field()
  status: ContractStatus;
}
