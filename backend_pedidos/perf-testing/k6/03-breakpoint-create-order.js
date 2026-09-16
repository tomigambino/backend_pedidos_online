import http from 'k6/http';
import { check, sleep } from 'k6';

const PRODUCT_ID_1 = __ENV.PRODUCT_ID_1;

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 180 },
        { duration: '20s', target: 200 },
        { duration: '20s', target: 220 },
        { duration: '20s', target: 240 },
        { duration: '20s', target: 260 },
        ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }],
    http_req_duration: [{ threshold: 'p(95)<800', abortOnFail: true }],
  },
};

export default function () {
  const payload = JSON.stringify({
    items: [{ productId: PRODUCT_ID_1, quantity: 1 }],
    customer: { name: 'Test Perf', phone: '1122334455' },
    paymentMethod: 'EFECTIVO',
    deliveryType: 'RETIRO_LOCAL',
  });

  const res = http.post('http://localhost:3000/perf-test/orders', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, { 'status es 201': (r) => r.status === 201 });
  sleep(1);
}