import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async findAll(tenantId: string): Promise<ProductResponseDto[]> {
    const products = await this.productRepo.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
    return products.map(p => this.toResponse(p));
  }

  async findOne(id: string, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    return this.toResponse(product);
  }

  async create(dto: CreateProductDto, tenantId: string): Promise<ProductResponseDto> {
    const product = new Product();
    product.name = dto.name;
    product.description = dto.description ?? null;
    product.price = dto.price;
    product.categoryId = dto.categoryId;
    product.imageUrl = dto.imageUrl ?? null;
    product.tenantId = tenantId;
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async update(id: string, dto: UpdateProductDto, tenantId: string): Promise<ProductResponseDto> {
    const product = await this.findOneOrFail(id, tenantId);
    this.productRepo.merge(product, dto);
    const saved = await this.productRepo.save(product);
    return this.toResponse(saved);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const product = await this.findOneOrFail(id, tenantId);
    await this.productRepo.softRemove(product);
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

  private async findOneOrFail(id: string, tenantId: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
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