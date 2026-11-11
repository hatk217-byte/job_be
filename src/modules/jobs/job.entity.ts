import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';

@Entity('jobs')
export class Job {
  @ApiProperty({ description: 'Job ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ description: 'Job title' })
  @Column()
  title: string;

  @ApiProperty({
    description: 'Job categories as comma-separated string (e.g., "1,2,3")',
  })
  @Column()
  category: string;

  @ApiProperty({
    description: 'Job locations as comma-separated string (e.g., "1,2,3")',
  })
  @Column()
  location: string;

  @ApiProperty({ description: 'Type of employment as comma-separated string (e.g., "1,2")' })
  @Column({ type: 'varchar', length: 255, default: '1' })
  typeOfEmployment: string;

  @ApiProperty({ description: 'Experience level required' })
  @Column({ nullable: true })
  experienceLevel: number;

  @ApiProperty({
    description:
      'Required qualifications as comma-separated string (e.g., "1,2,3")',
  })
  @Column({ nullable: true })
  requiredQualification: string;

  @ApiProperty({
    description:
      'Gender requirements as comma-separated string (e.g., "1,2,3")',
  })
  @Column({ nullable: true })
  gender: string;

  @ApiProperty({ description: 'Grade requirement as comma-separated string (e.g., "1,2")' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  grade: string;

  @ApiProperty({ description: 'User ID' })
  @Column({ nullable: true })
  userId: number;

  @ManyToOne(() => User, (user) => user.jobs)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ description: 'Company ID' })
  @Column({ nullable: true })
  companyId: number;

  @ManyToOne(() => Company, (company) => company.jobs)
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @ApiProperty({ description: 'Created date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Updated date' })
  @UpdateDateColumn()
  updatedAt: Date;

  @ApiProperty({
    description: 'Job status: ADMIN_REVIEW | APPROVED | REJECTED. Chỉ hiển thị khi APPROVED.',
  })
  @Column({ type: 'varchar', length: 20, nullable: true, default: 'ADMIN_REVIEW' })
  status: string;

  @ApiProperty({ description: 'Image logo (default if not provided)' })
  @Column({ nullable: true })
  imageLogo: string;

  @ApiProperty({ description: 'Banner logo (default if not provided)' })
  @Column({ nullable: true })
  bannerLogo: string;

  @ApiProperty({ description: 'Posted date' })
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  postedDate: Date;

  @ApiProperty({ description: 'Application deadline' })
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  deadline: Date;

  @ApiProperty({ description: 'Salary Min' })
  @Column({ nullable: false })
  salaryMin: number;

  @ApiProperty({ description: 'Salary Max' })
  @Column({ nullable: false })
  salaryMax: number;

  @ApiProperty({
    description: 'Salary Type . Example : MONTH , WEEK , NEGOTIABLE ',
  })
  @Column({ nullable: false })
  salaryType: number;

  @ApiProperty({ description: 'Mô tả chi tiết công việc (HTML)' })
  @Column({ type: 'text', nullable: false })
  detailDescription: string;

  @ApiProperty({ description: 'Contact email for job application' })
  @Column({ nullable: true })
  email: string;

  @ApiProperty({ description: 'Contact phone number for job application' })
  @Column({ nullable: true })
  phoneNumber: string;

  @ApiProperty({
    description: 'Benefits as comma-separated string (e.g., "1,2,3")',
  })
  @Column({ nullable: true })
  benefits: string;

  @ApiProperty({ description: 'Job address' })
  @Column({ type: 'text' })
  address: string;

  @ApiProperty({
    description: 'Post type: Basic, Hot, Urgent',
    default: 'Basic',
  })
  @Column({ type: 'varchar', length: 20, nullable: true, default: 'Basic' })
  postType: string;

  @ApiProperty({
    description: 'Note: user or admin',
    default: 'user',
  })
  @Column({ type: 'varchar', length: 20, nullable: true, default: 'user' })
  note: string;
}
