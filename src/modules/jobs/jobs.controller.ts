import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Param,
  Put,
  Query,
  Delete,
  ParseIntPipe,
  Patch,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/request/create-job.dto';
import { SearchJobDto } from './dto/request/search-job-request.dto';
import { JobResponseDto } from './dto/response/job-response.dto';
import { JobSearchResponseDto } from './dto/response/search-job-response.dto';
import { Roles } from '../constants/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { RoleStatus } from '@/enum/role';
import { CategoryStatsDto } from './dto/response/category-stats.dto';
import { LocationStatsDto } from './dto/response/location-stats.dto';
import { JobDetailDto } from './dto/response/job-detail.dto';
import { SearchJobAdminDto } from './dto/request/search-job-request-admin.dto';
import { CreateJobApplicationDto } from './dto/create-job-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.COMPANY, RoleStatus.ADMIN, RoleStatus.USER)
  @ApiBearerAuth()
  @ApiResponse({ status: 201, description: 'Job created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Body() createJobDto: CreateJobDto, @Request() req) {
    return this.jobsService.create(createJobDto, req.user);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Job updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @Param('id') id: number,
    @Body() updateJobDto: CreateJobDto,
    @Request() req,
  ) {
    return this.jobsService.update(id, updateJobDto, req.user);
  }

  @Get()
  @ApiResponse({ status: 200, description: 'List jobs' })
  async findAll(): Promise<JobResponseDto[]> {
    return this.jobsService.findAll();
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.ADMIN, RoleStatus.COMPANY)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Admin list jobs (filter by status)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async adminList(@Query() query: SearchJobAdminDto, @Request() req) {
    return this.jobsService.listForAdmin(query, req.user);
  }

  @Get('search')
  @ApiResponse({ status: 200, description: 'Search jobs' })
  async searchJobs(
    @Query() query: SearchJobDto,
  ): Promise<JobSearchResponseDto[]> {
    return this.jobsService.searchJobs(query);
  }

  @Get('categories')
  @ApiResponse({
    status: 200,
    description: 'List of categories and job counts',
    type: [CategoryStatsDto],
  })
  async getCategoriesWithJobCount(): Promise<CategoryStatsDto[]> {
    return this.jobsService.getCategoriesWithJobCount();
  }

  @Get('locations')
  @ApiResponse({
    status: 200,
    description: 'List of locations and job counts',
    type: [LocationStatsDto],
  })
  async getLocationsWithJobCount(): Promise<LocationStatsDto[]> {
    return this.jobsService.getLocationsWithJobCount();
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.USER, RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Get jobs by user ID',
    type: [JobResponseDto],
  })
  async getJobsByUserId(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<JobResponseDto[]> {
    return this.jobsService.getJobsByUserId(userId);
  }

  @Get('email/:email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.USER, RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Get all jobs by email (including pending jobs)',
    type: [JobResponseDto],
  })
  async getJobsByEmail(
    @Param('email') email: string,
  ): Promise<JobResponseDto[]> {
    return this.jobsService.getJobsByEmail(email);
  }

  @Post('applications')
  @ApiResponse({
    status: 201,
    description: 'Application submitted successfully',
  })
  async submitApplication(@Body() dto: CreateJobApplicationDto) {
    const result = await this.jobsService.createApplication(dto);

    return {
      success: true,
      message: 'Gửi hồ sơ ứng tuyển thành công',
      data: {
        applicationId: result.application.id,
        userId: result.application.userId,
        isNewUser: result.isNewUser,
        userEmail: dto.email,
      },
    };
  }

  @Get('applications/user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.USER, RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Get applications submitted by user',
  })
  async getUserApplications(@Param('userId', ParseIntPipe) userId: number) {
    return this.jobsService.getApplicationsByUserId(userId);
  }

  @Delete('applications/:applicationId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.USER, RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Application soft deleted successfully',
  })
  async softDeleteApplication(
    @Param('applicationId', ParseIntPipe) applicationId: number,
    @Request() req,
  ) {
    await this.jobsService.softDeleteApplication(applicationId, req.user.id);
    return { message: 'Đã xóa hồ sơ ứng tuyển' };
  }

  @Patch('applications/:applicationId/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.COMPANY, RoleStatus.ADMIN)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Application status updated' })
  async updateApplicationStatus(
    @Param('applicationId', ParseIntPipe) applicationId: number,
    @Body() dto: UpdateApplicationStatusDto,
    @Request() req,
  ) {
    return this.jobsService.updateApplicationStatus(
      applicationId,
      dto,
      req.user,
    );
  }

  @Get(':id')
  @ApiResponse({
    status: 200,
    description: 'Job details',
    type: JobDetailDto,
  })
  async getJobDetail(@Param('id') id: number): Promise<JobDetailDto> {
    return this.jobsService.getJobDetail(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.ADMIN, RoleStatus.COMPANY)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Job deleted' })
  async delete(@Param('id') id: number) {
    await this.jobsService.delete(id);
    return { message: `Đã xóa tin tuyển dụng ${id} thành công` };
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleStatus.ADMIN, RoleStatus.COMPANY)
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Job approved successfully',
  })
  async approveJobs(
    @Param('id', ParseIntPipe) jobId: number,
    @Request() req,
  ) {
    return this.jobsService.approve(jobId, req.user);
  }
}
