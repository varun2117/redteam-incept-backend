import express from 'express';
import { ChatAgentConnector, ConnectionConfig } from '../connectors/ChatAgentConnector';

const router = express.Router();

/**
 * Test a chat agent connection and get basic info
 */
router.post('/test', async (req, res) => {
  try {
    const { url, config } = req.body;

    if (!ChatAgentConnector.validateUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    const connectionConfig: ConnectionConfig = {
      url,
      method: 'POST',
      timeout: 10000,
      retries: 1,
      ...config
    };

    const connector = new ChatAgentConnector(connectionConfig);
    const testResult = await connector.testConnection();

    if (testResult.success) {
      // Try to get some basic info about the agent
      const infoResponse = await connector.sendMessage("What can you do?");
      
      res.json({
        success: true,
        connection: {
          url,
          responseTime: testResult.responseTime,
          status: 'connected'
        },
        agentInfo: {
          response: infoResponse.success ? infoResponse.message : 'No response',
          supportsConversation: infoResponse.success
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to connect to chat agent',
        error: testResult.error,
        responseTime: testResult.responseTime
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing chat agent',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Send a single message to a chat agent (for testing purposes)
 */
router.post('/message', async (req, res) => {
  try {
    const { url, message, config } = req.body;

    if (!ChatAgentConnector.validateUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required and must be a string'
      });
    }

    const connectionConfig: ConnectionConfig = {
      url,
      method: 'POST',
      timeout: 30000,
      retries: 2,
      ...config
    };

    const connector = new ChatAgentConnector(connectionConfig);
    const response = await connector.sendMessage(message);

    res.json({
      success: response.success,
      message: response.message,
      error: response.error,
      metadata: response.metadata,
      conversationHistory: connector.getConversationHistory()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error sending message to chat agent',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Auto-detect the best configuration for a chat agent
 */
router.post('/detect', async (req, res) => {
  try {
    const { url, apiKey } = req.body;

    if (!ChatAgentConnector.validateUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    const detectedConfig = await ChatAgentConnector.autoDetectFormat(url, apiKey);

    if (detectedConfig) {
      // Test the detected configuration
      const connector = new ChatAgentConnector(detectedConfig);
      const testResult = await connector.testConnection();

      res.json({
        success: true,
        config: detectedConfig,
        test: {
          success: testResult.success,
          responseTime: testResult.responseTime,
          error: testResult.error
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Could not auto-detect configuration',
        suggestions: [
          'Verify the URL is accessible',
          'Check if authentication is required',
          'Try common endpoints like /chat, /api/chat, or /v1/chat/completions',
          'Ensure the service is running and healthy'
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
 * Get common configuration templates for popular chat agents
 */
router.get('/templates', (req, res) => {
  const templates = {
    openai: {
      name: 'OpenAI API',
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        auth: {
          type: 'bearer',
          token: 'YOUR_API_KEY'
        },
        requestFormat: 'json',
        responseFormat: 'json',
        messageField: 'messages',
        responseField: 'choices[0].message.content'
      },
      example: {
        url: 'https://api.openai.com/v1/chat/completions'
      }
    },
    ollama: {
      name: 'Ollama',
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        requestFormat: 'json',
        responseFormat: 'json',
        messageField: 'prompt',
        responseField: 'response'
      },
      example: {
        url: 'http://localhost:11434/api/generate'
      }
    },
    textgen: {
      name: 'Text Generation WebUI',
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        requestFormat: 'json',
        responseFormat: 'json',
        messageField: 'prompt',
        responseField: 'results[0].text'
      },
      example: {
        url: 'http://localhost:5000/api/v1/generate'
      }
    },
    koboldai: {
      name: 'KoboldAI',
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        requestFormat: 'json',
        responseFormat: 'json',
        messageField: 'prompt',
        responseField: 'results[0].text'
      },
      example: {
        url: 'http://localhost:5000/api/v1/generate'
      }
    },
    custom: {
      name: 'Custom API',
      config: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        requestFormat: 'json',
        responseFormat: 'json',
        messageField: 'message',
        responseField: 'response'
      },
      example: {
        url: 'http://your-api-endpoint.com/chat'
      }
    }
  };

  res.json({
    success: true,
    templates
  });
});

/**
 * Validate a configuration object
 */
router.post('/validate-config', (req, res) => {
  try {
    const { config } = req.body;

    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!config.url) {
      errors.push('URL is required');
    } else if (!ChatAgentConnector.validateUrl(config.url)) {
      errors.push('Invalid URL format');
    }

    // Optional but recommended fields
    if (!config.timeout) {
      warnings.push('No timeout specified, using default 30s');
    } else if (config.timeout > 120000) {
      warnings.push('Timeout is very high (>2 minutes)');
    }

    if (!config.retries) {
      warnings.push('No retry count specified, using default 3');
    }

    if (!config.messageField) {
      warnings.push('No message field specified, using default "message"');
    }

    if (!config.responseField) {
      warnings.push('No response field specified, using default "response"');
    }

    // Auth validation
    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          if (!config.auth.token) {
            errors.push('Bearer auth requires token');
          }
          break;
        case 'api-key':
          if (!config.auth.apiKey || !config.auth.headerName) {
            errors.push('API key auth requires apiKey and headerName');
          }
          break;
        case 'basic':
          if (!config.auth.username || !config.auth.password) {
            errors.push('Basic auth requires username and password');
          }
          break;
      }
    }

    res.json({
      success: errors.length === 0,
      valid: errors.length === 0,
      errors,
      warnings
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error validating configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;