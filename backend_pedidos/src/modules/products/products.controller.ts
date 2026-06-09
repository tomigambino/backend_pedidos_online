import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';

@Controller(':tenant/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query() paginationDto?: PaginationDto,
  ) {
    return this.productsService.findAll(tenantId, paginationDto);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard)
  findAllAdmin(
    @TenantId() tenantId: string,
    @Query() paginationDto?: PaginationDto,
  ) {
    return this.productsService.findAllAdmin(tenantId, paginationDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.findOne(id, tenantId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @Body() dto: CreateProductDto,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.create(dto, tenantId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.remove(id, tenantId);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.activate(id, tenantId);
  }

  @Patch(':id/hide')
  @UseGuards(JwtAuthGuard)
  hide(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.productsService.hide(id, tenantId);
  }
}
