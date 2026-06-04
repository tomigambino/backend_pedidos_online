import {
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response, NextFunction } from 'express';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const slug = req.params.tenant as string;
    if (!slug) {
      return next();
    }
    const tenant = await this.tenantRepo.findOne({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
    req['tenantId'] = tenant.id;
    next();
  }
}
