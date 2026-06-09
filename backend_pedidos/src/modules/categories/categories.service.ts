import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
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

  async findAll(tenantId: string, pagination?: PaginationDto): Promise<PaginatedResult<CategoryResponseDto>> {
    const { page = 1, limit = 10 } = pagination ?? {};
    const [categories, total] = await this.categoryRepo.findAndCount({
      where: { tenantId },
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return {
      data: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
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
