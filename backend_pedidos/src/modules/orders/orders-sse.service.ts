import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { OrderStatus } from '../../common/enums/order-status.enum';

@Injectable()
export class OrdersSseService {
  private streams = new Map<string, Subject<OrderStatus>>();
  private connections = new Map<string, number>();

  connect(trackingUuid: string): void {
    this.getOrCreate(trackingUuid);
    this.connections.set(
      trackingUuid,
      (this.connections.get(trackingUuid) ?? 0) + 1,
    );
  }

  disconnect(trackingUuid: string): void {
    const remaining = (this.connections.get(trackingUuid) ?? 1) - 1;
    if (remaining <= 0) {
      this.connections.delete(trackingUuid);
      this.close(trackingUuid);
    } else {
      this.connections.set(trackingUuid, remaining);
    }
  }

  getOrCreate(trackingUuid: string): Subject<OrderStatus> {
    if (!this.streams.has(trackingUuid)) {
      this.streams.set(trackingUuid, new Subject<OrderStatus>());
    }
    return this.streams.get(trackingUuid)!;
  }

  emit(trackingUuid: string, status: OrderStatus): void {
    this.streams.get(trackingUuid)?.next(status);
  }

  close(trackingUuid: string): void {
    const subject = this.streams.get(trackingUuid);
    if (subject) {
      subject.complete();
      this.streams.delete(trackingUuid);
    }
  }
}