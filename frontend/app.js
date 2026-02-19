// Production worker URL
const API_BASE = 'https://smart-weather-planner.adarshzebra.workers.dev';

function byId(id) { return document.getElementById(id) }
const out = byId('output');
const statusMsg = byId('statusMsg');

function showStatus(msg, type = 'success') {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg ${type}`;
  setTimeout(() => {
    statusMsg.className = 'status-msg';
  }, 5000);
}

function setLoading(isLoading, btnId, originalText) {
  const btn = byId(btnId);
  if (isLoading) {
    btn.disabled = true;
    btn.textContent = 'Processing...';
  } else {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

byId('useLocation').addEventListener('click', async () => {
  const btnId = 'useLocation';
  const originalText = byId(btnId).textContent;

  if (!navigator.geolocation) {
    showStatus('Geolocation is not supported by your browser', 'error');
    return;
  }

  setLoading(true, btnId, originalText);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      byId('lat').value = position.coords.latitude.toFixed(4);
      byId('lon').value = position.coords.longitude.toFixed(4);

      // Issue 3: Reverse geocoding
      showStatus('Location found! Fetching city name...', 'success');
      fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&localityLanguage=en`)
        .then(res => res.json())
        .then(data => {
          if (data.city || data.locality) {
            byId('city').value = data.city || data.locality;
            showStatus(`Location found! City set to ${data.city || data.locality}`, 'success');
          } else {
            showStatus('Location found! (City lookup failed)', 'success');
          }
        })
        .catch(() => {
          showStatus('Location found! (City lookup network error)', 'success');
        })
        .finally(() => {
          setLoading(false, btnId, originalText);
        });
    },
    (error) => {
      setLoading(false, btnId, originalText);
      let msg = 'Unable to retrieve location';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          msg = 'Location access denied. Please enable permissions.';
          break;
        case error.POSITION_UNAVAILABLE:
          msg = 'Location information is unavailable.';
          break;
        case error.TIMEOUT:
          msg = 'The request to get user location timed out.';
          break;
      }
      showStatus(msg, 'error');
    }
  );
});

async function post(path, body) {
  try {
    console.debug('POST', API_BASE + path, body);
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    // Try parse JSON, otherwise return text
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; } catch (e) { return { ok: res.ok, status: res.status, data: text }; }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

byId('saveState').addEventListener('click', async () => {
  const btnId = 'saveState';
  const originalText = byId(btnId).textContent;
  setLoading(true, btnId, originalText);

  const body = { userId: byId('userId').value, city: byId('city').value, lat: Number(byId('lat').value), lon: Number(byId('lon').value) };
  // build structured prefs from the new UI controls
  const prefs = {
    preferredTimes: {
      morning: !!byId('prefMorning').checked,
      afternoon: !!byId('prefAfternoon').checked,
      evening: !!byId('prefEvening').checked
    },
    maxTemperatureF: Number(byId('prefMaxTemp').value) || 0,
    avoidWind: !!byId('prefAvoidWind').checked,
    avoidRain: !!byId('prefAvoidRain').checked,
    avoidSnow: !!byId('prefAvoidSnow').checked,
    activities: (byId('prefActivities').value || '').split(',').map(s => s.trim()).filter(Boolean)
  };
  body.prefs = prefs;

  const r = await post('/state', body);
  setLoading(false, btnId, originalText);

  if (!r.ok) {
    showStatus(`Save failed: ${r.error || ('status ' + r.status)}`, 'error');
    console.error('Save state error', r);
    return;
  }

  showStatus('Preferences saved successfully!', 'success');
  console.log('Saved state:', r.data);
});

byId('getPlan').addEventListener('click', async () => {
  const btnId = 'getPlan';
  const originalText = byId(btnId).textContent;
  setLoading(true, btnId, originalText);
  out.innerHTML = '<div class="output-placeholder">Generating your plan...</div>';

  // include current prefs in the plan request so the AI sees UI values even without saving
  const activities = (byId('prefActivities').value || '').split(',').map(s => s.trim()).filter(Boolean);
  console.log('Activities from input:', activities);

  // Only include temperature preferences if they were actually entered
  const maxTemp = byId('prefMaxTemp').value;
  const minTemp = byId('prefMinTemp').value;

  const prefs = {
    preferredTimes: {
      morning: !!byId('prefMorning').checked,
      afternoon: !!byId('prefAfternoon').checked,
      evening: !!byId('prefEvening').checked
    },
    avoidWind: !!byId('prefAvoidWind').checked,
    avoidRain: !!byId('prefAvoidRain').checked,
    avoidSnow: !!byId('prefAvoidSnow').checked,
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

  const r = await post('/plan', body);
  setLoading(false, btnId, originalText);

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
    showStatus(`Planning failed: ${msg}`, 'error');
    out.innerHTML = `<div class="output-placeholder" style="color:var(--error-color)">Failed to generate plan. Please try again.</div>`;
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

    out.textContent = text;
  } else {
    out.textContent = JSON.stringify(r.data, null, 2);
  }
});
