import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { ActionsService } from './actions.service';
import { Action } from './entities/action.entity';

@Resolver(() => Action)
export class ActionsResolver {
  constructor(private readonly actionsService: ActionsService) {}

  @Query(() => [Action])
  findAllActions() {
    return this.actionsService.findAll();
  }

  @Query(() => [Action])
  findActionsByPosition(@Args('positionId') positionId: number) {
    return this.actionsService.findByPosition(positionId);
  }

  @Query(() => Action, { nullable: true })
  findAction(@Args('id', { type: () => Int }) id: number) {
    return this.actionsService.findOne(id);
  }
}
