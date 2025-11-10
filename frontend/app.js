// Production worker URL
const API_BASE = 'https://smart-weather-planner.adarshzebra.workers.dev';

function byId(id){return document.getElementById(id)}
const out = byId('output');

async function post(path, body){
  try {
    console.debug('POST', API_BASE + path, body);
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    // Try parse JSON, otherwise return text
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; } catch(e){ return { ok: res.ok, status: res.status, data: text }; }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

byId('saveState').addEventListener('click', async ()=>{
  const body = { userId: byId('userId').value, city: byId('city').value, lat: Number(byId('lat').value), lon: Number(byId('lon').value) };
  // build structured prefs from the new UI controls
  const prefs = {
    preferredTimes: {
      morning: !!byId('prefMorning').checked,
      evening: !!byId('prefEvening').checked
    },
    maxTemperatureF: Number(byId('prefMaxTemp').value) || 0,
    avoidWind: !!byId('prefAvoidWind').checked,
    activities: (byId('prefActivities').value || '').split(',').map(s=>s.trim()).filter(Boolean)
  };
  body.prefs = prefs;
  out.textContent = 'Saving...';
  const r = await post('/state', body);
  if (!r.ok) {
    out.textContent = `Save failed: ${r.error || ('status ' + r.status)}`;
    console.error('Save state error', r);
    return;
  }
  // show friendly saved message and the state
  out.textContent = 'Saved state:\n' + JSON.stringify(r.data, null, 2);
});

byId('getPlan').addEventListener('click', async ()=>{
  // include current prefs in the plan request so the AI sees UI values even without saving
  const activities = (byId('prefActivities').value || '').split(',').map(s => s.trim()).filter(Boolean);
  console.log('Activities from input:', activities);
  
  // Only include temperature preferences if they were actually entered
  const maxTemp = byId('prefMaxTemp').value;
  const minTemp = byId('prefMinTemp').value;
  
  const prefs = {
    preferredTimes: { 
      morning: !!byId('prefMorning').checked, 
      evening: !!byId('prefEvening').checked 
    },
    avoidWind: !!byId('prefAvoidWind').checked,
    activities: activities
  };

  // Only add temperature preferences if they were entered
  if (maxTemp) prefs.maxTemperatureF = Number(maxTemp);
  if (minTemp) prefs.minTemperatureF = Number(minTemp);
  // Build a natural question from the activities
  const activityList = prefs.activities || [];
  let question = '';
  if (activityList.length === 0) {
    question = 'Plan my week with some outdoor activities';
  } else if (activityList.length === 1) {
    question = `Plan my week with some ${activityList[0]} sessions`;
  } else {
    const last = activityList[activityList.length - 1];
    const rest = activityList.slice(0, -1);
    question = `Plan my week with some ${rest.join(', ')} and ${last} sessions`;
  }
  console.log('Generated question:', question);

  const body = { 
    userId: byId('userId').value,
    city: byId('city').value,
    lat: Number(byId('lat').value),
    lon: Number(byId('lon').value),
    question,
    prefs,
    units: 'F'
  };
  out.textContent = 'Planning...';
  const r = await post('/plan', body);
  if (!r.ok) {
    // Show detailed error information if the server returned JSON with details
    let msg = r.error || ('status ' + r.status);
    try {
      if (r.data && typeof r.data === 'object') {
        if (r.data.details) msg = `${msg} - ${r.data.details}`;
        else msg = `${msg} - ${JSON.stringify(r.data)}`;
      } else if (r.data) {
        msg = `${msg} - ${r.data}`;
      }
    } catch (e) {
      // ignore
    }
    out.textContent = `Planning failed: ${msg}`;
    console.error('Plan error', r);
    return;
  }

  // If the response contains a plan field, show it nicely and surface structured details
  if (r.data && typeof r.data === 'object' && r.data.plan) {
    let text = r.data.plan;

    // Enhance the display of precipitation conditions
    text = text.replace(/\|(\s*\d+(?:\.\d+)?%\s*)\|/g, (match, precip) => {
      const pct = parseFloat(precip);
      if (pct > 30) {
        return `| 🌧️ ${precip}|`;
      }
      return match;
    });

    // Add color coding for temperature ranges
    text = text.replace(/\|(\s*\d+(?:\.\d+)?°F\s*)\|/g, (match, temp) => {
      const t = parseFloat(temp);
      if (t <= 32) return `| ❄️ ${temp}|`;
      if (t >= 85) return `| 🌡️ ${temp}|`;
      return match;
    });

    // If the Worker returned a structured JSON plan, pretty-print it below
    if (r.data.structured) {
      text += '\n\nStructured plan:\n' + JSON.stringify(r.data.structured, null, 2);
    }

    // If the Worker returned details (prefs/forecast), show them too for debugging/clarity
    if (r.data.details) {
      text += '\n\nDetails:\n' + JSON.stringify(r.data.details, null, 2);
    }

    out.textContent = text;
  } else {
    out.textContent = JSON.stringify(r.data, null, 2);
  }
});
