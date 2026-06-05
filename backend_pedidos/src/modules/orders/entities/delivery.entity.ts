import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  address: string;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column({
    name: 'delivery_fee',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  deliveryFee: number | null;
}