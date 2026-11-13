import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class PublicCompanyDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mst: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false, description: 'Tax address from MST lookup' })
  @IsOptional()
  @IsString()
  taxAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  organizationType?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  website?: string;
}

export class PublicJobDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'Mô tả chi tiết công việc (HTML)' })
  @IsNotEmpty()
  @IsString()
  detailDescription: string;

  @ApiProperty({ description: 'Comma-separated category ids' })
  @IsNotEmpty()
  @IsString()
  category: string;

  @ApiProperty({ description: 'Comma-separated location ids' })
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiProperty()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map(String).join(',');
    return String(value ?? '').trim();
  })
  @IsNotEmpty()
  typeOfEmployment: string;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  experienceLevel: number;

  @ApiProperty({
    description: 'Comma-separated required qualification ids',
  })
  @IsNotEmpty()
  @IsString()
  requiredQualification: string;

  @ApiProperty({ description: 'Comma-separated gender ids', required: false })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiProperty()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map(String).join(',');
    return value !== null && value !== undefined ? String(value).trim() : value;
  })
  @IsNotEmpty()
  grade: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  postedDate?: string;

  @ApiProperty()
  @IsDateString()
  deadline: string;

  @ApiProperty({ description: 'Salary min (required if salaryType != 5)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  salaryMin?: number | null;

  @ApiProperty({ description: 'Salary max (required if salaryType != 5)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  salaryMax?: number | null;

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  salaryType: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiProperty({
    description: 'Comma-separated benefit ids (e.g. "1,2,3")',
  })
  @IsNotEmpty()
  @IsString()
  benefits: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address: string;
}

export class PublicFreePostRequestDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mst: string;

  @ApiProperty({ type: PublicCompanyDto })
  @ValidateNested()
  @Type(() => PublicCompanyDto)
  company: PublicCompanyDto;

  @ApiProperty({ type: PublicJobDto })
  @ValidateNested()
  @Type(() => PublicJobDto)
  job: PublicJobDto;
}

export class PublicFreePostResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty()
  redirectUrl: string;

  @ApiProperty({ required: false })
  @IsOptional()
  access_token?: string;

  @ApiProperty({ required: false })
  user?: any;
}

