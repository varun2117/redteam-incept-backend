import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Simple health check
  if (req.url === '/' || req.url === '/health') {
    return res.status(200).json({
      success: true,
      message: 'Red Team Backend API is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      method: req.method,
      url: req.url
    });
  }

  // Test endpoint
  if (req.url === '/test') {
    return res.status(200).json({
      success: true,
      message: 'Test endpoint working',
      method: req.method,
      headers: req.headers,
      body: req.body,
      timestamp: new Date().toISOString()
    });
  }

  // Environment check
  if (req.url === '/env') {
    return res.status(200).json({
      success: true,
      environment: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        hasDatabase: !!process.env.DATABASE_URL,
        hasLangfuse: !!process.env.LANGFUSE_SECRET_KEY,
        platform: 'vercel'
      },
      timestamp: new Date().toISOString()
    });
  }

  // 404 for other routes
  return res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.url,
    timestamp: new Date().toISOString()
  });
}