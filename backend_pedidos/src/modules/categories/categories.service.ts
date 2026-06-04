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

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  async findAll(tenantId: string): Promise<CategoryResponseDto[]> {
    const categories = await this.categoryRepo.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
    }));
  }

  async findOne(id: string, tenantId: string) {
    const category = await this.categoryRepo.findOne({
      where: { id, tenantId },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return category;
  }

  create(dto: CreateCategoryDto, tenantId: string) {
    const category = this.categoryRepo.create({
      name: dto.name,
      tenantId,
    });
    return this.categoryRepo.save(category);
  }

  async update(id: string, dto: UpdateCategoryDto, tenantId: string) {
    const category = await this.findOne(id, tenantId);
    this.categoryRepo.merge(category, { name: dto.name });
    return this.categoryRepo.save(category);
  }

  async remove(id: string, tenantId: string) {
    const category = await this.findOne(id, tenantId);
    await this.categoryRepo.softRemove(category);
  }
}
