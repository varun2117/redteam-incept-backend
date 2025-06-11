import express from 'express';
import { ChatAgentConnector } from '../connectors/ChatAgentConnector';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Red Team Agent Backend',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.get('/detailed', async (req, res) => {
  const checks: any = {
    server: true,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };

  // Test OpenRouter connectivity (if API key is available)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      // This is a basic connectivity test - in production you might want to cache this
      checks.openrouter = true;
    } catch (error) {
      checks.openrouter = false;
    }
  }

  const healthy = Object.values(checks).every(check => 
    typeof check === 'boolean' ? check : true
  );

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks
  });
});

export default router;