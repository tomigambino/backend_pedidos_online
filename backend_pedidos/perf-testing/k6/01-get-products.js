import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },  // rampa hasta 20 usuarios virtuales
    { duration: '30s', target: 20 },  // sostenido
    { duration: '10s', target: 0 },   // baja
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:3000';
const TENANT = 'perf-test';

export default function () {
  const res = http.get(`${BASE_URL}/${TENANT}/products?page=1&limit=10`);

  // Intenta parsear el JSON de forma segura
  let jsonBody = null;
  try {
    jsonBody = res.json();
  } catch (e) {
    // Si res.body no es un JSON válido (ej: error 500 en HTML/texto)
  }

  // Log temporal para identificar errores de la API en la consola
  if (res.status !== 200) {
    console.log(`[Error ${res.status}]: ${res.body}`);
  }

  check(res, {
    'status es 200': (r) => r.status === 200,
    'tiene data': () => {
      // Valida de forma segura la estructura esperada: jsonBody?.data?.length > 0
      return (
        jsonBody !== null &&
        Array.isArray(jsonBody.data) &&
        jsonBody.data.length > 0
      );
    },
  });

  sleep(1);
}