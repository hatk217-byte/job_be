import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RoleStatus } from '@/enum/role';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Job } from './job.entity';
import { SearchJobDto } from './dto/request/search-job-request.dto';
import { JobDetailDto } from './dto/response/job-detail.dto';
import { CategoryStatsDto } from './dto/response/category-stats.dto';
import { LocationStatsDto } from './dto/response/location-stats.dto';
import { JobSearchResponseDto } from './dto/response/search-job-response.dto';
import {
  ALL_CATEGORIES,
  ALL_LOCATIONS,
  MAJOR_CITIES,
  MAJOR_CITIES_IMG,
} from '../constants';
import { CreateJobDto } from './dto/request/create-job.dto';
import { JobResponseDto } from './dto/response/job-response.dto';
import { Company } from '../companies/company.entity';
import { SearchJobAdminDto } from './dto/request/search-job-request-admin.dto';
import { JobApplication } from './job-application.entity';
import { CreateJobApplicationDto } from './dto/create-job-application.dto';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { EmailService } from '../email/email.service';
import { User } from '../users/user.entity';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import {
  APPLICATION_STATUS_LABELS,
  ApplicationStatus,
} from '@/enum/application-status';

function normalizeJobStatus(status?: string | null, fallback = 'ADMIN_REVIEW'): string {
  const s = (status?.trim() || fallback).toUpperCase();
  if (s === 'PENDING') return 'ADMIN_REVIEW';
  const valid = ['ADMIN_REVIEW', 'APPROVED', 'REJECTED'];
  return valid.includes(s) ? s : fallback;
}

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(Company)
    private companiesRepository: Repository<Company>,
    @InjectRepository(JobApplication)
    private jobApplicationRepository: Repository<JobApplication>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private usersService: UsersService,
    private uploadService: UploadService,
    private emailService: EmailService,
  ) {}

  /** Job chỉ hiển thị khi status = APPROVED */
  private static readonly JOB_VISIBLE_CONDITION = "job.status = 'APPROVED'";

  /** Chỉ match tiêu đề / tên công ty — tránh false positive từ mô tả HTML. */
  private static applyJobKeywordSearch(
    qb: SelectQueryBuilder<Job>,
    keyword?: string,
  ): boolean {
    const trimmed = keyword?.trim();
    if (!trimmed) {
      return false;
    }

    const kw = `%${trimmed}%`;
    const kwStart = `${trimmed}%`;

    qb.andWhere(
      '(LOWER(job.title) LIKE LOWER(:kw) OR LOWER(company.name) LIKE LOWER(:kw))',
      { kw, kwStart },
    );

    return true;
  }

  private static applyJobKeywordOrdering(
    qb: SelectQueryBuilder<Job>,
    hasKeyword: boolean,
  ): void {
    if (hasKeyword) {
      qb.addOrderBy(
        `CASE
          WHEN LOWER(job.title) LIKE LOWER(:kwStart) THEN 0
          WHEN LOWER(job.title) LIKE LOWER(:kw) THEN 1
          WHEN LOWER(company.name) LIKE LOWER(:kw) THEN 2
          ELSE 3
        END`,
        'ASC',
      );
    }

    qb.addOrderBy('job.postedDate', 'DESC');
  }

  /** Lọc field lưu dạng ID phân tách bằng dấu phẩy (category, location). */
  private static applyCommaSeparatedIdFilter(
    qb: SelectQueryBuilder<Job>,
    column: string,
    ids: number[] | undefined,
    allValue: number,
    paramPrefix: string,
  ): void {
    if (!ids?.length) return;

    const filtered = ids.filter((id) => id !== allValue);
    if (!filtered.length) return;

    const conditions: string[] = [];
    const params: Record<string, string> = {};

    filtered.forEach((id, i) => {
      const p = `${paramPrefix}${i}`;
      conditions.push(
        `(${column} = :${p} OR ${column} LIKE :${p}Start OR ${column} LIKE :${p}Middle OR ${column} LIKE :${p}End)`,
      );
      params[p] = String(id);
      params[`${p}Start`] = `${id},%`;
      params[`${p}Middle`] = `%,${id},%`;
      params[`${p}End`] = `%,${id}`;
    });

    qb.andWhere(`(${conditions.join(' OR ')})`, params);
  }

  async create(data: CreateJobDto, user?: any): Promise<JobResponseDto> {
    await this.validateJobData(data, false);
    await this.ensureCompanyExists(data.companyId);

    // Authorization check for job creation
    // ADMIN can create job for any company
    // COMPANY can only create job for their own company (must be host)
    const isAdmin = user?.role === RoleStatus.ADMIN;
    const isHostCompany =
      user?.role === RoleStatus.COMPANY &&
      user?.companyId === data.companyId;

    if (!isAdmin && !isHostCompany) {
      throw new UnauthorizedException(
        'Bạn không có quyền tạo tin tuyển dụng cho công ty này',
      );
    }

    const jobStatus = normalizeJobStatus(data.status);
    data.status = jobStatus;
    data.userId = data.userId;
    data.detailDescription = (data.detailDescription ?? '').trim();
    const savedJob = await this.jobsRepository.save(
      this.jobsRepository.create(data),
    );

    if (jobStatus === 'ADMIN_REVIEW') {
      this.notifyAdminsJobPending(savedJob.id).catch((e) =>
        console.error('Failed to send job pending admin email:', e),
      );
      this.notifyEmployerJobPendingForJob(savedJob.id).catch((e) =>
        console.error('Failed to send job pending employer email:', e),
      );
    }

    return this.buildJobResponse(savedJob.id);
  }

  async update(id: number, data: CreateJobDto, user?: any): Promise<JobResponseDto> {
    const job = await this.findJobOrThrow(id);
    const urlsToDelete: string[] = [];

    const maybeQueueReplace = (prev: string | null | undefined, next: any) => {
      if (!prev) return;
      if (next === undefined) return;
      const nextVal = next == null || String(next).trim() === '' ? null : String(next).trim();
      if (nextVal !== prev) urlsToDelete.push(prev);
    };

    maybeQueueReplace(job.imageLogo, (data as any).imageLogo);
    maybeQueueReplace(job.bannerLogo, (data as any).bannerLogo);

    // Authorization check for job update
    // ADMIN can update any job
    // COMPANY can only update job of their own company (must be host)
    const isAdmin = user?.role === RoleStatus.ADMIN;
    const isHostCompany =
      user?.role === RoleStatus.COMPANY &&
      user?.companyId === job.companyId;

    if (!isAdmin && !isHostCompany) {
      throw new UnauthorizedException(
        'Bạn không có quyền chỉnh sửa tin tuyển dụng này',
      );
    }

    if (data.companyId !== undefined) {
      await this.ensureCompanyExists(data.companyId);
    }

    // For update, preserve existing values if not provided
    if (data.salaryMin === undefined || data.salaryMin === null) {
      data.salaryMin = job.salaryMin;
    }
    if (data.salaryMax === undefined || data.salaryMax === null) {
      data.salaryMax = job.salaryMax;
    }
    if (data.salaryType === undefined || data.salaryType === null) {
      data.salaryType = job.salaryType;
    }

    await this.validateJobData(data, true);

    const previousStatus = job.status;

    if (data.status !== undefined && data.status !== null) {
      (data as any).status = normalizeJobStatus(
        String(data.status),
        job.status || 'ADMIN_REVIEW',
      );
    }
    // note không đổi khi update — chỉ dùng để biết admin add hay user add lúc tạo
    (data as any).note = job.note ?? 'user';
    if (data.detailDescription !== undefined) {
      data.detailDescription = (data.detailDescription ?? '').trim();
    }
    await this.jobsRepository.save({ ...job, ...data });

    if (urlsToDelete.length > 0) {
      this.uploadService.deleteBatch(urlsToDelete).catch((e) => console.error('R2 delete (job update) failed:', e));
    }

    const newStatus = (data as any).status ?? job.status;
    if (newStatus === 'APPROVED' && previousStatus !== 'APPROVED') {
      this.notifyJobApproved(id).catch((e) =>
        console.error('Failed to send job approved email:', e),
      );
    }
    if (newStatus === 'REJECTED' && previousStatus !== 'REJECTED') {
      this.notifyJobRejected(id).catch((e) =>
        console.error('Failed to send job rejected email:', e),
      );
    }

    return this.buildJobResponse(id);
  }

  async findAll(): Promise<JobResponseDto[]> {
    const jobs = await this.jobsRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.company', 'company')
      .where(JobsService.JOB_VISIBLE_CONDITION)
      .andWhere('company.isWaiting = :companyWaiting', { companyWaiting: false })
      .getMany();
    return jobs.map((job) => new JobResponseDto(job));
  }

  async searchJobs(dto: SearchJobDto): Promise<JobSearchResponseDto[]> {
    const qb = this.jobsRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.company', 'company')
      .where('company.isWaiting = :companyWaiting', { companyWaiting: false });

    const hasKeyword = JobsService.applyJobKeywordSearch(qb, dto.keyword);

    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.category',
      dto.category,
      ALL_CATEGORIES,
      'c',
    );

    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.location',
      dto.location,
      ALL_LOCATIONS,
      'l',
    );

    // typeOfEmployment (array / comma-separated string)
    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.typeOfEmployment',
      dto.typeOfEmployment,
      0,
      'toe',
    );

    // experienceLevel (array)
    if (dto.experienceLevel?.length > 0) {
      qb.andWhere('job.experienceLevel IN (:...exp)', {
        exp: dto.experienceLevel,
      });
    }

    // grade (array / comma-separated string)
    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.grade',
      dto.grade,
      0,
      'gr',
    );

    // companyId
    if (dto.companyId !== undefined && dto.companyId !== null) {
      qb.andWhere('job.companyId = :cid', { cid: dto.companyId });
    }

    // email - filter by contact email
    if (dto.email?.trim()) {
      qb.andWhere('job.email = :email', { email: dto.email.trim() });
    }

    // Viewer: CHỈ thấy job đã duyệt (status = APPROVED hoặc legacy)
    qb.andWhere(JobsService.JOB_VISIBLE_CONDITION);

    JobsService.applyJobKeywordOrdering(qb, hasKeyword);

    const jobs = await qb.getMany();

    return jobs.map((job) => new JobSearchResponseDto(job));
  }

  async getJobDetail(jobId: number): Promise<JobDetailDto> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job || job.status !== 'APPROVED') {
      throw new NotFoundException('Không tìm thấy tin tuyển dụng');
    }
    if (job.company && job.company.isWaiting) {
      throw new NotFoundException('Không tìm thấy tin tuyển dụng');
    }
    return new JobDetailDto(job);
  }

  async getJobsByUserId(userId: number): Promise<JobResponseDto[]> {
    const jobs = await this.jobsRepository.find({
      where: { userId: userId },
      relations: ['company'],
    });

    return jobs.map((job) => new JobResponseDto(job));
  }

  async getJobsByEmail(email: string): Promise<JobResponseDto[]> {
    const jobs = await this.jobsRepository.find({
      where: { email: email },
      relations: ['company'],
      order: { postedDate: 'DESC' },
    });

    return jobs.map((job) => new JobResponseDto(job));
  }

  async getCategoriesWithJobCount(): Promise<CategoryStatsDto[]> {
    const jobs = await this.jobsRepository
      .createQueryBuilder('job')
      .leftJoin('job.company', 'company')
      .where(JobsService.JOB_VISIBLE_CONDITION)
      .andWhere('company.isWaiting = :companyWaiting', { companyWaiting: false })
      .getMany();

    // Count jobs per category
    const categoryCountMap = new Map<string, number>();

    // Process each job's category string
    jobs.forEach((job) => {
      if (job.category) {
        // Split comma-separated string into individual categories
        const categories = job.category
          .split(',')
          .map((cat) => cat.trim())
          .filter((cat) => cat !== '');

        // Count each category
        categories.forEach((category) => {
          const currentCount = categoryCountMap.get(category) || 0;
          categoryCountMap.set(category, currentCount + 1);
        });
      }
    });

    // Convert map to array and sort by count descending
    const result = Array.from(categoryCountMap.entries())
      .map(([category, jobCount]) => ({
        category,
        jobCount,
      }))
      .sort((a, b) => b.jobCount - a.jobCount);

    return result.map(
      (item) => new CategoryStatsDto(item.category, item.jobCount),
    );
  }

  async getLocationsWithJobCount(): Promise<LocationStatsDto[]> {
    const cities = MAJOR_CITIES;
    const cityImages = MAJOR_CITIES_IMG;

    const jobs = await this.jobsRepository
      .createQueryBuilder('job')
      .leftJoin('job.company', 'company')
      .where(JobsService.JOB_VISIBLE_CONDITION)
      .andWhere('company.isWaiting = :companyWaiting', { companyWaiting: false })
      .getMany();

    // Count jobs per individual location from comma-separated strings
    const locationMap = new Map<number, number>();

    jobs.forEach((job) => {
      if (job.location) {
        const locations = job.location
          .split(',')
          .map((l) => l.trim())
          .filter((l) => l);

        locations.forEach((loc) => {
          const locNum = Number(loc);

          if (!isNaN(locNum)) {
            locationMap.set(locNum, (locationMap.get(locNum) || 0) + 1);
          }
        });
      }
    });

    const response: LocationStatsDto[] = [];

    cities.forEach((city, index) => {
      const jobCount = locationMap.get(Number(city)) || 0;
      const image = cityImages[index] || null;

      response.push(
        new LocationStatsDto({
          location: city,
          jobCount: jobCount,
          isMajorCity: true,
          image: image,
        }),
      );
    });

    return response;
  }

  async delete(id: number): Promise<void> {
    const job = await this.jobsRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} Không tìm thấy`);
    }

    const urlsToDelete = [job.imageLogo, job.bannerLogo].filter(Boolean) as string[];
    if (urlsToDelete.length > 0) {
      this.uploadService.deleteBatch(urlsToDelete).catch((e) => console.error('R2 delete (job delete) failed:', e));
    }
    await this.jobsRepository.delete(id);
  }

  async listForAdmin(
    dto: SearchJobAdminDto,
    user?: any,
  ): Promise<JobSearchResponseDto[]> {
    // Authorization check for COMPANY role
    if (user?.role === RoleStatus.COMPANY) {
      // Only host company can access
      if (!user?.isHostCompany) {
        throw new UnauthorizedException(
          'Bạn không có quyền truy cập danh sách tin tuyển dụng',
        );
      }
      // Host can only see jobs of their own company
      if (user?.companyId) {
        dto.companyId = user.companyId;
      }
    }

    const qb = this.jobsRepository
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.company', 'company');

    const hasKeyword = JobsService.applyJobKeywordSearch(qb, dto.keyword);

    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.category',
      dto.category,
      ALL_CATEGORIES,
      'c',
    );

    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.location',
      dto.location,
      ALL_LOCATIONS,
      'l',
    );

    // typeOfEmployment (array / comma-separated string)
    JobsService.applyCommaSeparatedIdFilter(
      qb,
      'job.typeOfEmployment',
      dto.typeOfEmployment,
      0,
      'toe',
    );

    // experienceLevel (array)
    if (dto.experienceLevel?.length > 0) {
      qb.andWhere('job.experienceLevel IN (:...exp)', {
        exp: dto.experienceLevel,
      });
    }

    // companyId
    if (dto.companyId !== undefined && dto.companyId !== null) {
      qb.andWhere('job.companyId = :cid', { cid: dto.companyId });
    }

    if (dto.status?.trim()) {
      qb.andWhere('job.status = :status', { status: dto.status.trim().toUpperCase() });
    }

    // (Tuỳ chọn) nếu SearchJobAdminDto có thêm userId:
    // if (dto.userId) { qb.andWhere('job.userId = :uid', { uid: dto.userId }); }

    JobsService.applyJobKeywordOrdering(qb, hasKeyword);

    const jobs = await qb.getMany();
    const jobIds = jobs.map((j) => j.id);

    // Count applications per job (chưa xóa: delF = false)
    const countMap = new Map<number, number>();
    if (jobIds.length > 0) {
      const counts = await this.jobApplicationRepository
        .createQueryBuilder('a')
        .select('a.jobId', 'jobId')
        .addSelect('COUNT(a.id)', 'cnt')
        .where('a.jobId IN (:...ids)', { ids: jobIds })
        .andWhere('a.delF = :delF', { delF: false })
        .groupBy('a.jobId')
        .getRawMany();
      counts.forEach((row: { jobId: number; cnt: string }) => {
        countMap.set(Number(row.jobId), parseInt(row.cnt, 10) || 0);
      });
    }

    return jobs.map((job) => {
      const totalApplications = countMap.get(job.id) ?? 0;
      return new JobSearchResponseDto({ ...job, totalApplications });
    });
  }

  async approve(id: number, user: any): Promise<JobResponseDto> {
    const job = await this.jobsRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException('Không tìm thấy tin tuyển dụng');
    }
    if (job.status === 'APPROVED') {
      throw new BadRequestException('Tin tuyển dụng đã được duyệt');
    }

    // Authorization check: only admin or host company of this job can approve
    const isAdmin = user.role === RoleStatus.ADMIN;
    const isHostOfCompany = user.isHostCompany === true && user.companyId === job.companyId;

    if (!isAdmin && !isHostOfCompany) {
      throw new ForbiddenException('Bạn không có quyền duyệt tin đăng này');
    }

    job.status = 'APPROVED';
    const updated = await this.jobsRepository.save(job);

    this.notifyJobApproved(updated.id).catch((e) =>
      console.error('Failed to send job approved email:', e),
    );

    return this.buildJobResponse(updated.id);
  }

  /* ================= Helper Methods ================= */

  private async ensureCompanyExists(companyId: number): Promise<void> {
    const exists = await this.companiesRepository.exists({
      where: { id: companyId },
    });
    if (!exists) {
      throw new NotFoundException(`Company with ID ${companyId} Không tìm thấy`);
    }
  }

  private async findJobOrThrow(id: number): Promise<Job> {
    const job = await this.jobsRepository.findOne({
      where: { id },
      relations: ['company'],
    });
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} Không tìm thấy`);
    }
    return job;
  }

  private async buildJobResponse(jobId: number): Promise<JobResponseDto> {
    const jobWithRelations = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });

    if (!jobWithRelations) {
      throw new NotFoundException(`Job with ID ${jobId} Không tìm thấy`);
    }

    return new JobResponseDto(jobWithRelations);
  }

  private async validateJobData(
    jobData: CreateJobDto,
    isUpdate: boolean = false,
  ) {
    if (!jobData.postedDate) {
      jobData.postedDate = new Date();
    } else {
      jobData.postedDate = new Date(jobData.postedDate);
    }

    jobData.deadline = new Date(jobData.deadline);

    // Validate salary fields based on salaryType
    // salaryType = 5 means "Thỏa thuận" (Negotiable), so salaryMin/Max are optional
    if (jobData.salaryType !== 5) {
      // If salaryType is not "Negotiable", salaryMin and salaryMax are required
      if (jobData.salaryMin === undefined || jobData.salaryMin === null) {
        throw new BadRequestException(
          'Lương tối thiểu là bắt buộc khi loại lương không phải thỏa thuận',
        );
      }
      if (jobData.salaryMax === undefined || jobData.salaryMax === null) {
        throw new BadRequestException(
          'Lương tối đa là bắt buộc khi loại lương không phải thỏa thuận',
        );
      }

      if (jobData.salaryMin < 0 || jobData.salaryMax < 0) {
        throw new BadRequestException('Mức lương không được âm');
      }

      if (jobData.salaryMin > jobData.salaryMax) {
        throw new BadRequestException(
          'Lương tối thiểu không được lớn hơn lương tối đa',
        );
      }
    } else {
      // For "Negotiable" (salaryType = 5), salaryMin/Max are optional
      // Set default values to 0 if not provided (since DB doesn't allow null)
      if (jobData.salaryMin === undefined || jobData.salaryMin === null) {
        jobData.salaryMin = 0;
      }
      if (jobData.salaryMax === undefined || jobData.salaryMax === null) {
        jobData.salaryMax = 0;
      }
      // But if provided, they must be valid
      if (jobData.salaryMin < 0) {
        throw new BadRequestException('Lương tối thiểu không được âm');
      }
      if (jobData.salaryMax < 0) {
        throw new BadRequestException('Lương tối đa không được âm');
      }
      if (
        jobData.salaryMin > 0 &&
        jobData.salaryMax > 0 &&
        jobData.salaryMin > jobData.salaryMax
      ) {
        throw new BadRequestException(
          'Lương tối thiểu không được lớn hơn lương tối đa',
        );
      }
    }

    if (jobData.deadline < jobData.postedDate) {
      throw new BadRequestException(
        'Hạn nộp không được sớm hơn ngày đăng',
      );
    }

    const oneMonthLater = new Date(jobData.postedDate);
    oneMonthLater.setMonth(jobData.postedDate.getMonth() + 1);

    if (jobData.deadline > oneMonthLater) {
      throw new BadRequestException(
        'Hạn nộp không được quá 1 tháng sau ngày đăng',
      );
    }
  }

  async getApplicationsByUserId(userId: number): Promise<any[]> {
    const applications = await this.jobApplicationRepository
      .createQueryBuilder('application')
      .leftJoinAndSelect('application.job', 'job')
      .leftJoinAndSelect('job.company', 'company')
      .where('application.userId = :userId', { userId })
      .andWhere('application.delF = :delF', { delF: false })
      .orderBy('application.appliedAt', 'DESC')
      .getMany();

    return applications.map((app) => ({
      id: app.id,
      jobId: app.job.id,
      jobTitle: app.job.title,
      companyName: app.job.company?.name || '',
      companyLogo: app.job.company?.logo || '',
      location: app.job.location || '',
      category: app.job.category || '',
      typeOfEmployment: app.job.typeOfEmployment || null,
      resumePath: app.resumePath || null,
      appliedAt: app.appliedAt,
      status: app.status || ApplicationStatus.SUBMITTED,
      statusNote: app.statusNote || null,
      job: {
        id: app.job.id,
        title: app.job.title,
        companyName: app.job.company?.name || '',
        companyLogo: app.job.company?.logo || '',
        location: app.job.location || '',
        category: app.job.category || '',
        typeOfEmployment: app.job.typeOfEmployment || null,
      },
    }));
  }

  async softDeleteApplication(
    applicationId: number,
    userId: number,
  ): Promise<void> {
    const application = await this.jobApplicationRepository.findOne({
      where: { id: applicationId, userId },
    });

    if (!application) {
      throw new NotFoundException('Không tìm thấy hồ sơ hoặc không có quyền');
    }

    const urlsToDelete = [application.resumePath, application.coverLetterUrl].filter(Boolean) as string[];
    await this.jobApplicationRepository.update(applicationId, { delF: true });
    if (urlsToDelete.length > 0) {
      this.uploadService.deleteBatch(urlsToDelete).catch((e) => console.error('R2 delete (application soft delete) failed:', e));
    }
  }

  async createApplication(
    dto: CreateJobApplicationDto,
  ): Promise<{ application: JobApplication; user: any; isNewUser: boolean }> {
    // Check if job exists
    const job = await this.jobsRepository.findOne({ where: { id: dto.jobId } });
    if (!job) {
      throw new NotFoundException(`Job with ID ${dto.jobId} Không tìm thấy`);
    }

    let userId = dto.userId;
    let isNewUser = false;
    let user = null;

    // If no userId provided, find or create user by email
    if (!userId) {
      user = await this.usersService.findOrCreateUserByEmail(
        dto.email,
        dto.fullName,
        dto.phone,
        dto.cvUrl,
        dto.coverLetterUrl,
        dto.coverLetter,
      );
      userId = user.id;

      // Check if user was just created (by checking if they have no other applications)
      const existingApplicationsCount =
        await this.jobApplicationRepository.count({
          where: { userId: user.id },
        });
      isNewUser = existingApplicationsCount === 0;
    } else {
      // User is logged in - Update their CV and Cover Letter in profile
      user = await this.usersService.findOrCreateUserByEmail(
        dto.email,
        dto.fullName,
        dto.phone,
        dto.cvUrl,
        dto.coverLetterUrl,
        dto.coverLetter,
      );
    }

    // Check if user already applied for this job
    const existingApplication = await this.jobApplicationRepository.findOne({
      where: { jobId: dto.jobId, userId: userId },
    });

    if (existingApplication) {
      throw new BadRequestException('Bạn đã ứng tuyển vị trí này.');
    }

    // Create new application
    const application = this.jobApplicationRepository.create({
      jobId: dto.jobId,
      userId: userId,
      resumePath: dto.cvUrl, // Store CV URL in resumePath
      coverLetterText: dto.coverLetter || null, // Store cover letter text
      coverLetterUrl: dto.coverLetterUrl || null, // Store cover letter file URL
      appliedAt: new Date(),
      delF: false,
      status: ApplicationStatus.SUBMITTED,
      statusNote: null,
    });

    const savedApplication =
      await this.jobApplicationRepository.save(application);

    this.notifyApplicationEmails(dto.jobId, user, savedApplication).catch(
      (e) => console.error('Failed to send application emails:', e),
    );

    return {
      application: savedApplication,
      user: user,
      isNewUser: isNewUser,
    };
  }

  private async notifyAdminsJobPending(jobId: number): Promise<void> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job) return;

    const adminEmails = await this.usersService.findAdminEmails();
    if (!adminEmails.length) return;

    await this.emailService.sendToManyByTemplate(
      'JOB_PENDING_ADMIN',
      adminEmails,
      {
        jobTitle: job.title,
        companyName: job.company?.name || '',
      },
    );
  }

  private async notifyEmployerJobPendingForJob(jobId: number): Promise<void> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job) return;

    const recipient = await this.resolveJobNotificationRecipient(job);
    if (!recipient) return;

    await this.usersService.notifyEmployerJobPending(
      recipient.email,
      recipient.fullName,
      job.title,
      job.company?.name || '',
    );
  }

  private async notifyJobApproved(jobId: number): Promise<void> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job) return;

    const recipient = await this.resolveJobNotificationRecipient(job);
    if (!recipient) return;

    const frontendUrl = this.emailService.getFrontendUrl();
    await this.emailService.sendByTemplate('JOB_APPROVED', recipient.email, {
      fullName: recipient.fullName,
      jobTitle: job.title,
      jobUrl: `${frontendUrl}/jobs/${job.id}`,
    });
  }

  private async notifyJobRejected(jobId: number): Promise<void> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job) return;

    const recipient = await this.resolveJobNotificationRecipient(job);
    if (!recipient) return;

    await this.emailService.sendByTemplate('JOB_REJECTED', recipient.email, {
      fullName: recipient.fullName,
      jobTitle: job.title,
      rejectReason: 'Tin tuyển dụng chưa đáp ứng yêu cầu duyệt.',
    });
  }

  private async notifyApplicationEmails(
    jobId: number,
    user: User | null,
    application: JobApplication,
  ): Promise<void> {
    const job = await this.jobsRepository.findOne({
      where: { id: jobId },
      relations: ['company'],
    });
    if (!job || !user?.email) return;

    await this.emailService.sendByTemplate(
      'APPLICATION_CONFIRMATION',
      user.email,
      {
        applicantName: user.fullName,
        jobTitle: job.title,
        companyName: job.company?.name || '',
        applicationDate: new Date(application.appliedAt).toLocaleDateString(
          'vi-VN',
        ),
      },
    );

    const host = await this.usersService.findHostByCompanyId(job.companyId);
    if (host?.email) {
      await this.emailService.sendByTemplate(
        'NEW_APPLICATION_EMPLOYER',
        host.email,
        {
          jobTitle: job.title,
          applicantName: user.fullName,
          applicantEmail: user.email,
          applicationDate: new Date(application.appliedAt).toLocaleDateString(
            'vi-VN',
          ),
        },
      );
    }
  }

  private async resolveJobNotificationRecipient(
    job: Job,
  ): Promise<{ email: string; fullName: string } | null> {
    const host = await this.usersService.findHostByCompanyId(job.companyId);
    if (host?.email) {
      return { email: host.email, fullName: host.fullName };
    }

    if (job.userId) {
      const creator = await this.usersRepository.findOne({
        where: { id: job.userId },
      });
      if (creator?.email) {
        return { email: creator.email, fullName: creator.fullName };
      }
    }

    return null;
  }

  async updateApplicationStatus(
    applicationId: number,
    dto: UpdateApplicationStatusDto,
    user?: any,
  ) {
    const application = await this.jobApplicationRepository.findOne({
      where: { id: applicationId, delF: false },
      relations: ['job', 'job.company', 'user'],
    });

    if (!application) {
      throw new NotFoundException('Không tìm thấy hồ sơ ứng tuyển');
    }

    this.assertCanManageApplication(application, user);

    const previousStatus =
      application.status || ApplicationStatus.SUBMITTED;
    const nextStatus = dto.status;
    const statusNote = dto.statusMessage?.trim() || null;

    if (previousStatus === nextStatus && statusNote === (application.statusNote || null)) {
      return this.mapApplicationStatusResponse(application);
    }

    application.status = nextStatus;
    application.statusNote = statusNote;
    const saved = await this.jobApplicationRepository.save(application);

    if (previousStatus !== nextStatus) {
      this.notifyApplicationStatusUpdate(saved).catch((e) =>
        console.error('Failed to send application status email:', e),
      );
    }

    return this.mapApplicationStatusResponse(saved);
  }

  private assertCanManageApplication(
    application: JobApplication,
    user?: any,
  ): void {
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (user.role === RoleStatus.ADMIN) {
      return;
    }

    if (user.role !== RoleStatus.COMPANY) {
      throw new ForbiddenException('Bạn không có quyền cập nhật hồ sơ này');
    }

    const job = application.job;
    const isHost =
      user.isHostCompany === true && user.companyId === job?.companyId;
    const isJobOwner = user.id === job?.userId;

    if (!isHost && !isJobOwner) {
      throw new ForbiddenException('Bạn không có quyền cập nhật hồ sơ này');
    }
  }

  private mapApplicationStatusResponse(application: JobApplication) {
    return {
      id: application.id,
      jobId: application.jobId,
      status: application.status,
      statusNote: application.statusNote,
      applicationDate: application.appliedAt,
    };
  }

  private async notifyApplicationStatusUpdate(
    application: JobApplication,
  ): Promise<void> {
    const fullApplication = await this.jobApplicationRepository.findOne({
      where: { id: application.id },
      relations: ['job', 'job.company', 'user'],
    });

    if (!fullApplication?.user?.email) {
      return;
    }

    const statusLabel =
      APPLICATION_STATUS_LABELS[fullApplication.status] ||
      fullApplication.status;
    const statusMessage =
      fullApplication.statusNote?.trim() ||
      'Nhà tuyển dụng đã cập nhật trạng thái hồ sơ của bạn.';

    await this.emailService.sendByTemplate(
      'APPLICATION_STATUS_UPDATE',
      fullApplication.user.email,
      {
        applicantName: fullApplication.user.fullName,
        jobTitle: fullApplication.job?.title || '',
        companyName: fullApplication.job?.company?.name || '',
        applicationStatus: statusLabel,
        statusMessage,
      },
    );
  }
}
