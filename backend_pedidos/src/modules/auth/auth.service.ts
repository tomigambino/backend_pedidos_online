import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { User } from './entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/enums/user-role.enum';

const DUMMY_HASH =
  '$2b$10$OKpvlxHkCkKqe7GvvuNakug7G9UPV9PithgjB7PXtmkrwtOf1c6Xm';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingUser = await queryRunner.manager.findOne(User, {
        where: { email: dto.email },
      });
      if (existingUser) {
        throw new BadRequestException('Email ya registrado');
      }

      const existingTenant = await queryRunner.manager.findOne(Tenant, {
        where: { slug: dto.tenantSlug },
      });
      if (existingTenant) {
        throw new BadRequestException('Slug de negocio no disponible');
      }

      const tenant = queryRunner.manager.create(Tenant, {
        name: dto.tenantName,
        slug: dto.tenantSlug,
      });
      const savedTenant = await queryRunner.manager.save(tenant);

      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = queryRunner.manager.create(User, {
        email: dto.email,
        password: passwordHash,
        role: UserRole.OWNER,
        tenantId: savedTenant.id,
      });
      const savedUser = await queryRunner.manager.save(user);

      await queryRunner.commitTransaction();

      const payload = { userId: savedUser.id, tenantId: savedTenant.id };
      return {
        accessToken: this.jwtService.sign(payload),
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
    });

    const isValid = await bcrypt.compare(
      dto.password,
      user?.password ?? DUMMY_HASH,
    );
    if (!user || !isValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = { userId: user.id, tenantId: user.tenantId };
    return { accessToken: this.jwtService.sign(payload) };
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['tenant'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    return {
      email: user.email,
      tenantSlug: user.tenant.slug,
      tenantName: user.tenant.name,
    };
  }
}
