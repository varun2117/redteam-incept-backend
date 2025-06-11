import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

const app = express();

// Simple CORS configuration
app.use(cors({
  origin: true, // Allow all origins for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Root health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Red Team Backend API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    env: process.env.NODE_ENV || 'development'
  });
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint working',
    timestamp: new Date().toISOString()
  });
});

// Import and use routes with error handling
try {
  const healthRoutes = require('../src/routes/health').default;
  app.use('/api/health', healthRoutes);
} catch (error) {
  console.error('Error loading health routes:', error);
  app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'healthy', message: 'Fallback health check' });
  });
}

try {
  const assessmentRoutes = require('../src/routes/assessment').default;
  app.use('/api/assessment', assessmentRoutes);
} catch (error) {
  console.error('Error loading assessment routes:', error);
  app.get('/api/assessment/*', (req, res) => {
    res.status(503).json({ 
      success: false, 
      message: 'Assessment service temporarily unavailable',
      error: 'Routes failed to load'
    });
  });
}

try {
  const agentRoutes = require('../src/routes/agent').default;
  app.use('/api/agent', agentRoutes);
} catch (error) {
  console.error('Error loading agent routes:', error);
  app.get('/api/agent/*', (req, res) => {
    res.status(503).json({ 
      success: false, 
      message: 'Agent service temporarily unavailable',
      error: 'Routes failed to load'
    });
  });
}

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

export default app;