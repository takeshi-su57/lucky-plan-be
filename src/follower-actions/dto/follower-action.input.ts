import { IsNotEmpty, IsNumber } from 'class-validator';

export class CreateFollowerActionInput {
  @IsNotEmpty()
  @IsNumber()
  actionId: number;

  @IsNotEmpty()
  @IsNumber()
  taskId: number;
}
