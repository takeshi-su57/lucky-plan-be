import { Resolver, Mutation, Args } from '@nestjs/graphql';

import { AuthService } from './auth.service';
import { GetTokenResponse } from './dto/auth.response';
import { GetTokenInput, ChangePasswordInput } from './dto/auth.input';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => GetTokenResponse)
  getToken(@Args('input') input: GetTokenInput) {
    return this.authService.getToken(input.password);
  }

  @Mutation(() => Boolean)
  changePassword(@Args('input') input: ChangePasswordInput) {
    return this.authService.changePassword(
      input.oldPassword,
      input.newPassword,
    );
  }
}
