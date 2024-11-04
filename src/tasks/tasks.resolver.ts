import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { TasksService } from './tasks.service';
import { Task } from './entities/task.entity';

@Resolver(() => Task)
export class TasksResolver {
  constructor(private readonly tasksService: TasksService) {}

  @Query(() => [Task])
  findAllTasks() {
    return this.tasksService.findAll();
  }

  @Query(() => Task, { nullable: true })
  findTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.findOne(id);
  }

  @Query(() => [Task])
  findTasksByMission(
    @Args('missionId', { type: () => Int }) missionId: number,
  ) {
    return this.tasksService.findByMission(missionId);
  }
}
