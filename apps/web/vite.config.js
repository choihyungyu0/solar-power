import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import climateRooftopAnalysisHandler from './api/climate-rooftop-analysis.ts';
import debugSelectBuldHandler from './api/debug-select-buld.ts';
import pvAnalysisHandler from './api/pv-analysis.ts';
import pvAnalysisHealthHandler from './api/pv-analysis-health.ts';

const MONTHLY_GENERATION_WEIGHTS = [0.072, 0.079, 0.092, 0.101, 0.107, 0.104, 0.097, 0.096, 0.087, 0.073, 0.049, 0.043];

function round(value, digits = 0) {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

function readNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createFallbackResult(input) {
  const panelCapacityW = readNumber(input?.solar_panel_info?.panel_capacity, 500);
  const panelCount = Math.max(1, Math.round(readNumber(input?.solar_panel_info?.panel_count, 204)));
  const installKw = round((panelCapacityW * panelCount) / 1000, 1);
  const annualGenerationKwh = Math.round(installKw * 1265);
  const firstYearSelfConsumptionSavingKrw = Math.round(annualGenerationKwh * 150);
  const carbonReductionKg = round(annualGenerationKwh * 0.4594, 1);

  return {
    annualGenerationKwh,
    installKw,
    firstYearTotalEconomicEffectKrw: firstYearSelfConsumptionSavingKrw,
    firstYearSelfConsumptionSavingKrw,
    estimatedInvestmentKrw: Math.round(firstYearSelfConsumptionSavingKrw * 6.8),
    estimatedSurplusSalesKrw: 0,
    carbonReductionKg,
    pineTreeEffect: round(carbonReductionKg / 6.6, 1),
    annualRevenueSeries: [],
    annualSaveCostSeries: [],
    monthlyGenerationSeries: MONTHLY_GENERATION_WEIGHTS.map((weight, index) => ({
      month: index + 1,
      generationKwh: round(annualGenerationKwh * weight, 1),
    })),
  };
}

function createSafeInput(input) {
  return {
    latitude: round(readNumber(input?.latitude), 6),
    longitude: round(readNumber(input?.longitude), 6),
    shadingIndexAverage: round(readNumber(input?.shading_index_average, 3.36), 2),
    solarPanelAngle: round(readNumber(input?.solar_panel_angle, 30), 1),
    panelCapacityW: Math.round(readNumber(input?.solar_panel_info?.panel_capacity, 500)),
    panelCount: Math.round(readNumber(input?.solar_panel_info?.panel_count, 204)),
    panelType: Math.round(readNumber(input?.solar_panel_info?.panel_type, 1)),
  };
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function createFallbackResponse(message, input) {
  return {
    ok: false,
    fallback: true,
    message,
    input: createSafeInput(input),
    result: createFallbackResult(input),
  };
}

async function sendFetchResponse(response, fetchResponse) {
  response.statusCode = fetchResponse.status;
  fetchResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  response.end(await fetchResponse.text());
}

async function createFetchRequest(request) {
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);
  const url = new URL(request.url || '/', 'http://localhost');

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}

function localApiPlugin() {
  return {
    name: 'solarmate-local-api',
    configureServer(server) {
      server.middlewares.use('/api/climate-rooftop-analysis', async (request, response) => {
        try {
          const fetchRequest = await createFetchRequest(request);
          const fetchResponse = await climateRooftopAnalysisHandler(fetchRequest);

          await sendFetchResponse(response, fetchResponse);
        } catch {
          sendJson(response, 200, {
            ok: false,
            source: 'climate.gg-live-hybrid',
            message: 'climate.gg 라이브 분석 로컬 프록시 처리에 실패했습니다.',
            fallbackRecommended: true,
            diagnostics: {},
          });
        }
      });

      server.middlewares.use('/api/debug-select-buld', async (request, response) => {
        try {
          const fetchRequest = await createFetchRequest(request);
          const fetchResponse = await debugSelectBuldHandler(fetchRequest);

          await sendFetchResponse(response, fetchResponse);
        } catch {
          sendJson(response, 200, {
            ok: false,
            source: 'climate.gg-live',
            message: 'debug-select-buld 로컬 프록시 처리에 실패했습니다.',
            diagnostics: {},
          });
        }
      });

      server.middlewares.use('/api/pv-analysis-health', async (request, response) => {
        try {
          const fetchRequest = await createFetchRequest(request);
          const fetchResponse = await pvAnalysisHealthHandler(fetchRequest);

          await sendFetchResponse(response, fetchResponse);
        } catch {
          sendJson(response, 200, { ok: true, route: 'pv-analysis' });
        }
      });

      server.middlewares.use('/api/pv-analysis', async (request, response) => {
        try {
          const fetchRequest = await createFetchRequest(request);
          const fetchResponse = await pvAnalysisHandler(fetchRequest);

          await sendFetchResponse(response, fetchResponse);
        } catch {
          sendJson(response, 200, createFallbackResponse('발전량 분석 로컬 프록시 처리에 실패해 데모 산식으로 표시합니다.', undefined));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
});
