import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 10 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3000';
const TENANT = 'perf-test';

export default function () {
  const productId = __ENV.PRODUCT_ID_1 || '5b867757-3ac7-410b-ab24-01b0c127e007';

  const payload = JSON.stringify({
    items: [
      {
        productId: productId,
        quantity: 2,
      },
    ],
    customer: {
      // Solo letras y espacios para cumplir con la Regex de CreateCustomerDto
      name: 'Cliente de Prueba kSix',
      phone: '1155551234',
    },
    paymentMethod: 'EFECTIVO',
    deliveryType: 'RETIRO_LOCAL',
  });

  const res = http.post(`${BASE_URL}/${TENANT}/orders`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  // Muestra el detalle exacto si falla algún campo
  if (res.status !== 201) {
    console.log(`[Error ${res.status}]: ${res.body}`);
  }

  check(res, {
    'status es 201': (r) => r.status === 201,
  });

  sleep(1);
}