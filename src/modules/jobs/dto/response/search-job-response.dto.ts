import { ApiProperty } from '@nestjs/swagger';

export class JobSearchResponseDto {
  @ApiProperty({ description: 'Job ID', example: 1 })
  id: number;

  @ApiProperty({ description: 'Job title', example: 'Backend Developer' })
  title: string;

  @ApiProperty({
    description: 'Job categories as comma-separated string (e.g., "1,2,3")',
    example: '1,2',
  })
  category: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
    example: '1,2',
  })
  location: string;

  @ApiProperty({ description: 'Type of employment', example: '1' })
  typeOfEmployment: string;

  @ApiProperty({
    description: 'Experience level ID',
    example: 3,
    required: false,
  })
  experienceLevel: number | null;

  @ApiProperty({
    description:
      'Required qualifications as comma-separated string (e.g., "1,2,3")',
    example: '1,2',
    required: false,
  })
  requiredQualification: string | null;

  @ApiProperty({
    description: 'Gender requirements as comma-separated string (e.g., "1,2,3")',
    required: false,
  })
  gender: string | null;

  @ApiProperty({
    description: 'Grade requirement ID',
    example: 1,
    required: false,
  })
  grade: number | null;

  @ApiProperty({ description: 'Company ID', example: 1 })
  companyId: number;

  @ApiProperty({ description: 'User ID', example: 1 })
  userId: number;

  @ApiProperty({ description: 'Job status: ADMIN_REVIEW | APPROVED | REJECTED' })
  status: string;

  @ApiProperty({ description: 'Application deadline', required: false })
  deadline?: Date | null;

  @ApiProperty({ description: 'Detailed description', required: false })
  detailDescription?: string | null;

  @ApiProperty({ description: 'Contact email', required: false })
  email?: string | null;

  @ApiProperty({ description: 'Contact phone number', required: false })
  phoneNumber?: string | null;

  @ApiProperty({ description: 'Job image logo URL', required: false })
  imageLogo?: string | null;

  @ApiProperty({ description: 'Job banner logo URL', required: false })
  bannerLogo?: string | null;

  @ApiProperty({ description: 'Company name', example: 'Tech Corp' })
  companyName: string;

  @ApiProperty({
    description: 'Company logo URL',
    example: 'https://example.com/logo.png',
  })
  companyLogo: string;

  @ApiProperty({
    description: 'Minimum salary',
    example: 1000,
    required: false,
  })
  salaryMin?: number;

  @ApiProperty({
    description: 'Maximum salary',
    example: 3000,
    required: false,
  })
  salaryMax?: number;

  @ApiProperty({ description: 'Salary type ID', example: 1, required: false })
  salaryType?: number;

  @ApiProperty({
    description: 'Benefit IDs',
    type: [Number],
    required: false,
    example: [1, 2, 3],
  })
  benefits?: string | null;

  @ApiProperty({
    description: 'Job address',
    example: '123 Main Street, District 1, Ho Chi Minh City',
  })
  address: string;

  @ApiProperty({
    description: 'Post type: Basic, Hot, Urgent',
    required: false,
  })
  postType?: string;

  @ApiProperty({ description: 'Posted date', required: false })
  postedDate?: Date;

  @ApiProperty({ description: 'Created date', required: false })
  createdAt?: Date;

  @ApiProperty({
    description: 'Note: user or admin',
    required: false,
  })
  note?: string;

  @ApiProperty({
    description: 'Total applications count (admin list)',
    required: false,
  })
  totalApplications?: number;

  constructor(job: any) {
    this.id = job.id;
    this.title = job.title;
    this.category = job.category;
    this.location = job.location;
    this.typeOfEmployment = job.typeOfEmployment;
    this.experienceLevel = job.experienceLevel ?? null;
    this.requiredQualification = job.requiredQualification ?? null;
    this.gender = job.gender ?? null;
    this.grade = job.grade ?? null;
    this.companyId = job.companyId;
    this.userId = job.userId;
    this.status = job.status ?? 'ADMIN_REVIEW';
    this.deadline = job.deadline ?? null;
    this.detailDescription = job.detailDescription ?? null;
    this.email = job.email ?? null;
    this.phoneNumber = job.phoneNumber ?? null;
    this.imageLogo = job.imageLogo ?? null;
    this.bannerLogo = job.bannerLogo ?? null;
    this.companyName = job.company?.name || '';
    this.companyLogo = job.company?.logo || '';
    this.salaryMin = job.salaryMin ?? null;
    this.salaryMax = job.salaryMax ?? null;
    this.salaryType = job.salaryType ?? null;
    this.benefits = job.benefits || null;
    this.address = job.address || '';
    this.postType = job.postType ?? 'Basic';
    this.postedDate = job.postedDate ?? null;
    this.createdAt = job.createdAt ?? null;
    this.note = job.note ?? 'user';
    this.totalApplications = job.totalApplications ?? 0;
  }
}
