import { VercelRequest, VercelResponse } from '@vercel/node';
import { RedTeamAgent } from '../src/services/RedTeamAgent';
import { ChatAgentConnector, ConnectionConfig } from '../src/connectors/ChatAgentConnector';

// In-memory storage for active assessments (for serverless)
const activeAssessments = new Map<string, any>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Root endpoint
    if (url === '/' || url === '/api') {
      return res.status(200).json({
        success: true,
        message: 'Red Team Backend API is running on Vercel',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        method: method,
        url: url,
        environment: process.env.NODE_ENV || 'development'
      });
    }

    // Health check
    if (url === '/health' || url === '/api/health') {
      return res.status(200).json({
        success: true,
        status: 'healthy',
        message: 'API is running normally',
        timestamp: new Date().toISOString(),
        checks: {
          api: 'ok',
          database: process.env.DATABASE_URL ? 'configured' : 'not configured',
          langfuse: process.env.LANGFUSE_SECRET_KEY ? 'configured' : 'not configured'
        }
      });
    }

    // Assessment start endpoint
    if (url === '/api/assessment/start' && method === 'POST') {
      const { targetName, targetDescription, chatAgentUrl, openrouterApiKey, selectedModel, userId } = req.body;

      if (!targetName || !chatAgentUrl || !openrouterApiKey || !selectedModel) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: targetName, chatAgentUrl, openrouterApiKey, selectedModel'
        });
      }

      const assessmentId = require('crypto').randomUUID();
      
      // Store assessment as running
      activeAssessments.set(assessmentId, {
        id: assessmentId,
        status: 'running',
        startTime: new Date(),
        progress: {
          phase: 'discovery',
          progress: 0,
          tests_completed: 0,
          vulnerabilities_found: 0,
          message: 'Assessment started via serverless backend'
        },
        targetName,
        targetDescription,
        chatAgentUrl,
        openrouterApiKey,
        selectedModel,
        userId
      });

      // Start real assessment asynchronously
      setTimeout(async () => {
        await runRealAssessment(assessmentId, targetName, targetDescription, chatAgentUrl, openrouterApiKey, selectedModel, userId);
      }, 100); // Start immediately

      return res.status(200).json({
        success: true,
        assessmentId,
        message: 'Assessment started successfully',
        chatAgentConnection: {
          url: chatAgentUrl,
          status: 'connected'
        }
      });
    }

    // Assessment status endpoint
    if (url.startsWith('/api/assessment/') && url.endsWith('/status') && method === 'GET') {
      const assessmentId = url.split('/')[3];
      const assessment = activeAssessments.get(assessmentId);

      if (!assessment) {
        return res.status(404).json({
          success: false,
          message: 'Assessment not found'
        });
      }

      return res.status(200).json({
        success: true,
        assessment: {
          id: assessment.id,
          status: assessment.status,
          startTime: assessment.startTime,
          progress: assessment.progress,
          totalTests: assessment.totalTests || 0,
          vulnerabilities: assessment.vulnerabilities || 0,
          securityScore: assessment.securityScore || 0,
          findings: assessment.findings || [],
          results: assessment.results || null
        }
      });
    }

    // Test endpoint
    if (url === '/test' || url === '/api/test') {
      return res.status(200).json({
        success: true,
        message: 'Test endpoint working perfectly',
        data: {
          method: method,
          headers: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type']
          },
          body: req.body || null,
          query: req.query || {},
          timestamp: new Date().toISOString()
        }
      });
    }

    // Environment info (for debugging)
    if (url === '/env' || url === '/api/env') {
      return res.status(200).json({
        success: true,
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'development',
          platform: 'vercel',
          region: process.env.VERCEL_REGION || 'unknown',
          hasDatabase: !!process.env.DATABASE_URL,
          hasLangfuse: !!process.env.LANGFUSE_SECRET_KEY,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Default 404 response
    return res.status(404).json({
      success: false,
      message: 'Endpoint not found',
      path: url,
      availableEndpoints: [
        '/',
        '/health',
        '/test',
        '/env',
        '/api/assessment/start (POST)',
        '/api/assessment/{id}/status (GET)'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Run real vulnerability assessment using RedTeamAgent
 */
async function runRealAssessment(
  assessmentId: string,
  targetName: string,
  targetDescription: string,
  chatAgentUrl: string,
  openrouterApiKey: string,
  selectedModel: string,
  userId: string
) {
  console.log(`🔍 Starting real assessment ${assessmentId} for ${targetName}`);
  
  const assessment = activeAssessments.get(assessmentId);
  if (!assessment) {
    console.error(`Assessment ${assessmentId} not found in active assessments`);
    return;
  }

  try {
    // Update progress
    assessment.progress = {
      phase: 'discovery',
      progress: 10,
      tests_completed: 0,
      vulnerabilities_found: 0,
      message: 'Connecting to target agent...'
    };
    activeAssessments.set(assessmentId, assessment);

    // Validate chat agent URL
    if (!ChatAgentConnector.validateUrl(chatAgentUrl)) {
      throw new Error('Invalid chat agent URL format');
    }

    // Create chat agent connector
    const defaultConfig: ConnectionConfig = {
      url: chatAgentUrl,
      method: 'POST',
      timeout: 30000,
      retries: 3,
      requestFormat: 'json',
      responseFormat: 'json',
      messageField: 'message',
      responseField: 'message'
    };

    const chatConnector = new ChatAgentConnector(defaultConfig);

    // Test connection to chat agent
    console.log(`🔗 Testing connection to ${chatAgentUrl}`);
    const connectionTest = await chatConnector.testConnection();
    
    if (!connectionTest.success) {
      throw new Error(`Failed to connect to chat agent: ${connectionTest.error}`);
    }

    console.log(`✅ Connected to chat agent (${connectionTest.responseTime}ms)`);

    // Update progress
    assessment.progress = {
      phase: 'discovery',
      progress: 20,
      tests_completed: 0,
      vulnerabilities_found: 0,
      message: 'Connected! Starting system discovery...'
    };
    activeAssessments.set(assessmentId, assessment);

    // Initialize red team agent
    const redTeamAgent = new RedTeamAgent(openrouterApiKey, selectedModel);
    redTeamAgent.setTargetInfo(targetName, targetDescription);
    
    // Set up progress callback
    redTeamAgent.setProgressCallback((progress) => {
      const assessment = activeAssessments.get(assessmentId);
      if (assessment) {
        assessment.progress = progress;
        activeAssessments.set(assessmentId, assessment);
        console.log(`📊 Assessment ${assessmentId} progress: ${progress.phase} - ${progress.progress}% - ${progress.message}`);
      }
    });

    // Run the security assessment
    console.log(`🚀 Starting security assessment for ${targetName}`);
    const results = await redTeamAgent.runSecurityAssessment(
      chatConnector,
      targetName,
      assessmentId,
      userId
    );

    // Update assessment with results
    assessment.status = 'completed';
    assessment.totalTests = results.summary.totalTests;
    assessment.vulnerabilities = results.summary.vulnerabilities;
    assessment.securityScore = results.summary.securityScore;
    assessment.systemAnalysis = results.systemAnalysis;
    assessment.findings = results.findings;
    assessment.results = {
      vulnerabilityReport: results.vulnerabilityReport
    };

    activeAssessments.set(assessmentId, assessment);

    console.log(`✅ Assessment ${assessmentId} completed successfully`);
    console.log(`📊 Results: ${results.summary.vulnerabilities}/${results.summary.totalTests} vulnerabilities found`);
    console.log(`🔒 Security Score: ${results.summary.securityScore}/100`);

  } catch (error) {
    console.error(`❌ Assessment ${assessmentId} failed:`, error);
    
    const assessment = activeAssessments.get(assessmentId);
    if (assessment) {
      assessment.status = 'failed';
      assessment.progress = {
        phase: 'failed',
        progress: 0,
        tests_completed: 0,
        vulnerabilities_found: 0,
        message: `Assessment failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
      assessment.error = error instanceof Error ? error.message : 'Unknown error';
      activeAssessments.set(assessmentId, assessment);
    }
  }
}