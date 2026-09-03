import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { Category } from '../categories/entities/category.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAll(
    tenantId: string,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    const { page = 1, limit = 10 } = pagination ?? {};

    const [products, total] = await this.productRepo
      .createQueryBuilder('product')
      .innerJoin('product.category', 'category')
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere('product.isActive = true')
      .andWhere('category.isActive = true')
      .andWhere('category.deletedAt IS NULL')
      .orderBy('product.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: products.map((p) => this.toResponse(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findAllAdmin(
    tenantId: string,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<ProductResponseDto>> {
    const { page = 1, limit = 10 } = pagination ?? {};
    const [products, total] = await this.productRepo.findAndCount({
      where: { tenantId },
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return {
      data: products.map((p) => this.toResponse(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    return this.toResponse(product);
  }

  async create(
    dto: CreateProductDto,
    tenantId: string,
    file?: Express.Multer.File,
  ): Promise<ProductResponseDto> {
    await this.validateCategory(dto.categoryId, tenantId);
    const imageUrl = await this.resolveImageUrl(tenantId, file);
    const product = new Product();
    product.name = dto.name;
    product.description = dto.description ?? null;
    product.price = dto.price;
    product.categoryId = dto.categoryId;
    product.imageUrl = imageUrl ?? null;
    product.tenantId = tenantId;
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    tenantId: string,
    file?: Express.Multer.File,
  ): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    if (dto.categoryId !== undefined) {
      await this.validateCategory(dto.categoryId, tenantId);
    }
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId;
    const imageUrl = await this.resolveImageUrl(tenantId, file);
    if (imageUrl) product.imageUrl = imageUrl;
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const product = await this.findOneOrFail(id, tenantId);
    await this.productRepo.softRemove(product);
  }

  async removeImage(id: string, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    if (product.imageUrl) {
      await this.cloudinaryService.deleteImage(product.imageUrl);
      product.imageUrl = null;
    }
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async activate(id: string, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    product.isActive = true;
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async hide(id: string, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    product.isActive = false;
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async findOneForOrder(id: string, tenantId: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id, tenantId, isActive: true },
    });
    if (!product) throw new BadRequestException(`Producto ${id} no disponible`);
    return product;
  }

  private async validateCategory(
    categoryId: string,
    tenantId: string,
  ): Promise<void> {
    const category = await this.categoryRepo.findOne({
      where: { id: categoryId, tenantId },
    });
    if (!category) {
      throw new BadRequestException(
        'Categoría no encontrada o no pertenece a este negocio',
      );
    }
  }

  private async findOneOrFail(id: string, tenantId: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private async resolveImageUrl(
    tenantId: string,
    file?: Express.Multer.File,
  ): Promise<string | undefined> {
    if (!file) return undefined;
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    const folder = `pedilo/${tenant.slug}/products/`;
    return this.cloudinaryService.uploadImage(file.buffer, folder);
  }

  private toResponse(product: Product): ProductResponseDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      categoryId: product.categoryId,
    };
  }
}
