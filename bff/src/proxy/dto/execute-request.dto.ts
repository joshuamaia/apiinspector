import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const BODY_MODES = ['none', 'json', 'text', 'xml', 'form-urlencoded', 'multipart'] as const;
export type BodyMode = (typeof BODY_MODES)[number];

export const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export class KeyValueDto {
  @IsString()
  @MaxLength(1024)
  key: string;

  @IsString()
  @MaxLength(64 * 1024)
  value: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class FormFieldDto extends KeyValueDto {
  @IsOptional()
  @IsIn(['text', 'file'])
  kind?: 'text' | 'file';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contentType?: string;

  /** File content (base64) when `kind === 'file'`. */
  @IsOptional()
  @IsString()
  base64?: string;
}

export class AuthDto {
  @IsIn(AUTH_TYPES)
  type: AuthType;

  @IsOptional()
  @IsString()
  @MaxLength(16 * 1024)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16 * 1024)
  value?: string;

  @IsOptional()
  @IsIn(['header', 'query'])
  addTo?: 'header' | 'query';
}

export class BodyDto {
  @IsIn(BODY_MODES)
  mode: BodyMode;

  @IsOptional()
  @IsString()
  raw?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields?: FormFieldDto[];
}

export class ExecuteOptionsDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600_000)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  followRedirects?: boolean;
}

export class ExecuteRequestDto {
  @IsIn(HTTP_METHODS, { message: `method must be one of: ${HTTP_METHODS.join(', ')}` })
  method: HttpMethod;

  @IsString()
  @MaxLength(8192)
  url: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => KeyValueDto)
  headers?: KeyValueDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AuthDto)
  auth?: AuthDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BodyDto)
  body?: BodyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExecuteOptionsDto)
  options?: ExecuteOptionsDto;
}
