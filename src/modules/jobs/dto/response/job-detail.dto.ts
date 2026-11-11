import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDate,
  IsNumber,
  IsUrl,
  IsArray,
} from 'class-validator';

export class JobDetailDto {
  @ApiProperty({ description: 'Job ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ description: 'Job title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Job categories as comma-separated string (e.g., "1,2,3")',
  })
  @IsString()
  category: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
  })
  @IsString()
  location: string;

  @ApiProperty({ description: 'Type of employment' })
  @IsString()
  typeOfEmployment: string;

  @ApiProperty({ description: 'Experience level ID', required: false })
  @IsOptional()
  @IsNumber()
  experienceLevel: number | null;

  @ApiProperty({
    description:
      'Required qualifications as comma-separated string (e.g., "1,2,3")',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  requiredQualification: string | null;

  @ApiProperty({
    description:
      'Gender requirements as comma-separated string (e.g., "1,2,3")',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  gender: string | null;

  @ApiProperty({ description: 'Grade requirement', nullable: true })
  @IsOptional()
  @IsString()
  grade: string | null;

  @ApiProperty({ description: 'Company Id' })
  @IsNumber()
  companyId: number;

  @ApiProperty({ description: 'Company name' })
  @IsString()
  companyName: string;

  @ApiProperty({ description: 'Company logo' })
  @IsString()
  companyLogo: string;

  @ApiProperty({ description: 'Company banner image', nullable: true })
  @IsOptional()
  @IsString()
  companyBannerImage: string | null;

  @ApiProperty({ description: 'Organization type ID', nullable: true })
  @IsOptional()
  @IsNumber()
  organizationType: number | null;

  @ApiProperty({ description: 'Founded year', nullable: true })
  @IsOptional()
  @IsNumber()
  foundedYear: number | null;

  @ApiProperty({ description: 'Company website', nullable: true })
  @IsOptional()
  @IsUrl()
  website: string | null;

  @ApiProperty({ description: 'Facebook link', nullable: true })
  @IsOptional()
  @IsUrl()
  facebookLink: string | null;

  @ApiProperty({ description: 'Instagram link', nullable: true })
  @IsOptional()
  @IsUrl()
  instagramLink: string | null;

  @ApiProperty({ description: 'Twitter link', nullable: true })
  @IsOptional()
  @IsUrl()
  twitterLink: string | null;

  @ApiProperty({ description: 'LinkedIn link', nullable: true })
  @IsOptional()
  @IsUrl()
  linkedInLink: string | null;

  @ApiProperty({
    description: 'Image logo (default if not provided)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  imageLogo: string | null;

  @ApiProperty({
    description: 'Banner logo (default if not provided)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  bannerLogo: string | null;

  @ApiProperty({ description: 'Created date' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated date' })
  updatedAt: Date;

  @ApiProperty({ description: 'Posted date' })
  @IsDate()
  postedDate: Date;

  @ApiProperty({ description: 'Application deadline', nullable: true })
  @IsOptional()
  @IsDate()
  deadline: Date | null;

  @ApiProperty({ description: 'Salary Min' })
  @IsOptional()
  @IsNumber()
  salaryMin: number;

  @ApiProperty({ description: 'Salary Max' })
  @IsOptional()
  @IsNumber()
  salaryMax: number;

  @ApiProperty({
    description: 'Salary Type. Example: 1 = MONTH, 2 = WEEK, 3 = NEGOTIABLE',
  })
  @IsOptional()
  @IsNumber()
  salaryType: number;

  @ApiProperty({
    description: 'Benefits as comma-separated string (e.g., "1,2,3")',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Phúc lợi phải là chuỗi' })
  benefits: string;

  @ApiProperty({ description: 'Mô tả chi tiết công việc (HTML)' })
  @IsString()
  @IsNotEmpty()
  detailDescription: string;

  @ApiProperty({
    description: 'Contact email for job application',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  email: string | null;

  @ApiProperty({
    description: 'Contact phone number for job application',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  phoneNumber: string | null;

  @ApiProperty({ description: 'Company address' })
  @IsOptional()
  @IsString()
  address: string;

  @ApiProperty({ description: 'Job address' })
  @IsOptional()
  @IsString()
  jobAddress: string | null;

  @ApiProperty({
    description: 'Job status: ADMIN_REVIEW | APPROVED | REJECTED',
    example: 'APPROVED',
  })
  @IsString()
  status: string;

  constructor(job: any) {
    this.id = job.id;
    this.title = job.title;
    this.category = job.category;
    this.location = job.location;
    this.typeOfEmployment = job.typeOfEmployment;
    this.experienceLevel = job.experienceLevel ?? null;
    this.requiredQualification = job.requiredQualification || null;
    this.gender = job.gender || null;
    this.grade = job.grade ? String(job.grade) : null;
    this.companyId = job.companyId;
    this.companyName = job.company?.name || '';
    this.companyLogo = job.company?.logo || '';
    this.companyBannerImage = job.company?.bannerImage || null;
    this.organizationType = job.company?.organizationType || null;
    this.foundedYear = job.company?.foundedYear || null;
    this.address = job.company?.address || null;
    this.website = job.company?.website || null;
    this.facebookLink = job.company?.facebookLink || null;
    this.instagramLink = job.company?.instagramLink || null;
    this.twitterLink = job.company?.twitterLink || null;
    this.linkedInLink = job.company?.linkedInLink || null;
    this.imageLogo = job.imageLogo;
    this.bannerLogo = job.bannerLogo;
    this.createdAt = job.createdAt;
    this.updatedAt = job.updatedAt;
    this.postedDate = job.postedDate;
    this.deadline = job.deadline;
    this.salaryMin = job.salaryMin;
    this.salaryMax = job.salaryMax;
    this.salaryType = job.salaryType;
    this.benefits = job.benefits || '';
    this.detailDescription = job.detailDescription ?? '';
    this.email = job.email || null;
    this.phoneNumber = job.phoneNumber || null;
    // Address is already set from company at line 199
    this.jobAddress = job.address || null;
    this.status = job.status ?? 'APPROVED';
  }
}
