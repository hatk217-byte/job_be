import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsNumber,
  IsEmail,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateJobDto {
  @ApiProperty({ description: 'Job title', example: 'Backend Developer' })
  @IsString({ message: 'Tiêu đề phải là chuỗi' })
  @IsNotEmpty({ message: 'Tiêu đề không được để trống' })
  @MaxLength(255, { message: 'Tiêu đề không được vượt quá 255 ký tự' })
  @Transform(({ value }) => value?.trim())
  title: string;

  @ApiProperty({
    description: 'Job categories as comma-separated string (e.g., "1,2,3")',
  })
  @IsString({ message: 'Danh mục phải là chuỗi' })
  category: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
  })
  @IsString({ message: 'Địa điểm phải là chuỗi' })
  location: string;

  @ApiProperty({ description: 'Type of employment as comma-separated string (e.g., "1,2")', example: '1' })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map(String).join(',');
    return String(value ?? '').trim();
  })
  @IsNotEmpty({ message: 'Hình thức làm việc không được để trống' })
  typeOfEmployment: string;

  @ApiProperty({ description: 'Experience level required', example: 1 })
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Kinh nghiệm phải là số' })
  @IsNotEmpty({ message: 'Kinh nghiệm không được để trống' })
  experienceLevel: number;

  @ApiProperty({
    description:
      'Required qualifications as comma-separated string (e.g., "1,2,3")',
  })
  @IsString({ message: 'Bằng cấp yêu cầu phải là chuỗi' })
  @IsNotEmpty({ message: 'Bằng cấp yêu cầu không được để trống' })
  requiredQualification: string;

  @ApiProperty({
    description:
      'Gender requirements as comma-separated string (e.g., "1,2,3")',
  })
  @IsString({ message: 'Giới tính phải là chuỗi' })
  @IsNotEmpty({ message: 'Giới tính không được để trống' })
  gender: string;

  @ApiProperty({ description: 'Grade requirement', example: 1 })
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Cấp bậc phải là số' })
  @IsNotEmpty({ message: 'Cấp bậc không được để trống' })
  grade: number;

  @ApiProperty({ description: 'Company ID', required: true })
  @IsOptional()
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Mã công ty phải là số' })
  companyId?: number;

  @ApiProperty({ description: 'User ID', required: true })
  @IsOptional()
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Mã người dùng phải là số' })
  userId?: number;

  @ApiProperty({ description: 'Image logo', required: false })
  @IsOptional()
  @IsString({ message: 'Logo ảnh phải là chuỗi' })
  imageLogo?: string;

  @ApiProperty({ description: 'Banner logo', required: false })
  @IsOptional()
  @IsString({ message: 'Banner phải là chuỗi' })
  bannerLogo?: string;

  @ApiProperty({ description: 'Posted date', required: false })
  @IsOptional()
  @IsDateString({}, { message: 'Ngày đăng phải là ngày hợp lệ' })
  postedDate?: Date;

  @ApiProperty({ description: 'Application deadline' })
  @IsDateString({}, { message: 'Hạn nộp phải là ngày hợp lệ' })
  @IsNotEmpty({ message: 'Hạn nộp không được để trống' })
  deadline: Date;

  @ApiProperty({ description: 'Salary Min', required: false })
  @ValidateIf((o) => o.salaryType !== 5)
  @IsOptional()
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Lương tối thiểu phải là số' })
  @Min(0, { message: 'Lương tối thiểu không được âm' })
  salaryMin?: number;

  @ApiProperty({ description: 'Salary Max', required: false })
  @ValidateIf((o) => o.salaryType !== 5)
  @IsOptional()
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Lương tối đa phải là số' })
  @Min(0, { message: 'Lương tối đa không được âm' })
  salaryMax?: number;

  @ApiProperty({ description: 'Salary Type' })
  @Transform(({ value }) => (value !== null ? Number(value) : value))
  @IsNumber({}, { message: 'Loại lương phải là số' })
  @IsNotEmpty({ message: 'Loại lương không được để trống' })
  salaryType: number;

  @ApiProperty({
    description: 'Benefits as comma-separated string (e.g., "1,2,3")',
  })
  @IsString({ message: 'Phúc lợi phải là chuỗi' })
  @IsNotEmpty({ message: 'Phúc lợi không được để trống' })
  benefits: string;

  @ApiProperty({
    description: 'Mô tả chi tiết công việc (HTML)',
    example: '<p>Mô tả công việc...</p>',
  })
  @IsString({ message: 'Mô tả chi tiết phải là chuỗi' })
  @IsNotEmpty({ message: 'Mô tả chi tiết không được để trống' })
  detailDescription: string;

  @ApiProperty({
    description: 'Job status: ADMIN_REVIEW | APPROVED | REJECTED',
    example: 'ADMIN_REVIEW',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  @Transform(({ value }) => value?.trim() || undefined)
  status?: string;

  @ApiProperty({
    description: 'Post type: Basic, Hot, Urgent',
    example: 'Basic',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Loại tin phải là chuỗi' })
  @Transform(({ value }) => value?.trim())
  postType?: string;

  @ApiProperty({
    description: 'Note: user or admin',
    example: 'user',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi' })
  @Transform(({ value }) => value?.trim())
  note?: string;

  @ApiProperty({
    description: 'Contact email for job application',
    required: false,
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @Transform(({ value }) => value?.trim() || undefined)
  email?: string;

  @ApiProperty({
    description: 'Contact phone number for job application',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  @Transform(({ value }) => value?.trim() || undefined)
  phoneNumber?: string;

  @ApiProperty({
    description: 'Job address',
    example: '123 Main Street, District 1, Ho Chi Minh City',
  })
  @IsString({ message: 'Địa chỉ phải là chuỗi' })
  @IsNotEmpty({ message: 'Địa chỉ không được để trống' })
  @Transform(({ value }) => value?.trim())
  address: string;
}
