import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  name?: string;

  @IsEnum(['OWNER', 'ENGINEER'])
  @IsOptional()
  role?: 'OWNER' | 'ENGINEER';
}
