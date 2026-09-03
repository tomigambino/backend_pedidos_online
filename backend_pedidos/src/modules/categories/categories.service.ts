import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  async findAll(
    tenantId: string,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<CategoryResponseDto>> {
    return this.runFindAll(tenantId, pagination, true);
  }

  async findAllAdmin(
    tenantId: string,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<CategoryResponseDto>> {
    return this.runFindAll(tenantId, pagination, false);
  }

  private async runFindAll(
    tenantId: string,
    pagination: PaginationDto | undefined,
    onlyActive: boolean,
  ): Promise<PaginatedResult<CategoryResponseDto>> {
    const { page = 1, limit = 10 } = pagination ?? {};

    const joinCondition = `p.category_id = c.id AND p.deleted_at IS NULL${onlyActive ? ' AND p.is_active = true' : ''}`;

    const queryBuilder = this.categoryRepo
      .createQueryBuilder('c')
      .leftJoin(Product, 'p', joinCondition)
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.deleted_at IS NULL')
      .andWhere(onlyActive ? 'c.is_active = true' : '1 = 1')
      .select([
        'c.id AS id',
        'c.name AS name',
        'c.is_active AS is_active',
        'COUNT(p.id) AS product_count',
      ])
      .groupBy('c.id')
      .addGroupBy('c.name')
      .orderBy('c.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rawData, total] = await Promise.all([
      queryBuilder.getRawMany(),
      this.categoryRepo.count({ where: { tenantId } }),
    ]);

    return {
      data: rawData.map((item) => ({
        id: item.id,
        name: item.name,
        productCount: Number(item.product_count),
        isActive: item.is_active,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, tenantId: string) {
    return this.findOneOrFail(id, tenantId);
  }

  create(dto: CreateCategoryDto, tenantId: string) {
    const category = this.categoryRepo.create({
      name: dto.name,
      tenantId,
    });
    return this.categoryRepo.save(category);
  }

  async update(id: string, dto: UpdateCategoryDto, tenantId: string) {
    const category = await this.findOneOrFail(id, tenantId);
    this.categoryRepo.merge(category, { name: dto.name });
    return this.categoryRepo.save(category);
  }

  async remove(id: string, tenantId: string) {
    const category = await this.findOneOrFail(id, tenantId);
    await this.categoryRepo.softRemove(category);
  }

  async activate(id: string, tenantId: string): Promise<CategoryResponseDto> {
    const category = await this.findOneOrFail(id, tenantId);
    category.isActive = true;
    const saved = await this.categoryRepo.save(category);
    return this.toResponse(saved);
  }

  async hide(id: string, tenantId: string): Promise<CategoryResponseDto> {
    const category = await this.findOneOrFail(id, tenantId);
    category.isActive = false;
    const saved = await this.categoryRepo.save(category);
    return this.toResponse(saved);
  }

  private toResponse(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      productCount: 0,
      isActive: category.isActive,
    };
  }

  private async findOneOrFail(id: string, tenantId: string): Promise<Category> {
    const category = await this.categoryRepo.findOne({
      where: { id, tenantId },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return category;
  }
}
