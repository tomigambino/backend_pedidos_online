import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 50 },   // Rampa suave a 50 VUs
    { duration: '30s', target: 100 },  // Sube a 100 VUs
    { duration: '30s', target: 200 },  // Pico de estrés: 200 VUs
    { duration: '20s', target: 200 },  // Mantiene 200 VUs sostenidos
    { duration: '15s', target: 0 },    // Bajada progresiva a 0 VUs
  ],
  thresholds: {
    // Si la API se estresa, relajamos un poco el p(95) a 1000ms para no abortar el test antes de tiempo
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],     // Tolera hasta un 5% de fallos para encontrar el límite
  },
};

const BASE_URL = 'http://localhost:3000';
const TENANT = 'perf-test';

export default function () {
  const res = http.get(`${BASE_URL}/${TENANT}/products?page=1&limit=10`);

  let jsonBody = null;
  try {
    jsonBody = res.json();
  } catch (e) {}

  check(res, {
    'status es 200': (r) => r.status === 200,
    'tiene data': () =>
      jsonBody !== null &&
      Array.isArray(jsonBody.data) &&
      jsonBody.data.length > 0,
  });

  sleep(1);
}