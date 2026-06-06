import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { RegularSchedule } from './entities/regular-schedule.entity';
import { AvailabilityException } from './entities/availability-exception.entity';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateRegularScheduleDto } from './dto/create-regular-schedule.dto';
import { UpdateRegularScheduleDto } from './dto/update-regular-schedule.dto';
import { RegularScheduleResponseDto } from './dto/regular-schedule-response.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';
import { UpdateExceptionDto } from './dto/update-exception.dto';
import { ExceptionResponseDto } from './dto/exception-response.dto';
import { TenantConfigResponseDto } from './dto/tenant-config-response.dto';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(RegularSchedule)
    private readonly scheduleRepo: Repository<RegularSchedule>,
    @InjectRepository(AvailabilityException)
    private readonly exceptionRepo: Repository<AvailabilityException>,
  ) {}

  async update(dto: UpdateTenantDto, tenantId: string): Promise<Tenant> {
    const tenant = await this.findOneOrFail(tenantId);
    this.tenantRepo.merge(tenant, dto);
    return this.tenantRepo.save(tenant);
  }

  async getConfig(tenantId: string): Promise<TenantConfigResponseDto> {
    const tenant = await this.findOneOrFail(tenantId);
    const regular = await this.scheduleRepo.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC' },
    });
    const exceptions = await this.exceptionRepo.find({
      where: { tenantId },
      order: { date: 'DESC' },
    });

    return {
      name: tenant.name,
      logo: tenant.logo,
      banner: tenant.banner,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      description: tenant.description,
      whatsapp: tenant.whatsapp,
      address: tenant.address,
      isOpen: tenant.isOpen,
      deliveryCostEnabled: tenant.deliveryCostEnabled,
      deliveryCost: tenant.deliveryCost ? Number(tenant.deliveryCost) : null,
      schedule: {
        regular: regular.map(r => this.toScheduleResponse(r)),
        exceptions: exceptions.map(e => this.toExceptionResponse(e)),
      },
    };
  }

  async findSchedule(tenantId: string): Promise<RegularScheduleResponseDto[]> {
    const schedules = await this.scheduleRepo.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC' },
    });
    return schedules.map(r => this.toScheduleResponse(r));
  }

  async createSchedule(
    dto: CreateRegularScheduleDto,
    tenantId: string,
  ): Promise<RegularScheduleResponseDto> {
    const schedule = new RegularSchedule();
    schedule.dayOfWeek = dto.dayOfWeek;
    schedule.openingTime = dto.openingTime;
    schedule.closingTime = dto.closingTime;
    schedule.tenantId = tenantId;
    const saved = await this.scheduleRepo.save(schedule);
    return this.toScheduleResponse(saved);
  }

  async updateSchedule(
    id: string,
    dto: UpdateRegularScheduleDto,
    tenantId: string,
  ): Promise<RegularScheduleResponseDto> {
    const schedule = await this.scheduleRepo.findOne({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundException('Horario no encontrado');
    if (dto.dayOfWeek !== undefined) schedule.dayOfWeek = dto.dayOfWeek;
    if (dto.openingTime !== undefined) schedule.openingTime = dto.openingTime;
    if (dto.closingTime !== undefined) schedule.closingTime = dto.closingTime;
    const saved = await this.scheduleRepo.save(schedule);
    return this.toScheduleResponse(saved);
  }

  async deleteSchedule(id: string, tenantId: string): Promise<void> {
    const schedule = await this.scheduleRepo.findOne({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundException('Horario no encontrado');
    await this.scheduleRepo.remove(schedule);
  }

  async findExceptions(tenantId: string): Promise<ExceptionResponseDto[]> {
    const exceptions = await this.exceptionRepo.find({
      where: { tenantId },
      order: { date: 'DESC' },
    });
    return exceptions.map(e => this.toExceptionResponse(e));
  }

  async createException(
    dto: CreateExceptionDto,
    tenantId: string,
  ): Promise<ExceptionResponseDto> {
    const exception = new AvailabilityException();
    exception.date = dto.date;
    exception.isOpen = dto.isOpen;
    exception.openingTime = dto.isOpen ? (dto.openingTime ?? null) : null;
    exception.closingTime = dto.isOpen ? (dto.closingTime ?? null) : null;
    exception.reason = dto.reason ?? null;
    exception.tenantId = tenantId;
    const saved = await this.exceptionRepo.save(exception);
    return this.toExceptionResponse(saved);
  }

  async updateException(
    id: string,
    dto: UpdateExceptionDto,
    tenantId: string,
  ): Promise<ExceptionResponseDto> {
    const exception = await this.exceptionRepo.findOne({ where: { id, tenantId } });
    if (!exception) throw new NotFoundException('Excepción no encontrada');
    if (dto.date !== undefined) exception.date = dto.date;
    if (dto.isOpen !== undefined) {
      exception.isOpen = dto.isOpen;
      exception.openingTime = dto.isOpen ? (dto.openingTime ?? null) : null;
      exception.closingTime = dto.isOpen ? (dto.closingTime ?? null) : null;
    }
    if (dto.reason !== undefined) exception.reason = dto.reason;
    const saved = await this.exceptionRepo.save(exception);
    return this.toExceptionResponse(saved);
  }

  async deleteException(id: string, tenantId: string): Promise<void> {
    const exception = await this.exceptionRepo.findOne({ where: { id, tenantId } });
    if (!exception) throw new NotFoundException('Excepción no encontrada');
    await this.exceptionRepo.remove(exception);
  }

  private async findOneOrFail(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return tenant;
  }

  private toScheduleResponse(schedule: RegularSchedule): RegularScheduleResponseDto {
    return {
      id: schedule.id,
      dayOfWeek: schedule.dayOfWeek,
      openingTime: schedule.openingTime,
      closingTime: schedule.closingTime,
    };
  }

  private toExceptionResponse(exception: AvailabilityException): ExceptionResponseDto {
    return {
      id: exception.id,
      date: exception.date,
      isOpen: exception.isOpen,
      openingTime: exception.openingTime,
      closingTime: exception.closingTime,
      reason: exception.reason,
    };
  }
}
