import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '30s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3000';
const TENANT = 'perf-test';

export default function () {
  const res = http.get(`${BASE_URL}/${TENANT}/categories?page=1&limit=10`);
  check(res, {
    'status es 200': (r) => r.status === 200,
    'tiene data': (r) => JSON.parse(r.body).data.length > 0,
  });
  sleep(1);
}