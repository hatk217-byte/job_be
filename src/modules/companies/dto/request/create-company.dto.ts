import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsNumber,
  IsInt,
  IsBoolean,
  ValidateNested,
  IsArray,
  ValidateIf,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateCompanyImageDto {
  @ApiProperty({
    description: 'Image URL',
    example: 'https://example.com/company-image.jpg',
  })
  @IsString({ message: 'URL ảnh phải là chuỗi' })
  @IsNotEmpty({ message: 'URL ảnh không được để trống' })
  @Matches(/^(https?:\/\/.+|\/.+)$/i, { message: 'URL ảnh phải hợp lệ' })
  url: string;
}

export class CreateCompanyDto {
  @ApiProperty({ description: 'Company name', example: 'ABC University' })
  @IsString({ message: 'Tên công ty phải là chuỗi' })
  @IsNotEmpty({ message: 'Tên công ty không được để trống' })
  @Transform(({ value }) => value?.trim())
  name: string;

  @ApiProperty({ description: 'MST type ', example: '123456789' })
  @IsString({ message: 'Mã số thuế phải là chuỗi' })
  @IsNotEmpty({ message: 'Mã số thuế không được để trống' })
  @Transform(({ value }) => value?.trim())
  mst: string;

  @ApiProperty({
    description: 'Company logo',
    example: 'https://example.com/logo.png',
    required: true,
  })
  @IsString({ message: 'Logo phải là chuỗi' })
  @IsNotEmpty({ message: 'Logo không được để trống' })
  logo: string;

  @ApiProperty({ description: 'Organization type ID', example: 1 })
  @IsNumber({}, { message: 'Loại hình tổ chức phải là số' })
  @IsNotEmpty({ message: 'Loại hình tổ chức không được để trống' })
  @Type(() => Number)
  organizationType: number;

  @ApiProperty({
    description: 'Company approval status - true if waiting for admin approval',
    example: true,
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Trạng thái chờ duyệt phải là đúng/sai' })
  isWaiting?: boolean;

  @ApiProperty({
    description: 'Whether the company is featured on homepage',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Trạng thái nổi bật phải là đúng/sai' })
  isFeatured?: boolean;

  @ApiProperty({
    description: 'Facebook link',
    example: 'https://facebook.com/company',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsUrl({}, { message: 'Liên kết Facebook phải là URL hợp lệ' })
  facebookLink?: string;

  @ApiProperty({
    description: 'Twitter link',
    example: 'https://twitter.com/company',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsUrl({}, { message: 'Liên kết Twitter phải là URL hợp lệ' })
  twitterLink?: string;

  @ApiProperty({
    description: 'LinkedIn link',
    example: 'https://linkedin.com/company',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsUrl({}, { message: 'Liên kết LinkedIn phải là URL hợp lệ' })
  linkedInLink?: string;

  @ApiProperty({
    description: 'Instagram link',
    example: 'https://instagram.com/company',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsUrl({}, { message: 'Liên kết Instagram phải là URL hợp lệ' })
  instagramLink?: string;

  @ApiProperty({
    description: 'Company video URL',
    example: 'https://youtube.com/watch?v=...',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsUrl({}, { message: 'URL video phải hợp lệ' })
  videoUrl?: string;

  @ApiProperty({
    description: 'Company website',
    example: 'https://company.com',
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @Matches(/^https?:\/\/.+/i, {
    message: 'Website phải là URL hợp lệ bắt đầu bằng http:// hoặc https://',
  })
  website?: string;

  @ApiPropertyOptional({
    description: 'Detailed address',
    example: '123 Nguyen Van Linh, District 7',
  })
  @IsOptional()
  @IsString({ message: 'Địa chỉ phải là chuỗi' })
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === '' ? undefined : trimmed;
  })
  address?: string;

  @ApiPropertyOptional({
    description: 'Tax address',
    example: '123 Nguyen Van Linh, District 7',
  })
  @IsOptional()
  @IsString({ message: 'Địa chỉ thuế phải là chuỗi' })
  taxAddress?: string;

  @ApiProperty({ description: 'Company size', example: 100, required: false })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsInt({ message: 'Quy mô công ty phải là số nguyên' })
  @Min(0, { message: 'Quy mô công ty không được âm' })
  companySize?: number;

  @ApiProperty({ description: 'Founded year', example: 2010, required: false })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsInt({ message: 'Năm thành lập phải là số nguyên' })
  @Min(1800, { message: 'Năm thành lập phải từ 1800 trở lên' })
  @Max(2100, { message: 'Năm thành lập không được vượt quá 2100' })
  foundedYear?: number;

  @ApiProperty({
    description: 'Company description',
    example: 'Technology company specializing in...',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi' })
  description?: string;

  @ApiProperty({
    description: 'Company Insight',
    example: 'We value innovation and teamwork',
  })
  @IsOptional()
  @IsString({ message: 'Thông tin nổi bật phải là chuỗi' })
  insight?: string;

  @ApiProperty({
    description: 'Company Overview',
    example: 'Founded in 2010, we have ...',
  })
  @IsOptional()
  @IsString({ message: 'Tổng quan phải là chuỗi' })
  overview?: string;

  @ApiProperty({
    description: 'Company banner image URL',
    example: 'https://example.com/banner.jpg',
    required: false,
  })
  @IsOptional()
  @ValidateIf((o, value) => value != null && value !== '')
  @IsString({ message: 'Ảnh banner phải là chuỗi' })
  @Matches(/^(https?:\/\/.+|\/.+)$/i, { message: 'Ảnh banner phải là URL hợp lệ' })
  bannerImage?: string;

  @ApiPropertyOptional({
    description: 'List of company images',
    type: [CreateCompanyImageDto],
    example: [
      { url: 'https://example.com/image1.jpg' },
      { url: 'https://example.com/image2.jpg' },
    ],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanyImageDto)
  @Transform(({ value }) => {
    // Handle undefined, null, or non-array values
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) return []
    return value
  })
  companyImages?: CreateCompanyImageDto[];
}
