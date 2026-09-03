import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { OrderStatus } from '../../common/enums/order-status.enum';

@Injectable()
export class OrdersSseService {
  private streams = new Map<string, Subject<OrderStatus>>();

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
