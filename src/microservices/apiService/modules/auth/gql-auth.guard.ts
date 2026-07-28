import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    const gqlContext = ctx.getContext();
    if (gqlContext.req) return gqlContext.req;

    const authorization =
      gqlContext.connectionParams?.authorization ??
      gqlContext.extra?.connectionParams?.authorization;
    gqlContext.req = {
      headers: {
        authorization: typeof authorization === 'string' ? authorization : '',
      },
    };
    return gqlContext.req;
  }
}
