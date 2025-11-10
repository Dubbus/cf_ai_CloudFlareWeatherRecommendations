// Smart Weather Planner — Worker entry (Fahrenheit, facts-grounded, indoorOnly)
// ---------------------------------------------------------------------------

import { DurableObject } from "cloudflare:workers"; // for editor intellisense/types
import { MyDurableObject } from "./user_state.js";  // your DO implementation
export { MyDurableObject };                         // re-export so Wrangler can bind it

// -------------------- CORS & utils --------------------
const inMemoryCache = new Map();

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}

function json(data, status = 200) {
  const headers = Object.assign({ "content-type": "application/json" }, corsHeaders());
  return new Response(JSON.stringify(data), { status, headers });
}

async function cloneWithCors(res) {
  const headers = new Headers(res.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  const body = await res.arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

const isFiniteNum = (v) => Number.isFinite(Number(v));

// Convert Celsius -> Fahrenheit (one decimal)
const cToF = (c) => {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n * (9 / 5)) + 32) * 10) / 10;
};

// -------------------- Forecast helpers --------------------
// Pull Fahrenheit directly from Open-Meteo to avoid unit drift.
async function getForecast(env, lat, lon, days = 7) {
  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${days}:F`;
  const ttl = Number(env.CACHE_TTL_SECONDS) || 5400;

  // Try KV if available
  try {
    if (env.FORECAST_CACHE && typeof env.FORECAST_CACHE.get === "function") {
      const cached = await env.FORECAST_CACHE.get(key);
      if (cached) {
        console.log('Using cached forecast data');
        return JSON.parse(cached);
      }
    }
  } catch (e) {
    console.warn('Cache access failed:', e);
  }

  // In-memory fallback
  if (inMemoryCache.has(key)) {
    console.log('Using in-memory cached forecast data');
    return inMemoryCache.get(key);
  }

  console.log('Building forecast URL with:', { lat, lon, days });
  
  const url = new URL(env.WEATHER_API_BASE || "https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("past_days", "0");
  url.searchParams.set("forecast_days", String(days));

  const fullUrl = url.toString();
  console.log('Fetching weather from:', fullUrl);

  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.error('Invalid coordinates:', { lat, lon });
      throw new Error(`Invalid coordinates: lat=${lat}, lon=${lon}`);
    }

    console.log(`Fetching forecast for lat=${lat}, lon=${lon}, days=${days}`);
    const res = await fetch(url.toString());
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Weather API error:', { status: res.status, body: errorText });
      throw new Error(`Weather API error: ${res.status} - ${errorText}`);
    }
    
    const data = await res.json();
    console.log('Weather API response:', data);
    console.log('API response:', JSON.stringify(data, null, 2));
    
    // Validate response shape
    if (!data || !data.hourly || !Array.isArray(data.hourly.time) || !Array.isArray(data.hourly.temperature_2m)) {
      console.error('Invalid API response shape:', data);
      throw new Error('Invalid forecast response shape: missing hourly data');
    }

    // Validate we have some data
    if (data.hourly.time.length === 0 || data.hourly.temperature_2m.length === 0) {
      console.error('Empty arrays in API response:', {
        timeLength: data.hourly.time.length,
        tempLength: data.hourly.temperature_2m.length
      });
      throw new Error('Empty forecast data received');
    }

    try {
      if (env.FORECAST_CACHE && typeof env.FORECAST_CACHE.put === "function") {
        await env.FORECAST_CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
      } else {
        inMemoryCache.set(key, data);
        setTimeout(() => inMemoryCache.delete(key), ttl * 1000);
      }
    } catch (_) {
      inMemoryCache.set(key, data);
    }

    return data;
  } catch (err) {
    console.error('Forecast fetch error:', err);
    return { hourly: { time: [], temperature_2m: [], precipitation_probability: [] } };
  }
}

function slimForecastF(data) {
  // Debug logging
  console.log('Raw forecast data:', JSON.stringify(data, null, 2));
  
  const hourly = data && data.hourly ? data.hourly : {};
  if (!hourly.time || !hourly.temperature_2m) {
    console.error('Missing hourly data:', hourly);
    return {
      dates: [],
      tmax: [],
      tmin: [],
      precip: []
    };
  }
  
  const dates = hourly.time;
  console.log(`Processing ${dates.length} hourly timestamps`);
  
  // Group hourly data by day
  const dayMap = new Map();
  for (let i = 0; i < dates.length; i++) {
    const timestamp = dates[i];
    const temp = Number(hourly.temperature_2m[i]);
    const precip = Number(hourly.precipitation_probability[i]);
    
    const date = new Date(timestamp);
    const dateStr = date.toISOString().split('T')[0];
    
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, {
        temps: [],
        precips: [],
        date: dateStr
      });
    }
    
    const dayData = dayMap.get(dateStr);
    if (Number.isFinite(temp)) dayData.temps.push(temp);
    if (Number.isFinite(precip)) dayData.precips.push(precip);
  }

  console.log(`Grouped into ${dayMap.size} days`);

  // Convert to daily metrics
  const dailyDates = [...dayMap.keys()].sort();
  const result = {
    dates: dailyDates,
    tmax: dailyDates.map(d => {
      const temps = dayMap.get(d).temps;
      return temps.length ? Math.max(...temps) : null;
    }),
    tmin: dailyDates.map(d => {
      const temps = dayMap.get(d).temps;
      return temps.length ? Math.min(...temps) : null;
    }),
    precip: dailyDates.map(d => {
      const precips = dayMap.get(d).precips;
      return precips.length ? precips.reduce((a,b) => a + b, 0) / precips.length : null;
    })
  };

  console.log('Processed forecast:', JSON.stringify(result, null, 2));
  return result;
}

// Deterministic fallback plan (uses only facts)
function buildSafePlanFromFacts(facts, suitableIdxs) {
  const rows = suitableIdxs.slice(0, 5).map(i => {
    const f = facts[i];
    const max = Number.isFinite(f.tmaxF) ? `${f.tmaxF}°F` : "N/A";
    const min = Number.isFinite(f.tminF) ? `${f.tminF}°F` : "N/A";
    const p   = Number.isFinite(f.precipPct) ? `${f.precipPct}%` : "N/A";
    return `| ${f.date} | 7:00 AM - 9:00 AM | Max ${max} / Min ${min}, precip ${p} |`;
  });

  const table =
`### Recommended Outdoor Time Windows

| Date | Time | Reason |
| --- | --- | --- |
${rows.join("\n")}

### Indoor Backup Options

- Visit a local museum or gallery
- Indoor treadmill / climbing gym

### Weekly Summary

Based on the forecast (exact values shown above), these are the best windows matching your preferences.`;

  return table;
}

// -------------------- Worker --------------------
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return new Response("ok", { headers: Object.assign({ "content-type": "text/plain" }, corsHeaders()) });
    }

    if (request.method === "GET" && (path === "/" || path === "")) {
      const body = `<!doctype html><html><body style="font-family:system-ui,Arial;padding:24px;">
<h2>Smart Weather Planner — Worker</h2>
<p>API endpoints: <code>GET /health</code>, <code>POST /state</code>, <code>POST /plan</code>.</p>
</body></html>`;
      return new Response(body, { headers: Object.assign({ "content-type": "text/html; charset=utf-8" }, corsHeaders()) });
    }

    // Persist/merge user state via Durable Object
    if (request.method === "POST" && path === "/state") {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const userId = body.userId || "demo-user-1";
      const id = env.MY_DURABLE_OBJECT.idFromName(userId);
      const stub = env.MY_DURABLE_OBJECT.get(id);
      const res = await stub.fetch("https://do/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return await cloneWithCors(res);
    }

    // Plan endpoint
    if (request.method === "POST" && path === "/plan") {
      try {
        let body = {};
        try { 
          const text = await request.text();
          console.log('Raw request body:', text);
          body = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse request body:', e);
        }
        
        console.log('Parsed request body:', JSON.stringify(body, null, 2));
        
        const userId    = body.userId || "demo-user-1";
        const city      = body.city;
        const lat       = Number(body.lat || 0);
        const lon       = Number(body.lon || 0);
        const days      = Number(body.days || 7);
        const question  = body.question || "Plan my week for two runs and a picnic.";
        const indoorOnly = Boolean(body.indoorOnly);
        
        console.log('Planning request:', {
          userId, city, lat, lon, days, indoorOnly,
          prefs: body.prefs || {}
        });

        // Update DO state and get merged state
        const id = env.MY_DURABLE_OBJECT.idFromName(userId);
        const stub = env.MY_DURABLE_OBJECT.get(id);
        const stateRes = await stub.fetch("https://do/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, city, lat, lon, prefs: body.prefs || {} }),
        });
        const mergedState = await stateRes.json().catch(() => ({ city, lat, lon, prefs: body.prefs || {} }));

        // ---------- Validation ----------
        const validation = [];
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) validation.push("Latitude/longitude out of range.");
        if (validation.length) return json({ error: "VALIDATION_ERROR", messages: validation }, 400);

        // Indoor-only early exit
        if (indoorOnly) {
          if (!env.AI || typeof env.AI.run !== "function") {
            const indoor =
              `### Indoor Options (Only)\n\n` +
              `- Visit a local museum or gallery\n` +
              `- Indoor treadmill / climbing gym\n` +
              `- Aquatic center / indoor pool\n` +
              `- Public library maker space or study session\n\n` +
              `### Note\nRequested indoor-only plan. Outdoor windows intentionally omitted.`;
            return json({ plan: indoor, indoorOnly: true, city: mergedState.city || city || "" });
          }

          const systemMsgIndoor =
            "You are an activity planner. Return **indoor-only** options tailored to the city and user preferences. " +
            "Do NOT include outdoor time windows. Provide 3–6 specific suggestions with brief reasons and " +
            "addresses/neighborhoods when possible. End with a 2–3 sentence summary. Output Markdown only.";

          const userMsgIndoor =
            `City: ${mergedState.city || city || "unknown"}\n` +
            `Prefs: ${JSON.stringify(mergedState.prefs || {})}\n` +
            `Question: ${question || "indoor ideas only"}`;

          const aiModel = env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
          try {
            const resp = await env.AI.run(aiModel, {
              messages: [
                { role: "system", content: systemMsgIndoor },
                { role: "user", content: userMsgIndoor },
              ],
              temperature: 0.4,
              max_tokens: 600,
            });
            const out = resp?.response || resp?.output || JSON.stringify(resp);
            return json({ plan: out, indoorOnly: true, city: mergedState.city || city || "" });
          } catch (e) {
            const indoor =
              `### Indoor Options (Only)\n\n` +
              `- Visit a local museum or gallery\n` +
              `- Indoor treadmill / climbing gym\n` +
              `- Aquatic center / indoor pool\n` +
              `- Public library maker space or study session\n\n` +
              `### Note\nLLM error: ${String(e?.message || e)}. Showing a deterministic fallback.`;
            return json({ plan: indoor, indoorOnly: true, city: mergedState.city || city || "" });
          }
        }

        // ---------- Forecast (detect units and normalize to Fahrenheit) ----------
        const forecastRaw = await getForecast(env, mergedState.lat || lat, mergedState.lon || lon, days);

        // Detect units reported by the weather API (Open-Meteo provides hourly_units)
        const reportedUnit = (forecastRaw && forecastRaw.hourly_units && forecastRaw.hourly_units.temperature_2m) || null;
        console.log('API reported temperature unit:', reportedUnit);
        const reportedIsC = reportedUnit && String(reportedUnit).toLowerCase().includes('c');

        // Build a slim forecast object from the raw data
        const slimRaw = slimForecastF(forecastRaw); // may contain °C or °F depending on API

        // If API reported Celsius, convert values to Fahrenheit for internal comparisons and output
        const slimF = {
          dates: slimRaw.dates.slice(),
          tmax: slimRaw.tmax.map(v => (reportedIsC ? cToF(v) : Number(v))),
          tmin: slimRaw.tmin.map(v => (reportedIsC ? cToF(v) : Number(v))),
          precip: slimRaw.precip.slice(),
        };

        // Build facts array (model must only use these numbers)
        const facts = (slimF.dates || []).map((d, i) => ({
          date: d,
          tmaxF: Number(slimF.tmax?.[i]),
          tminF: Number(slimF.tmin?.[i]),
          precipPct: Number(slimF.precip?.[i]),
        }));

        // ---------- Preferences (normalize to °F) ----------
        const prefsIn = Object.assign({}, mergedState.prefs || {});
        const prefsF = { ...prefsIn };

        // Accept user °F inputs if numeric
        if (isFiniteNum(prefsF.maxTemperatureF)) prefsF.maxTemperatureF = Number(prefsF.maxTemperatureF);
        if (isFiniteNum(prefsF.minTemperatureF)) prefsF.minTemperatureF = Number(prefsF.minTemperatureF);

        // Ensure min ≤ max
        if (isFiniteNum(prefsF.maxTemperatureF) && isFiniteNum(prefsF.minTemperatureF)
          && prefsF.maxTemperatureF < prefsF.minTemperatureF) {
          const tmp = prefsF.maxTemperatureF; prefsF.maxTemperatureF = prefsF.minTemperatureF; prefsF.minTemperatureF = tmp;
        }

        const precipThreshold = isFiniteNum(prefsIn.maxPrecipPercent)
          ? Math.max(0, Math.min(100, Number(prefsIn.maxPrecipPercent)))
          : 50;

        // More validation now that prefs are normalized
        const validation2 = [];
        if (isFiniteNum(prefsF.maxTemperatureF) && prefsF.maxTemperatureF > 150) validation2.push("Max temperature > 150°F is not realistic.");
        if (isFiniteNum(prefsF.minTemperatureF) && prefsF.minTemperatureF < -100) validation2.push("Min temperature < -100°F is not realistic.");
        if (isFiniteNum(prefsF.maxTemperatureF) && isFiniteNum(prefsF.minTemperatureF)
          && (prefsF.maxTemperatureF - prefsF.minTemperatureF) < 5) {
          validation2.push("Temperature range < 5°F is very narrow and may yield no options.");
        }
        if (validation2.length) return json({ error: "VALIDATION_ERROR", messages: validation2 }, 400);

        // Human-friendly prefs lines for the prompt
        const prefLines = [];
        if (isFiniteNum(prefsF.maxTemperatureF)) prefLines.push(`Max temperature: ${prefsF.maxTemperatureF}°F`);
        if (isFiniteNum(prefsF.minTemperatureF)) prefLines.push(`Min temperature: ${prefsF.minTemperatureF}°F`);
        if (prefsF.avoidWind) prefLines.push(`Avoid wind: true`);
        if (prefsF.preferredTimes && typeof prefsF.preferredTimes === "object") {
          const times = [];
          if (prefsF.preferredTimes.morning) times.push("morning");
          if (prefsF.preferredTimes.evening) times.push("evening");
          if (times.length) prefLines.push(`Preferred times: ${times.join(", ")}`);
        }
        if (Array.isArray(prefsF.activities) && prefsF.activities.length) {
          prefLines.push(`Activities: ${prefsF.activities.join(", ")}`);
        }
        if (precipThreshold !== 50) prefLines.push(`Max precipitation chance: ${precipThreshold}%`);

        // ---------- Deterministic pre-check (°F) ----------
        const dates = slimF.dates || [];
        if (!dates.length || !slimF.tmax.length || !slimF.tmin.length) {
          return json({ 
            error: "FORECAST_ERROR", 
            detail: "No forecast data available. Response shape: " + JSON.stringify({
              dates: dates.length,
              maxTemps: slimF.tmax.length,
              minTemps: slimF.tmin.length
            })
          }, 500);
        }

        const suitableIndices = [];
        for (let i = 0; i < dates.length; i++) {
          let ok = true;
          const dayMax = Number(slimF.tmax[i]);
          const dayMin = Number(slimF.tmin[i]);
          const dayPrecip = Number(slimF.precip[i]);

          if (isFiniteNum(prefsF.maxTemperatureF) && isFiniteNum(dayMax) && dayMax > prefsF.maxTemperatureF) ok = false;
          if (isFiniteNum(prefsF.minTemperatureF) && isFiniteNum(dayMin) && dayMin < prefsF.minTemperatureF) ok = false;
          if (isFiniteNum(dayPrecip) && dayPrecip > precipThreshold) ok = false;

          if (ok) suitableIndices.push(i);
        }

        if (!suitableIndices.length) {
          const msg = `No suitable outdoor windows found for the next ${dates.length} days given your preferences. Consider widening your temperature range or increasing max precipitation tolerance.`;
          return json({ plan: msg, noSuitable: true, details: { prefsF, forecastF: slimF } }, 200);
        }

        // ---------- AI call (Workers AI) ----------
        if (!env.AI || typeof env.AI.run !== "function") {
          return json({ error: "AI binding not available. Configure AI binding in wrangler.jsonc." }, 500);
        }

        // Strongly-typed prompt: ask the model to print human-friendly Markdown
        // followed by a single-line JSON object (on its own line) that matches the schema
        // so the Worker can parse it deterministically.
        const systemMsg =
          "You are an outdoor activity planner. Use Fahrenheit (°F) for all temperatures.\n" +
          "Produce two outputs:\n" +
          "1. A concise Markdown plan with a table showing recommended times and a brief summary.\n" +
          "   - Only include indoor backup options if more than 50% of the days have unsuitable weather\n" +
          "   - For each time slot, indicate if there's rain/snow expected (when precipitation > 30%)\n" +
          "2. On a new line, output this exact JSON schema:\n" +
          '{\n  "recommendations": [{\n' +
          '    "date": "YYYY-MM-DD",\n' +
          '    "start": "HH:MM",\n' +
          '    "end": "HH:MM",\n' +
          '    "activity": "string",\n' +
          '    "tempF": number,\n' +
          '    "precipPct": number,\n' +
          '    "conditions": "clear|rain|snow"\n' +
          '  }],\n' +
          '  "indoorOptions": ["string"],\n' +
          '  "summary": "string",\n' +
          '  "noSuitable": false\n' +
          '}\n' +
          "- Set conditions to 'snow' if tempF ≤ 32 and precipPct > 30%\n" +
          "- Set conditions to 'rain' if tempF > 32 and precipPct > 30%\n" +
          "- Set conditions to 'clear' otherwise\n" +
          "- Only include indoorOptions if suggesting indoor alternatives\n" +
          "Only use numbers from facts array or user preferences. Place JSON on its own line.";

        const userMsg =
          `City: ${mergedState.city || city || "unknown"}\n` +
          `Prefs (°F unless noted):\n${prefLines.join("\n")}\n` +
          `Question: ${question}\n` +
          `facts: ${JSON.stringify(facts)}`;

        const aiModel = env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
        let planText = "";

        try {
          const aiResp = await env.AI.run(aiModel, {
            messages: [
              { role: "system", content: systemMsg },
              { role: "user", content: userMsg },
            ],
            temperature: 0.2,
            max_tokens: 900,
          });

          planText = aiResp?.output
            ? String(aiResp.output)
            : (aiResp?.response || aiResp?.result || JSON.stringify(aiResp));

          if (Array.isArray(planText) && planText.length) planText = String(planText[0]);
        } catch (aiErr) {
          return json({ error: "AI.run failed", details: String(aiErr && (aiErr.message || aiErr)) }, 500);
        }

        // Try to extract the JSON object emitted by the model. Model is asked to place
        // a single JSON object on its own line after the Markdown. We'll search for the
        // last '{' in the output and attempt to parse from there to the end.
        let parsedPlan = null;
        try {
          for (let pos = planText.lastIndexOf('{'); pos >= 0; pos = planText.lastIndexOf('{', pos - 1)) {
            const candidate = planText.slice(pos);
            try {
              const obj = JSON.parse(candidate);
              // Basic schema check: must have recommendations array or noSuitable
              if (obj && (Array.isArray(obj.recommendations) || obj.noSuitable !== undefined)) {
                parsedPlan = obj;
                break;
              }
            } catch (_) {
              // ignore parse errors and continue searching earlier '{'
            }
          }
        } catch (e) {
          // ignore
        }

        // ---------- Post-check: reject temps not in facts ----------
        // Allow-listed temperatures: include exact forecast tmax/tmin values
        // and also include the user's preference bounds (max/min) so the AI can
        // mention the user's requested values without being treated as a fabricated forecast number.
        const factsTemps = facts
          .flatMap(f => [f.tmaxF, f.tminF])
          .filter(n => Number.isFinite(n))
          .map(n => Math.round(n * 10) / 10);
        const prefTemps = [];
        if (isFiniteNum(prefsF.maxTemperatureF)) prefTemps.push(Math.round(Number(prefsF.maxTemperatureF) * 10) / 10);
        if (isFiniteNum(prefsF.minTemperatureF)) prefTemps.push(Math.round(Number(prefsF.minTemperatureF) * 10) / 10);
        const allowedTemps = new Set([...factsTemps, ...prefTemps]);
        const badTemps = [];
        const tempRegex = /(-?\d+(?:\.\d+)?)\s*°F/gi;
        let m;
        while ((m = tempRegex.exec(planText)) !== null) {
          const n = Math.round(Number(m[1]) * 10) / 10;
          if (!allowedTemps.has(n)) badTemps.push(n);
        }
        if (badTemps.length) {
          const unique = [...new Set(badTemps)].join(", ");
          const safe = buildSafePlanFromFacts(facts, suitableIndices);
          planText =
            `**Note:** Detected temperatures not present in the forecast (${unique} °F). ` +
            `Showing a corrected plan using only exact forecast values.\n\n${safe}`;
        }

  // Return the human plan text and include any parsed structured JSON the model emitted
  const respPayload = { plan: planText, city: mergedState.city || city || "", details: { prefsF, forecastF: slimF, reportedUnit: reportedUnit || null } };
  if (parsedPlan) respPayload.structured = parsedPlan;
  return json(respPayload);
      } catch (err) {
        return json({ error: "PLAN_ERROR", detail: String(err?.message || err) }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};
