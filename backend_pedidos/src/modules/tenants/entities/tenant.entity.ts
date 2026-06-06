import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity('tenants')
export class Tenant{
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  logo: string;

  @Column({ nullable: true })
  banner: string;

  @Column({ name: 'primary_color', nullable: true })
  primaryColor: string;

  @Column({ name: 'secondary_color', nullable: true })
  secondaryColor: string;

  @Column({ nullable: true })
  whatsapp: string;

  @Column({ nullable: true })
  address: string;

  @Column({ name: 'delivery_cost_enabled', default: false })
  deliveryCostEnabled: boolean;

  @Column({
    name: 'delivery_cost',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  deliveryCost: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'is_open', default: true })
  isOpen: boolean;

  @Column({ nullable: true })
  cbu: string;

  @Column({ nullable: true })
  alias: string;

  @Column({ name: 'account_holder', nullable: true })
  accountHolder: string;

  @Column({ nullable: true })
  bank: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
