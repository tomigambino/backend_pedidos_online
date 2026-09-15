import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 10 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3000';
const TENANT = 'perf-test';

export function setup() {
  // Si le pasamos la cookie por consola, evitamos hacer el login que falla
  if (__ENV.ADMIN_COOKIE) {
    return { cookieHeader: __ENV.ADMIN_COOKIE };
  }

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'perf@test.com', password: 'perfpass123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const cookieHeader = Object.entries(loginRes.cookies)
    .map(([name, arr]) => `${name}=${arr[0].value}`)
    .join('; ');

  return { cookieHeader };
}

export default function (data) {
  const cookieHeader = data.cookieHeader || __ENV.ADMIN_COOKIE;

  const res = http.get(`${BASE_URL}/${TENANT}/orders?page=1&limit=10`, {
    headers: { 
      'Cookie': cookieHeader,
      'Content-Type': 'application/json',
    },
  });

  check(res, {
    'status es 200': (r) => r.status === 200,
  });

  sleep(1);
}