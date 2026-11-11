import { ApiProperty } from '@nestjs/swagger';

export class JobResponseDto {
  @ApiProperty({ description: 'Job ID' })
  id: number;

  @ApiProperty({ description: 'Job title' })
  title: string;

  @ApiProperty({
    description: 'Job categories as comma-separated string (e.g., "1,2,3")',
  })
  category: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
  })
  location: string;

  @ApiProperty({ description: 'Type of employment' })
  typeOfEmployment: string;

  @ApiProperty({ description: 'Experience level ID', required: false })
  experienceLevel: number | null;

  @ApiProperty({
    description:
      'Required qualifications as comma-separated string (e.g., "1,2,3")',
    required: false,
  })
  requiredQualification?: string | null;

  @ApiProperty({
    description:
      'Gender requirements as comma-separated string (e.g., "1,2,3")',
    required: false,
  })
  gender?: string | null;

  @ApiProperty({ description: 'Grade requirement', required: false })
  grade?: string | null;

  @ApiProperty({ description: 'Company ID' })
  companyId: number;

  @ApiProperty({ description: 'User ID' })
  userId: number;

  @ApiProperty({ description: 'Company name', required: false })
  companyName?: string;

  @ApiProperty({ description: 'Company logo', required: false })
  companyLogo?: string;

  @ApiProperty({ description: 'Company banner image', required: false })
  companyBannerImage?: string;

  @ApiProperty({ description: 'Created date' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated date' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Job status: ADMIN_REVIEW | APPROVED | REJECTED',
    example: 'APPROVED',
  })
  status: string;

  @ApiProperty({ description: 'Image logo' })
  imageLogo: string;

  @ApiProperty({ description: 'Banner logo' })
  bannerLogo: string;

  @ApiProperty({ description: 'Posted date' })
  postedDate: Date;

  @ApiProperty({ description: 'Application deadline' })
  deadline: Date;

  @ApiProperty({ description: 'Minimum salary', example: 1000 })
  salaryMin: number;

  @ApiProperty({ description: 'Maximum salary', example: 3000 })
  salaryMax: number;

  @ApiProperty({
    description: 'Salary type. Example: 1 = MONTH, 2 = WEEK, 3 = NEGOTIABLE',
    example: 1,
  })
  salaryType: number;

  @ApiProperty({
    description: 'Benefits as comma-separated string (e.g., "1,2,3")',
    required: false,
  })
  benefits: string;

  @ApiProperty({ description: 'Detailed description (HTML)' })
  detailDescription: string;

  @ApiProperty({
    description: 'Contact email for job application',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Contact phone number for job application',
    required: false,
  })
  phoneNumber?: string;

  @ApiProperty({ description: 'Job address' })
  address: string;

  @ApiProperty({
    description: 'Post type: Basic, Hot, Urgent',
    required: false,
  })
  postType?: string;

  @ApiProperty({
    description: 'Note: user or admin',
    required: false,
  })
  note?: string;

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
    this.userId = job.userId;
    this.companyName = job.company?.name || '';
    this.companyLogo = job.company?.logo || '';
    this.companyBannerImage = job.company?.bannerImage || '';
    this.createdAt = job.createdAt;
    this.updatedAt = job.updatedAt;
    this.status = job.status ?? 'ADMIN_REVIEW';
    this.imageLogo = job.imageLogo;
    this.bannerLogo = job.bannerLogo;
    this.postedDate = job.postedDate;
    this.deadline = job.deadline;
    this.salaryMin = job.salaryMin ?? 0;
    this.salaryMax = job.salaryMax ?? 0;
    this.salaryType = job.salaryType ?? 0;
    this.detailDescription = job.detailDescription ?? '';
    this.email = job.email;
    this.phoneNumber = job.phoneNumber;
    this.benefits = job.benefits || '';
    this.address = job.address || '';
    this.postType = job.postType ?? 'Basic';
    this.note = job.note ?? 'user';
  }
}
