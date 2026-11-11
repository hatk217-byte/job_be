// dto/company-job-summary.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Job } from '@/modules/jobs/job.entity';

export class CompanyJobSummaryDto {
  @ApiProperty({ description: 'Job ID' })
  id: number;

  @ApiProperty({ description: 'Job title' })
  title: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
  })
  location: string;

  @ApiProperty({ description: 'Type of employment' })
  typeOfEmployment: string;

  @ApiProperty({ description: 'Job image logo', nullable: true })
  imageLogo: string | null;

  @ApiProperty({ description: 'Posted date' })
  postedDate: Date;

  @ApiProperty({ description: 'Salary Min', nullable: true })
  salaryMin: number;

  @ApiProperty({ description: 'Salary Max', nullable: true })
  salaryMax: number;

  @ApiProperty({ description: 'Salary Type', nullable: true })
  salaryType: number;

  @ApiProperty({ description: 'Experience level required', nullable: true })
  experienceLevel: number | null;

  constructor(job: Job) {
    this.id = job.id;
    this.title = job.title;
    this.location = job.location;
    this.typeOfEmployment = job.typeOfEmployment;
    this.imageLogo = job.imageLogo;
    this.postedDate = job.postedDate;
    this.salaryMin = job.salaryMin;
    this.salaryMax = job.salaryMax;
    this.salaryType = job.salaryType;
    this.experienceLevel = job.experienceLevel ?? null;
  }
}
