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

// Simple assessment endpoint without Prisma dependency initially
app.post('/api/assessment/test', (req, res) => {
  res.json({
    success: true,
    message: 'Assessment endpoint test',
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Lazy load routes to avoid Prisma initialization issues
app.use('/api/health', (req, res, next) => {
  try {
    const healthRoutes = require('../src/routes/health').default;
    healthRoutes(req, res, next);
  } catch (error) {
    console.error('Error loading health routes:', error);
    res.json({ success: true, status: 'healthy', message: 'Fallback health check' });
  }
});

app.use('/api/assessment', (req, res, next) => {
  // Skip test endpoint
  if (req.path === '/test') return next();
  
  try {
    const assessmentRoutes = require('../src/routes/assessment').default;
    assessmentRoutes(req, res, next);
  } catch (error) {
    console.error('Error loading assessment routes:', error);
    res.status(503).json({ 
      success: false, 
      message: 'Assessment service temporarily unavailable',
      error: 'Prisma client not ready'
    });
  }
});

app.use('/api/agent', (req, res, next) => {
  try {
    const agentRoutes = require('../src/routes/agent').default;
    agentRoutes(req, res, next);
  } catch (error) {
    console.error('Error loading agent routes:', error);
    res.status(503).json({ 
      success: false, 
      message: 'Agent service temporarily unavailable',
      error: 'Prisma client not ready'
    });
  }
});

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