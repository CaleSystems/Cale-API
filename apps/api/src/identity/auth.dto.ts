import type { LoginRequest, RefreshRequest } from '@cale/contracts';
import { IsString, IsUUID, Length } from 'class-validator';

// `implements` pins these to @cale/contracts' shape at compile time — a field
// added, renamed, or retyped here without updating the shared contract (or
// vice versa) fails the build instead of silently drifting.
export class LoginDto implements LoginRequest {
  @IsUUID()
  staffId: string;

  @IsUUID()
  branchId: string;

  @IsString()
  @Length(4, 12)
  pin: string;
}

export class RefreshDto implements RefreshRequest {
  @IsString()
  refreshToken: string;
}
