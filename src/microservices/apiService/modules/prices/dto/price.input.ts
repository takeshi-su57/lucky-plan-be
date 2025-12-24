import { IsNotEmpty, IsString, IsNumber, IsDate } from 'class-validator';

export class CreateGnsPriceInput {
  @IsNotEmpty()
  @IsString()
  pair: string;

  @IsNotEmpty()
  @IsNumber()
  price: number;

  @IsNotEmpty()
  @IsDate()
  date: Date;
}
