import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateRegularScheduleDto } from './dto/create-regular-schedule.dto';
import { UpdateRegularScheduleDto } from './dto/update-regular-schedule.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { UpdateExceptionDto } from './dto/update-exception.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';

@Controller(':tenant')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('availability')
  getAvailability(@TenantId() tenantId: string) {
    return this.tenantsService.getConfig(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/tenants')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]))
  update(
    @Body() dto: UpdateTenantDto,
    @UploadedFiles() files: {
      logo?: Express.Multer.File[];
      banner?: Express.Multer.File[];
    },
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.update(tenantId, dto, files);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/schedule')
  findSchedule(@TenantId() tenantId: string) {
    return this.tenantsService.findSchedule(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/schedule')
  createSchedule(
    @Body() dto: CreateRegularScheduleDto,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.createSchedule(dto, tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/schedule/:id')
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegularScheduleDto,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.updateSchedule(id, dto, tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/schedule/:id')
  deleteSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.deleteSchedule(id, tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/exceptions')
  findExceptions(@TenantId() tenantId: string) {
    return this.tenantsService.findExceptions(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/exceptions')
  createException(
    @Body() dto: CreateExceptionDto,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.createException(dto, tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/exceptions/:id')
  updateException(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExceptionDto,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.updateException(id, dto, tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/exceptions/:id')
  deleteException(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.tenantsService.deleteException(id, tenantId);
  }
}
