import { IsString, IsUUID, Length } from 'class-validator';

export class LoginDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  branchId: string;

  @IsString()
  @Length(4, 12)
  pin: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}
