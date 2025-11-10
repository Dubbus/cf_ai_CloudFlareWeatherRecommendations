# Smart Weather Planner 

A smart activity planner that uses real-time weather data to suggest optimal times for outdoor activities. Built with modern web technologies and AI-powered recommendations.

## Features 

- **Weather-Aware Planning**: Suggests optimal times for outdoor activities based on weather conditions
- **AI-Powered Recommendations**: Uses AI to create personalized activity schedules
- **Real-Time Weather Data**: Integrates with Open-Meteo API for accurate hourly forecasts
- **Smart Conditions Detection**: Automatically detects and warns about rain, snow, or extreme temperatures
- **Customizable Preferences**: Set your preferred:
  - Temperature ranges (°F)
  - Time of day (morning/evening)
  - Activity types
  - Weather conditions to avoid

## Quick Review Setup 

Check out the live demo:
https://yourusername.github.io/cwta/

If you prefer to run it locally:

```bash
# Clone the repository
git clone https://github.com/yourusername/cwta.git
cd cwta

# Start the frontend (in one terminal)
cd frontend
npm install
npm start

# Start the worker (in another terminal)
cd worker
npm install
npm run dev
```

Then open http://127.0.0.1:8787 in your browser.

## Future Enhancements 

With more time, I would add:
1. User accounts and saved preferences
2. Calendar integration
3. Mobile app version
4. Additional weather data sources
5. Activity-specific recommendations

Feel free to reach out with any questions!
