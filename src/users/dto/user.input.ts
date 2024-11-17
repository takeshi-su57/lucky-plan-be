import { InputType, Field } from '@nestjs/graphql';
import { UserRole } from '@prisma/client';
import { IsIn, IsNotEmpty } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class AddUserInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;
}

@InputType()
export class ChangeUserRoleInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsIn([UserRole.Leader, UserRole.User])
  @Field()
  role: UserRole;
}

@InputType()
export class GetUserByAddressInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;
}
