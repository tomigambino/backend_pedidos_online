import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { Tenant } from './entities/tenant.entity';
import { RegularSchedule } from './entities/regular-schedule.entity';
import { AvailabilityException } from './entities/availability-exception.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, RegularSchedule, AvailabilityException])],
  providers: [TenantsService],
  controllers: [TenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
