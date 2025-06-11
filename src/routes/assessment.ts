import express from 'express';
import { Server } from 'socket.io';
import { RedTeamAgent, AssessmentProgress } from '../services/RedTeamAgent';
import { ChatAgentConnector, ConnectionConfig } from '../connectors/ChatAgentConnector';
import { validateAssessmentRequest } from '../middleware/validation';
import { prisma } from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

interface AssessmentRequest {
  targetName: string;
  targetDescription?: string;
  chatAgentUrl: string;
  chatAgentConfig?: Partial<ConnectionConfig>;
  openrouterApiKey: string;
  selectedModel: string;
  userId?: string; // Optional, depends on auth implementation
}

interface ActiveAssessment {
  id: string;
  agent: RedTeamAgent;
  connector: ChatAgentConnector;
  status: 'running' | 'completed' | 'failed';
  startTime: Date;
  progress: AssessmentProgress;
  results?: any;
}

// Store active assessments in memory
// In production, you'd want to use Redis or a proper job queue
const activeAssessments = new Map<string, ActiveAssessment>();

/**
 * Start a new security assessment
 */
router.post('/start', validateAssessmentRequest, async (req, res) => {
  try {
    const {
      targetName,
      targetDescription,
      chatAgentUrl,
      chatAgentConfig,
      openrouterApiKey,
      selectedModel
    }: AssessmentRequest = req.body;

    const assessmentId = uuidv4();
    const io: Server = req.app.get('io');

    // Validate chat agent URL
    if (!ChatAgentConnector.validateUrl(chatAgentUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chat agent URL format'
      });
    }

    // Create chat agent connector with Test Agents compatibility
    const defaultConfig: ConnectionConfig = {
      url: chatAgentUrl,
      method: 'POST',
      timeout: 30000,
      retries: 3,
      requestFormat: 'json',
      responseFormat: 'json',
      messageField: 'message',
      responseField: 'message', // Test Agents returns 'message', not 'response'
      ...chatAgentConfig
    };

    const chatConnector = new ChatAgentConnector(defaultConfig);

    // Test connection to chat agent
    console.log(`Testing connection to chat agent: ${chatAgentUrl}`);
    const connectionTest = await chatConnector.testConnection();
    
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: `Failed to connect to chat agent: ${connectionTest.error}`,
        details: {
          url: chatAgentUrl,
          responseTime: connectionTest.responseTime
        }
      });
    }

    console.log(`✅ Chat agent connection successful (${connectionTest.responseTime}ms)`);

    // Debug: Check API key
    console.log(`🔑 OpenRouter API Key: ${openrouterApiKey ? `${openrouterApiKey.substring(0, 10)}...` : 'MISSING'}`);
    console.log(`🤖 Selected Model: ${selectedModel}`);

    // Initialize red team agent
    const redTeamAgent = new RedTeamAgent(openrouterApiKey, selectedModel);
    redTeamAgent.setTargetInfo(targetName, targetDescription);

    // Set up progress callback for real-time updates
    redTeamAgent.setProgressCallback((progress: AssessmentProgress) => {
      const assessment = activeAssessments.get(assessmentId);
      if (assessment) {
        assessment.progress = progress;
        // Emit progress update to connected clients
        io.to(`assessment-${assessmentId}`).emit('progress', {
          assessmentId,
          progress
        });
      }
    });

    // Store assessment
    const assessment: ActiveAssessment = {
      id: assessmentId,
      agent: redTeamAgent,
      connector: chatConnector,
      status: 'running',
      startTime: new Date(),
      progress: {
        phase: 'discovery',
        progress: 0,
        tests_completed: 0,
        vulnerabilities_found: 0,
        message: 'Initializing assessment...'
      }
    };

    activeAssessments.set(assessmentId, assessment);

    // Start assessment in background
    runAssessmentBackground(assessmentId, io);

    res.json({
      success: true,
      assessmentId,
      message: 'Assessment started successfully',
      chatAgentConnection: {
        url: chatAgentUrl,
        responseTime: connectionTest.responseTime,
        status: 'connected'
      }
    });

  } catch (error) {
    console.error('Error starting assessment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get assessment status and progress
 */
router.get('/:id/status', (req, res) => {
  const { id } = req.params;
  const assessment = activeAssessments.get(id);

  if (!assessment) {
    return res.status(404).json({
      success: false,
      message: 'Assessment not found'
    });
  }

  // Extract relevant data from results for frontend compatibility
  const assessmentData = {
    id: assessment.id,
    status: assessment.status,
    startTime: assessment.startTime,
    createdAt: assessment.startTime,
    progress: assessment.progress,
    results: assessment.results,
    // Extract data from results if available
    totalTests: assessment.results?.summary?.totalTests || 0,
    vulnerabilities: assessment.results?.summary?.vulnerabilities || 0,
    securityScore: assessment.results?.summary?.securityScore || null,
    findings: assessment.results?.findings || [],
    systemAnalysis: assessment.results?.systemAnalysis || null,
    exploitResults: assessment.results?.exploitResults || []
  };

  res.json({
    success: true,
    assessment: assessmentData
  });
});

/**
 * Get assessment results
 */
router.get('/:id/results', (req, res) => {
  const { id } = req.params;
  const assessment = activeAssessments.get(id);

  if (!assessment) {
    return res.status(404).json({
      success: false,
      message: 'Assessment not found'
    });
  }

  if (assessment.status === 'running') {
    return res.status(202).json({
      success: false,
      message: 'Assessment still in progress',
      progress: assessment.progress
    });
  }

  res.json({
    success: true,
    assessment: {
      id: assessment.id,
      status: assessment.status,
      startTime: assessment.startTime,
      results: assessment.results,
      progress: assessment.progress
    }
  });
});

/**
 * Stop/cancel an assessment
 */
router.post('/:id/stop', (req, res) => {
  const { id } = req.params;
  const assessment = activeAssessments.get(id);

  if (!assessment) {
    return res.status(404).json({
      success: false,
      message: 'Assessment not found'
    });
  }

  if (assessment.status !== 'running') {
    return res.status(400).json({
      success: false,
      message: 'Assessment is not running'
    });
  }

  // Update status
  assessment.status = 'failed';
  assessment.progress.message = 'Assessment cancelled by user';

  // Emit cancellation to connected clients
  const io: Server = req.app.get('io');
  io.to(`assessment-${id}`).emit('cancelled', { assessmentId: id });

  res.json({
    success: true,
    message: 'Assessment cancelled successfully'
  });
});

/**
 * List all assessments (with optional filtering)
 */
router.get('/', (req, res) => {
  const { status, limit = 50 } = req.query;
  
  const assessmentList = Array.from(activeAssessments.values())
    .filter(assessment => !status || assessment.status === status)
    .slice(0, Number(limit))
    .map(assessment => ({
      id: assessment.id,
      status: assessment.status,
      startTime: assessment.startTime,
      progress: assessment.progress,
      hasResults: !!assessment.results
    }));

  res.json({
    success: true,
    assessments: assessmentList,
    total: assessmentList.length
  });
});

/**
 * Test chat agent connection without starting assessment
 */
router.post('/test-connection', async (req, res) => {
  try {
    const { chatAgentUrl, chatAgentConfig } = req.body;

    if (!ChatAgentConnector.validateUrl(chatAgentUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chat agent URL format'
      });
    }

    const defaultConfig: ConnectionConfig = {
      url: chatAgentUrl,
      method: 'POST',
      timeout: 10000,
      retries: 1,
      requestFormat: 'json',
      responseFormat: 'json',
      messageField: 'message',
      responseField: 'message', // Test Agents compatibility
      ...chatAgentConfig
    };

    const chatConnector = new ChatAgentConnector(defaultConfig);
    const connectionTest = await chatConnector.testConnection();

    res.json({
      success: connectionTest.success,
      message: connectionTest.success ? 'Connection successful' : 'Connection failed',
      details: {
        url: chatAgentUrl,
        responseTime: connectionTest.responseTime,
        error: connectionTest.error
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing connection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test route for debugging
 */
router.get('/:id/test', (req, res) => {
  res.json({ message: `Test route works for assessment ${req.params.id}` });
});

/**
 * Get vulnerability report for an assessment
 */
router.get('/:id/report', async (req, res) => {
  const { id } = req.params;
  const { format = 'json' } = req.query;
  
  console.log(`📋 Report request - Assessment ID: ${id}, Format: ${format}`);
  console.log(`📊 Active assessments: ${Array.from(activeAssessments.keys()).join(', ')}`);
  
  let report = null;
  let assessment = activeAssessments.get(id);

  if (assessment && assessment.results?.vulnerabilityReport) {
    console.log(`✅ Assessment ${id} found in memory with vulnerability report`);
    report = assessment.results.vulnerabilityReport;
  } else {
    console.log(`🔍 Assessment ${id} not in memory or no report, checking database...`);
    
    try {
      const dbAssessment = await prisma.assessment.findUnique({
        where: { id },
        include: {
          findings: true,
          exploitResults: true
        }
      });

      if (!dbAssessment) {
        console.log(`❌ Assessment ${id} not found in database`);
        // Debug: Return what we tried to query
        return res.status(404).json({
          success: false,
          message: 'Assessment not found',
          debug: {
            searchedId: id,
            databasePath: process.env.DATABASE_URL
          }
        });
      }

      console.log(`📂 Assessment ${id} found in database, status: ${dbAssessment.status}`);
      
      if (dbAssessment.status !== 'completed') {
        console.log(`⚠️ Assessment not completed: ${dbAssessment.status}`);
        return res.status(400).json({
          success: false,
          message: 'Assessment not completed yet'
        });
      }

      if (dbAssessment.vulnerabilityReport) {
        console.log(`📄 Using vulnerability report from database`);
        try {
          report = JSON.parse(dbAssessment.vulnerabilityReport);
        } catch (error) {
          console.error(`❌ Error parsing vulnerability report from database:`, error);
          return res.status(500).json({
            success: false,
            message: 'Error parsing vulnerability report'
          });
        }
      } else {
        console.log(`⚠️ No vulnerability report in database, generating from findings...`);
        // Generate report from database findings
        const systemAnalysis = dbAssessment.systemAnalysis ? JSON.parse(dbAssessment.systemAnalysis) : null;
        const findings = dbAssessment.findings.map(f => ({
          vector: f.vector,
          test_case: {
            prompt: f.prompt,
            technique: f.technique || 'Unknown',
            vulnerability_tested: f.vulnerabilityType || 'Unknown',
            expected_vulnerable_behavior: 'See analysis'
          },
          response: f.response,
          analysis: {
            vulnerable: f.vulnerable,
            vulnerability_type: f.vulnerabilityType || 'Unknown',
            severity: (f.severity as 'Low' | 'Medium' | 'High') || 'Low',
            explanation: f.explanation || 'No explanation available',
            recommendations: f.recommendations || 'No recommendations available'
          },
          timestamp: f.createdAt
        }));

        // Create a mock RedTeamAgent instance to generate the report
        const mockAgent = new RedTeamAgent('dummy-key');
        mockAgent.setTargetInfo(dbAssessment.targetName, dbAssessment.targetDescription || undefined);
        
        const summary = {
          totalTests: dbAssessment.totalTests,
          vulnerabilities: dbAssessment.vulnerabilities,
          securityScore: dbAssessment.securityScore || 0,
          severityDistribution: findings
            .filter(f => f.analysis.vulnerable)
            .reduce((acc, f) => {
              acc[f.analysis.severity] = (acc[f.analysis.severity] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
        };

        try {
          report = await mockAgent.generateVulnerabilityReport(id, systemAnalysis, findings, summary);
          
          // Save the generated report back to the database
          await prisma.assessment.update({
            where: { id },
            data: {
              vulnerabilityReport: JSON.stringify(report),
              riskLevel: report.executiveSummary.riskLevel,
              executionTime: report.executionTime
            }
          });
          
          console.log(`✅ Generated and saved vulnerability report for assessment ${id}`);
        } catch (error) {
          console.error(`❌ Error generating vulnerability report:`, error);
          return res.status(500).json({
            success: false,
            message: 'Error generating vulnerability report'
          });
        }
      }
    } catch (error) {
      console.error(`❌ Database error:`, error);
      return res.status(500).json({
        success: false,
        message: 'Database error'
      });
    }
  }

  if (!report) {
    console.log(`⚠️ No vulnerability report available for assessment ${id}`);
    return res.status(400).json({
      success: false,
      message: 'Vulnerability report not available'
    });
  }

  switch (format) {
    case 'json':
      res.json({
        success: true,
        report
      });
      break;

    case 'html':
      const htmlReport = generateHtmlReport(report);
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="vulnerability-report-${id}.html"`);
      res.send(htmlReport);
      break;

    case 'text':
      const textReport = generateTextReport(report);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="vulnerability-report-${id}.txt"`);
      res.send(textReport);
      break;

    default:
      res.status(400).json({
        success: false,
        message: 'Invalid format. Supported formats: json, html, text'
      });
  }
});

/**
 * Auto-detect chat agent configuration
 */
router.post('/detect-config', async (req, res) => {
  try {
    const { chatAgentUrl, apiKey } = req.body;

    if (!ChatAgentConnector.validateUrl(chatAgentUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid chat agent URL format'
      });
    }

    const detectedConfig = await ChatAgentConnector.autoDetectFormat(chatAgentUrl, apiKey);

    if (detectedConfig) {
      res.json({
        success: true,
        message: 'Configuration detected successfully',
        config: detectedConfig
      });
    } else {
      res.json({
        success: false,
        message: 'Could not auto-detect configuration',
        suggestions: [
          'Try different endpoint URLs (e.g., /chat, /api/chat, /v1/chat/completions)',
          'Check if API key is required',
          'Verify the chat agent is running and accessible'
        ]
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error detecting configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Background function to run the assessment
 */
async function runAssessmentBackground(assessmentId: string, io: Server) {
  const assessment = activeAssessments.get(assessmentId);
  if (!assessment) return;

  try {
    console.log(`🔍 Starting assessment ${assessmentId}`);
    
    const results = await assessment.agent.runSecurityAssessment(
      assessment.connector,
      undefined, // target name already set
      assessmentId // pass assessmentId for report generation
    );

    assessment.status = 'completed';
    assessment.results = results;

    console.log(`✅ Assessment ${assessmentId} completed successfully`);
    console.log(`📊 Results: ${results.summary.vulnerabilities}/${results.summary.totalTests} vulnerabilities found`);

    // Save vulnerability report to database if available
    if (results.vulnerabilityReport) {
      try {
        await prisma.assessment.update({
          where: { id: assessmentId },
          data: {
            status: 'completed',
            totalTests: results.summary.totalTests,
            vulnerabilities: results.summary.vulnerabilities,
            securityScore: results.summary.securityScore,
            systemAnalysis: JSON.stringify(results.systemAnalysis),
            vulnerabilityReport: JSON.stringify(results.vulnerabilityReport),
            riskLevel: results.vulnerabilityReport.executiveSummary.riskLevel,
            executionTime: results.vulnerabilityReport.executionTime
          }
        });
        console.log(`💾 Saved assessment results to database`);
      } catch (error) {
        console.error(`❌ Error saving assessment to database:`, error);
      }
    }

    // Emit completion event
    io.to(`assessment-${assessmentId}`).emit('completed', {
      assessmentId,
      results
    });

  } catch (error) {
    console.error(`❌ Assessment ${assessmentId} failed:`, error);
    
    assessment.status = 'failed';
    assessment.progress.message = `Assessment failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

    // Emit failure event
    io.to(`assessment-${assessmentId}`).emit('failed', {
      assessmentId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Generate HTML report from vulnerability report data
 */
function generateHtmlReport(report: any): string {
  const riskLevelColors: Record<string, string> = {
    'Low': '#28a745',
    'Medium': '#ffc107', 
    'High': '#fd7e14',
    'Critical': '#dc3545'
  };

  const vulnerableFindings = report.detailedFindings
    .flatMap((df: any) => df.findings.filter((f: any) => f.analysis.vulnerable));

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vulnerability Assessment Report - ${report.targetName}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
        .header { border-bottom: 3px solid #007bff; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { color: #007bff; margin: 0; }
        .header .subtitle { color: #666; font-size: 18px; margin-top: 5px; }
        .risk-badge { 
            display: inline-block; 
            padding: 4px 12px; 
            border-radius: 20px; 
            color: white; 
            font-weight: bold; 
            font-size: 14px;
        }
        .section { margin: 30px 0; }
        .section h2 { color: #007bff; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
        .section h3 { color: #495057; margin-top: 25px; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .summary-card { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px; 
            border-left: 4px solid #007bff; 
            text-align: center;
        }
        .summary-card h4 { margin: 0 0 10px 0; color: #495057; }
        .summary-card .value { font-size: 28px; font-weight: bold; color: #007bff; }
        .finding { 
            background: #fff; 
            border: 1px solid #dee2e6; 
            border-radius: 8px; 
            padding: 20px; 
            margin: 15px 0; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .finding.vulnerable { border-left: 4px solid #dc3545; }
        .finding.safe { border-left: 4px solid #28a745; }
        .finding-header { display: flex; justify-content: between; align-items: center; margin-bottom: 15px; }
        .finding-title { font-weight: bold; color: #495057; }
        .severity { font-size: 12px; padding: 2px 8px; border-radius: 12px; color: white; }
        .severity.High { background-color: #dc3545; }
        .severity.Medium { background-color: #ffc107; color: #212529; }
        .severity.Low { background-color: #28a745; }
        .recommendation { background: #e7f3ff; padding: 15px; border-radius: 6px; margin-top: 15px; }
        .recommendation h4 { margin: 0 0 10px 0; color: #0056b3; }
        .disclaimer { 
            background: #fff3cd; 
            border: 1px solid #ffeaa7; 
            padding: 20px; 
            border-radius: 8px; 
            margin-top: 40px; 
        }
        .disclaimer h4 { color: #856404; margin: 0 0 10px 0; }
        ul { padding-left: 20px; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 14px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Vulnerability Assessment Report</h1>
        <div class="subtitle">Target: ${report.targetName}</div>
        <div class="subtitle">Assessment Date: ${new Date(report.executionDate).toLocaleDateString()}</div>
        <div class="subtitle">Execution Time: ${report.executionTime}</div>
    </div>

    <div class="section">
        <h2>Executive Summary</h2>
        <div class="summary-grid">
            <div class="summary-card">
                <h4>Risk Level</h4>
                <div class="value">
                    <span class="risk-badge" style="background-color: ${riskLevelColors[report.executiveSummary.riskLevel] || '#6b7280'}">
                        ${report.executiveSummary.riskLevel}
                    </span>
                </div>
            </div>
            <div class="summary-card">
                <h4>Security Score</h4>
                <div class="value">${Math.round(report.executiveSummary.securityScore)}/100</div>
            </div>
            <div class="summary-card">
                <h4>Total Tests</h4>
                <div class="value">${report.executiveSummary.totalTests}</div>
            </div>
            <div class="summary-card">
                <h4>Vulnerabilities</h4>
                <div class="value">${report.executiveSummary.vulnerabilities}</div>
            </div>
        </div>

        ${report.executiveSummary.keyFindings.length > 0 ? `
        <h3>Key Findings</h3>
        <ul>
            ${report.executiveSummary.keyFindings.map((finding: string) => `<li>${finding}</li>`).join('')}
        </ul>
        ` : ''}
    </div>

    <div class="section">
        <h2>System Analysis</h2>
        <p><strong>Purpose:</strong> ${report.systemAnalysis.system_purpose}</p>
        
        ${report.systemAnalysis.system_constraints.length > 0 ? `
        <h3>System Constraints</h3>
        <ul>
            ${report.systemAnalysis.system_constraints.map((constraint: string) => `<li>${constraint}</li>`).join('')}
        </ul>
        ` : ''}

        ${report.systemAnalysis.content_policies.length > 0 ? `
        <h3>Content Policies</h3>
        <ul>
            ${report.systemAnalysis.content_policies.map((policy: string) => `<li>${policy}</li>`).join('')}
        </ul>
        ` : ''}
    </div>

    <div class="section">
        <h2>Detailed Findings</h2>
        ${report.detailedFindings.map((vectorFindings: any) => `
            <h3>Attack Vector: ${vectorFindings.vector.replace(/_/g, ' ').toUpperCase()}</h3>
            <p>${vectorFindings.summary}</p>
            
            ${vectorFindings.findings.map((finding: any) => `
                <div class="finding ${finding.analysis.vulnerable ? 'vulnerable' : 'safe'}">
                    <div class="finding-header">
                        <span class="finding-title">${finding.test_case.technique}</span>
                        ${finding.analysis.vulnerable ? `<span class="severity ${finding.analysis.severity}">${finding.analysis.severity}</span>` : ''}
                    </div>
                    
                    <p><strong>Test:</strong> ${finding.test_case.vulnerability_tested}</p>
                    <p><strong>Prompt:</strong></p>
                    <pre>${finding.test_case.prompt}</pre>
                    
                    <p><strong>Analysis:</strong> ${finding.analysis.explanation}</p>
                    
                    ${finding.analysis.vulnerable && finding.analysis.recommendations ? `
                    <div class="recommendation">
                        <h4>Recommendations</h4>
                        <p>${finding.analysis.recommendations}</p>
                    </div>
                    ` : ''}
                </div>
            `).join('')}
        `).join('')}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        <ol>
            ${report.recommendations.map((rec: string) => `<li>${rec}</li>`).join('')}
        </ol>
    </div>

    <div class="section">
        <h2>Methodology</h2>
        <p>${report.methodology}</p>
    </div>

    <div class="disclaimer">
        <h4>⚠️ Disclaimer</h4>
        <p>${report.disclaimer}</p>
    </div>
</body>
</html>`;
}

/**
 * Generate text report from vulnerability report data
 */
function generateTextReport(report: any): string {
  const vulnerableFindings = report.detailedFindings
    .flatMap((df: any) => df.findings.filter((f: any) => f.analysis.vulnerable));

  return `
VULNERABILITY ASSESSMENT REPORT
=====================================

Target: ${report.targetName}
${report.targetDescription ? `Description: ${report.targetDescription}` : ''}
Assessment Date: ${new Date(report.executionDate).toLocaleDateString()}
Execution Time: ${report.executionTime}

EXECUTIVE SUMMARY
=================
Risk Level: ${report.executiveSummary.riskLevel}
Security Score: ${Math.round(report.executiveSummary.securityScore)}/100
Total Tests: ${report.executiveSummary.totalTests}
Vulnerabilities Found: ${report.executiveSummary.vulnerabilities}

${report.executiveSummary.keyFindings.length > 0 ? `
Key Findings:
${report.executiveSummary.keyFindings.map((finding: string, index: number) => `${index + 1}. ${finding}`).join('\n')}
` : ''}

SYSTEM ANALYSIS
===============
Purpose: ${report.systemAnalysis.system_purpose}

${report.systemAnalysis.system_constraints.length > 0 ? `
System Constraints:
${report.systemAnalysis.system_constraints.map((constraint: string, index: number) => `- ${constraint}`).join('\n')}
` : ''}

${report.systemAnalysis.content_policies.length > 0 ? `
Content Policies:
${report.systemAnalysis.content_policies.map((policy: string, index: number) => `- ${policy}`).join('\n')}
` : ''}

DETAILED FINDINGS
=================
${report.detailedFindings.map((vectorFindings: any) => `
Attack Vector: ${vectorFindings.vector.replace(/_/g, ' ').toUpperCase()}
${'-'.repeat(50)}
Summary: ${vectorFindings.summary}

${vectorFindings.findings.filter((f: any) => f.analysis.vulnerable).map((finding: any, index: number) => `
Finding ${index + 1}: ${finding.analysis.vulnerability_type} (${finding.analysis.severity})
Technique: ${finding.test_case.technique}
Test: ${finding.test_case.vulnerability_tested}

Prompt:
${finding.test_case.prompt}

Analysis:
${finding.analysis.explanation}

${finding.analysis.recommendations ? `Recommendations: ${finding.analysis.recommendations}` : ''}
`).join('\n')}
`).join('\n')}

RECOMMENDATIONS
===============
${report.recommendations.map((rec: string, index: number) => `${index + 1}. ${rec}`).join('\n')}

METHODOLOGY
===========
${report.methodology}

DISCLAIMER
==========
${report.disclaimer}

Report generated on: ${new Date().toLocaleString()}
`;
}

export default router;