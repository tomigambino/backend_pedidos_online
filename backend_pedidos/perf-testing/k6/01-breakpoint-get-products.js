import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '30s', target: 400 },
        { duration: '30s', target: 600 },
        { duration: '30s', target: 800 },
        { duration: '30s', target: 1000 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true }],
    http_req_duration: [{ threshold: 'p(95)<1000', abortOnFail: true }],
  },
};

export default function () {
  const res = http.get('http://localhost:3000/perf-test/products');
  check(res, {
    'status es 200': (r) => r.status === 200,
    'tiene data': (r) => JSON.parse(r.body).data !== undefined,
  });
  sleep(1);
}