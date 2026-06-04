import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { User } from './entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new BadRequestException('Email ya registrado');
    }

    const existingTenant = await this.tenantRepo.findOne({
      where: { slug: dto.tenantSlug },
    });
    if (existingTenant) {
      throw new BadRequestException('Slug de negocio no disponible');
    }

    const tenant = this.tenantRepo.create({
      name: dto.tenantName,
      slug: dto.tenantSlug,
    });
    const savedTenant = await this.tenantRepo.save(tenant);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      password: passwordHash,
      role: UserRole.OWNER,
      tenantId: savedTenant.id,
    });
    const savedUser = await this.userRepo.save(user);

    const payload = { userId: savedUser.id, tenantId: savedTenant.id };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async login(dto: LoginDto, tenantId: string) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email, tenantId },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) throw new UnauthorizedException('Credenciales inválidas');

    const payload = { userId: user.id, tenantId: user.tenantId };
    return { accessToken: this.jwtService.sign(payload) };
  }
}
