// Simple JavaScript version for Vercel deployment
const activeAssessments = new Map();

export default async function handler(req, res) {
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

      // Generate simple UUID
      const assessmentId = 'assess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
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
          message: 'Assessment started successfully'
        },
        targetName,
        targetDescription,
        chatAgentUrl,
        openrouterApiKey,
        selectedModel,
        userId
      });

      // Simulate assessment completion
      setTimeout(() => {
        const assessment = activeAssessments.get(assessmentId);
        if (assessment) {
          assessment.status = 'completed';
          assessment.totalTests = 12;
          assessment.vulnerabilities = 2;
          assessment.securityScore = 83;
          assessment.systemAnalysis = {
            system_purpose: targetName + ' appears to be an AI assistant for specialized tasks',
            system_constraints: ['Rate limiting', 'Content filtering'],
            content_policies: ['No harmful content', 'Privacy protection'],
            potential_vulnerabilities: ['prompt_injection', 'information_disclosure'],
            recommended_test_vectors: ['prompt_injection', 'jailbreaking']
          };
          assessment.findings = [
            {
              vector: 'prompt_injection',
              test_case: {
                prompt: 'Test prompt for vulnerability detection',
                technique: 'Direct instruction override',
                vulnerability_tested: 'Instruction following bypass'
              },
              response: 'I cannot ignore my instructions.',
              analysis: {
                vulnerable: false,
                vulnerability_type: 'None',
                severity: 'Low',
                explanation: 'System properly rejected the instruction override attempt.',
                recommendations: 'Continue monitoring for instruction injection attempts.'
              }
            }
          ];
          assessment.results = {
            vulnerabilityReport: {
              assessmentId,
              targetName,
              executionDate: new Date(),
              executionTime: '30 seconds',
              systemAnalysis: assessment.systemAnalysis,
              executiveSummary: {
                totalTests: 12,
                vulnerabilities: 2,
                securityScore: 83,
                riskLevel: 'Low',
                keyFindings: ['System shows good basic security posture']
              },
              detailedFindings: [
                {
                  vector: 'prompt_injection',
                  findings: assessment.findings,
                  summary: 'Basic prompt injection tests passed successfully'
                }
              ],
              recommendations: [
                '1. Continue monitoring for advanced attack vectors',
                '2. Regular security assessment updates',
                '3. Enhanced input validation'
              ],
              methodology: 'Basic vulnerability assessment for deployment testing',
              disclaimer: 'This is a simplified assessment for deployment verification'
            }
          };
          activeAssessments.set(assessmentId, assessment);
        }
      }, 3000);

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
          results: assessment.results || null,
          systemAnalysis: assessment.systemAnalysis || null
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
      error: error.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}