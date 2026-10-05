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
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { isHttpUrl } from '../../common/utils/is-http-url.util';

export type ResolvedSchedule = {
  openingTime: string;
  closingTime: string;
  maxOrderTime: string;
};

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(RegularSchedule)
    private readonly scheduleRepo: Repository<RegularSchedule>,
    @InjectRepository(AvailabilityException)
    private readonly exceptionRepo: Repository<AvailabilityException>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async update(
    tenantId: string,
    dto: UpdateTenantDto,
    files?: {
      logo?: Express.Multer.File[];
      banner?: Express.Multer.File[];
    },
  ): Promise<Tenant> {
    const tenant = await this.findOneOrFail(tenantId);
    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.primaryColor !== undefined) tenant.primaryColor = dto.primaryColor;
    if (dto.secondaryColor !== undefined)
      tenant.secondaryColor = dto.secondaryColor;
    if (dto.description !== undefined) tenant.description = dto.description;
    if (dto.whatsapp !== undefined) tenant.whatsapp = dto.whatsapp;
    if (dto.address !== undefined) tenant.address = dto.address;
    if (dto.cbu !== undefined) tenant.cbu = dto.cbu;
    if (dto.alias !== undefined) tenant.alias = dto.alias;
    if (dto.accountHolder !== undefined)
      tenant.accountHolder = dto.accountHolder;
    if (dto.bank !== undefined) tenant.bank = dto.bank;
    if (dto.isOpen !== undefined) tenant.isOpen = dto.isOpen;
    if (dto.deliveryCostEnabled !== undefined)
      tenant.deliveryCostEnabled = dto.deliveryCostEnabled;
    if (dto.deliveryCost !== undefined) tenant.deliveryCost = dto.deliveryCost;
    if (dto.minimumDeliveryTime !== undefined)
      tenant.minimumDeliveryTime = dto.minimumDeliveryTime;
    const folder = `pedilo/${tenant.slug}/branding/`;
    const logo = files?.logo?.[0];
    const banner = files?.banner?.[0];
    if (logo) {
      if (tenant.logo) {
        this.cloudinaryService.deleteImage(tenant.logo).catch(() => {});
      }
      tenant.logo = await this.cloudinaryService.uploadImage(
        logo.buffer,
        folder,
      );
    }
    if (banner) {
      if (tenant.banner) {
        this.cloudinaryService.deleteImage(tenant.banner).catch(() => {});
      }
      tenant.banner = await this.cloudinaryService.uploadImage(
        banner.buffer,
        folder,
      );
    }
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
      logo: isHttpUrl(tenant.logo) ? tenant.logo : null,
      banner: isHttpUrl(tenant.banner) ? tenant.banner : null,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      description: tenant.description,
      whatsapp: tenant.whatsapp,
      address: tenant.address,
      isOpen: tenant.isOpen,
      deliveryCostEnabled: tenant.deliveryCostEnabled,
      deliveryCost: tenant.deliveryCost ? Number(tenant.deliveryCost) : null,
      minimumDeliveryTime: tenant.minimumDeliveryTime,
      schedule: {
        regular: regular.map((r) => this.toScheduleResponse(r)),
        exceptions: exceptions.map((e) => this.toExceptionResponse(e)),
      },
    };
  }

  async findSchedule(tenantId: string): Promise<RegularScheduleResponseDto[]> {
    const schedules = await this.scheduleRepo.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC' },
    });
    return schedules.map((r) => this.toScheduleResponse(r));
  }

  async createSchedule(
    dto: CreateRegularScheduleDto,
    tenantId: string,
  ): Promise<RegularScheduleResponseDto> {
    const schedule = new RegularSchedule();
    schedule.dayOfWeek = dto.dayOfWeek;
    schedule.openingTime = dto.openingTime;
    schedule.closingTime = dto.closingTime;
    schedule.maxOrderTime = dto.maxOrderTime ?? null;
    schedule.tenantId = tenantId;
    const saved = await this.scheduleRepo.save(schedule);
    return this.toScheduleResponse(saved);
  }

  async updateSchedule(
    id: string,
    dto: UpdateRegularScheduleDto,
    tenantId: string,
  ): Promise<RegularScheduleResponseDto> {
    const schedule = await this.findScheduleOrFail(id, tenantId);
    if (dto.dayOfWeek !== undefined) schedule.dayOfWeek = dto.dayOfWeek;
    if (dto.openingTime !== undefined) schedule.openingTime = dto.openingTime;
    if (dto.closingTime !== undefined) schedule.closingTime = dto.closingTime;
    if (dto.maxOrderTime !== undefined)
      schedule.maxOrderTime = dto.maxOrderTime;
    const saved = await this.scheduleRepo.save(schedule);
    return this.toScheduleResponse(saved);
  }

  async deleteSchedule(id: string, tenantId: string): Promise<void> {
    const schedule = await this.findScheduleOrFail(id, tenantId);
    await this.scheduleRepo.remove(schedule);
  }

  async findExceptions(tenantId: string): Promise<ExceptionResponseDto[]> {
    const exceptions = await this.exceptionRepo.find({
      where: { tenantId },
      order: { date: 'DESC' },
    });
    return exceptions.map((e) => this.toExceptionResponse(e));
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
    exception.maxOrderTime = dto.isOpen ? (dto.maxOrderTime ?? null) : null;
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
    const exception = await this.findExceptionOrFail(id, tenantId);
    if (dto.date !== undefined) exception.date = dto.date;
    if (dto.isOpen !== undefined) {
      exception.isOpen = dto.isOpen;
      exception.openingTime = dto.isOpen ? (dto.openingTime ?? null) : null;
      exception.closingTime = dto.isOpen ? (dto.closingTime ?? null) : null;
      exception.maxOrderTime = dto.isOpen ? (dto.maxOrderTime ?? null) : null;
    } else if (dto.maxOrderTime !== undefined) {
      exception.maxOrderTime = dto.maxOrderTime;
    }
    if (dto.reason !== undefined) exception.reason = dto.reason;
    const saved = await this.exceptionRepo.save(exception);
    return this.toExceptionResponse(saved);
  }

  async deleteException(id: string, tenantId: string): Promise<void> {
    const exception = await this.findExceptionOrFail(id, tenantId);
    await this.exceptionRepo.remove(exception);
  }

  async removeBrandingImage(
    tenantId: string,
    field: 'logo' | 'banner',
  ): Promise<Tenant> {
    const tenant = await this.findOneOrFail(tenantId);
    if (field === 'logo' && tenant.logo) {
      await this.cloudinaryService.deleteImage(tenant.logo);
      tenant.logo = null;
    } else if (field === 'banner' && tenant.banner) {
      await this.cloudinaryService.deleteImage(tenant.banner);
      tenant.banner = null;
    }
    return this.tenantRepo.save(tenant);
  }

  async resolveScheduleForDate(
    tenantId: string,
    desired: Date,
  ): Promise<ResolvedSchedule | null> {
    const tenant = await this.findOneOrFail(tenantId);
    const dateStr = this.getDateInAR(desired);
    const dayOfWeek = this.getDayOfWeekInAR(desired);

    const exception = await this.exceptionRepo.findOne({
      where: { tenantId, date: dateStr },
    });

    if (exception) {
      if (!exception.isOpen) return null;
      const openingTime = exception.openingTime!.slice(0, 5);
      const closingTime = exception.closingTime!.slice(0, 5);
      const maxOrderTime = (
        exception.maxOrderTime ??
        this.subtractMinutesFromTime(closingTime, tenant.minimumDeliveryTime)
      ).slice(0, 5);
      return { openingTime, closingTime, maxOrderTime };
    }

    const schedules = await this.scheduleRepo.find({
      where: { tenantId, dayOfWeek },
      order: { openingTime: 'ASC' },
    });

    if (schedules.length === 0) return null;

    const desiredHM = this.formatHourMinuteInAR(desired);
    const matches = schedules.find((s) => {
      const openingTime = s.openingTime.slice(0, 5);
      const closingTime = s.closingTime.slice(0, 5);
      const maxOrderTime = (
        s.maxOrderTime ??
        this.subtractMinutesFromTime(closingTime, tenant.minimumDeliveryTime)
      ).slice(0, 5);
      return desiredHM >= openingTime && desiredHM <= maxOrderTime;
    });

    const resolved = matches ?? schedules[0];
    const openingTime = resolved.openingTime.slice(0, 5);
    const closingTime = resolved.closingTime.slice(0, 5);
    const maxOrderTime = (
      resolved.maxOrderTime ??
      this.subtractMinutesFromTime(closingTime, tenant.minimumDeliveryTime)
    ).slice(0, 5);
    return { openingTime, closingTime, maxOrderTime };
  }

  private async findOneOrFail(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return tenant;
  }

  private async findScheduleOrFail(
    id: string,
    tenantId: string,
  ): Promise<RegularSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, tenantId },
    });
    if (!schedule) throw new NotFoundException('Horario no encontrado');
    return schedule;
  }

  private async findExceptionOrFail(
    id: string,
    tenantId: string,
  ): Promise<AvailabilityException> {
    const exception = await this.exceptionRepo.findOne({
      where: { id, tenantId },
    });
    if (!exception) throw new NotFoundException('Excepción no encontrada');
    return exception;
  }

  private toScheduleResponse(
    schedule: RegularSchedule,
  ): RegularScheduleResponseDto {
    return {
      id: schedule.id,
      dayOfWeek: schedule.dayOfWeek,
      openingTime: schedule.openingTime,
      closingTime: schedule.closingTime,
      maxOrderTime: schedule.maxOrderTime,
    };
  }

  private toExceptionResponse(
    exception: AvailabilityException,
  ): ExceptionResponseDto {
    return {
      id: exception.id,
      date: exception.date,
      isOpen: exception.isOpen,
      openingTime: exception.openingTime,
      closingTime: exception.closingTime,
      maxOrderTime: exception.maxOrderTime,
      reason: exception.reason,
    };
  }

  private getDateInAR(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private getDayOfWeekInAR(date: Date): number {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
      weekday: 'short',
    }).format(date);
    const map: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };
    return map[weekday] ?? 1;
  }

  private formatHourMinuteInAR(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
  }

  private subtractMinutesFromTime(time: string, minutes: number): string {
    const [h, m, s = '00'] = time.split(':');
    const totalMinutes = parseInt(h) * 60 + parseInt(m) - minutes;
    if (totalMinutes <= 0) return '00:00:00';
    const newH = Math.floor(totalMinutes / 60);
    const newM = totalMinutes % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:${s}`;
  }
}
