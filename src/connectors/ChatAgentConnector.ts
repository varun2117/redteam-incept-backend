import axios, { AxiosResponse } from 'axios';
import { URL } from 'url';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface ChatResponse {
  message: string;
  success: boolean;
  error?: string;
  metadata?: any;
}

export interface ConnectionConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  auth?: {
    type: 'bearer' | 'api-key' | 'basic';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    headerName?: string;
  };
  timeout?: number;
  retries?: number;
  requestFormat?: 'json' | 'form' | 'text';
  responseFormat?: 'json' | 'text';
  messageField?: string; // Field name in request body for the message
  responseField?: string; // Field name in response body for the reply
}

export interface ChatAgentInfo {
  id: string;
  name: string;
  type: 'api' | 'websocket' | 'webhook';
  config: ConnectionConfig;
  isActive: boolean;
  lastTested?: Date;
  capabilities?: string[];
}

export class ChatAgentConnector {
  private config: ConnectionConfig;
  private conversationHistory: ChatMessage[] = [];
  private lastError?: string;

  constructor(config: ConnectionConfig) {
    this.config = {
      method: 'POST',
      timeout: 30000,
      retries: 3,
      requestFormat: 'json',
      responseFormat: 'json',
      messageField: 'message',
      responseField: 'response',
      ...config
    };
  }

  /**
   * Test connection to the chat agent
   */
  async testConnection(): Promise<{ success: boolean; error?: string; responseTime?: number }> {
    const startTime = Date.now();
    try {
      const testMessage = "Hello! This is a connection test.";
      const response = await this.sendMessage(testMessage);
      const responseTime = Date.now() - startTime;
      
      return {
        success: response.success,
        error: response.error,
        responseTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Send a message to the chat agent
   */
  async sendMessage(message: string, context?: any): Promise<ChatResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= (this.config.retries || 3); attempt++) {
      try {
        const response = await this.makeRequest(message, context);
        
        // Add to conversation history
        this.conversationHistory.push(
          { role: 'user', content: message, timestamp: new Date() },
          { role: 'assistant', content: response.message, timestamp: new Date() }
        );

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < (this.config.retries || 3)) {
          // Wait before retry (exponential backoff)
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    this.lastError = lastError?.message;
    return {
      success: false,
      error: lastError?.message || 'Failed to send message after retries',
      message: ''
    };
  }

  /**
   * Make the actual HTTP request to the chat agent
   */
  private async makeRequest(message: string, context?: any): Promise<ChatResponse> {
    const requestData = this.buildRequestData(message, context);
    const headers = this.buildHeaders();

    const axiosConfig = {
      method: this.config.method,
      url: this.config.url,
      headers,
      timeout: this.config.timeout,
      ...(this.config.method !== 'GET' && { data: requestData })
    };

    const response: AxiosResponse = await axios(axiosConfig);
    
    return this.parseResponse(response);
  }

  /**
   * Build request data based on configuration
   */
  private buildRequestData(message: string, context?: any): any {
    const baseData: any = {};
    
    // Set message field
    if (this.config.messageField) {
      baseData[this.config.messageField] = message;
    }

    // Add conversation history in Test Agents format
    if (this.conversationHistory.length > 0) {
      baseData.conversation = this.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    }

    // Add context
    if (context) {
      baseData.context = context;
    }

    // Extract model from URL if it contains model parameter, otherwise use default
    try {
      const url = new URL(this.config.url);
      const modelFromUrl = url.searchParams.get('model');
      baseData.model = modelFromUrl || 'openai/gpt-4o-mini';
    } catch {
      baseData.model = 'openai/gpt-4o-mini';
    }

    // Handle different request formats
    switch (this.config.requestFormat) {
      case 'form':
        const formData = new URLSearchParams();
        Object.keys(baseData).forEach(key => {
          formData.append(key, typeof baseData[key] === 'string' ? baseData[key] : JSON.stringify(baseData[key]));
        });
        return formData;
      
      case 'text':
        return message;
      
      case 'json':
      default:
        return baseData;
    }
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'RedTeam-Agent/1.0',
      ...(this.config.headers || {})
    };

    // Set content type based on request format
    switch (this.config.requestFormat) {
      case 'form':
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        break;
      case 'text':
        headers['Content-Type'] = 'text/plain';
        break;
      case 'json':
      default:
        headers['Content-Type'] = 'application/json';
        break;
    }

    // Add authentication headers
    if (this.config.auth) {
      switch (this.config.auth.type) {
        case 'bearer':
          if (this.config.auth.token) {
            headers['Authorization'] = `Bearer ${this.config.auth.token}`;
          }
          break;
        
        case 'api-key':
          if (this.config.auth.apiKey && this.config.auth.headerName) {
            headers[this.config.auth.headerName] = this.config.auth.apiKey;
          }
          break;
        
        case 'basic':
          if (this.config.auth.username && this.config.auth.password) {
            const credentials = Buffer.from(`${this.config.auth.username}:${this.config.auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
          }
          break;
      }
    }

    return headers;
  }

  /**
   * Parse response from the chat agent
   */
  private parseResponse(response: AxiosResponse): ChatResponse {
    let message = '';
    let metadata: any = {};

    try {
      if (this.config.responseFormat === 'text') {
        message = response.data;
      } else {
        // JSON response
        const data = response.data;
        metadata = data;

        if (this.config.responseField && data[this.config.responseField]) {
          message = data[this.config.responseField];
        } else if (data.message) {
          message = data.message;
        } else if (data.response) {
          message = data.response;
        } else if (data.reply) {
          message = data.reply;
        } else if (data.text) {
          message = data.text;
        } else if (typeof data === 'string') {
          message = data;
        } else {
          // Try to extract text from common fields
          message = data.choices?.[0]?.message?.content || 
                   data.outputs?.[0]?.text ||
                   data.result ||
                   JSON.stringify(data);
        }
      }

      return {
        success: true,
        message: message.toString(),
        metadata
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse response: ${error}`,
        message: ''
      };
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get last error
   */
  getLastError(): string | undefined {
    return this.lastError;
  }

  /**
   * Validate URL format
   */
  static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create connector from agent info
   */
  static fromAgentInfo(agentInfo: ChatAgentInfo): ChatAgentConnector {
    return new ChatAgentConnector(agentInfo.config);
  }

  /**
   * Delay utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Auto-detect chat agent format by testing common endpoints and formats
   */
  static async autoDetectFormat(baseUrl: string, apiKey?: string): Promise<ConnectionConfig | null> {
    const commonConfigs: Partial<ConnectionConfig>[] = [
      // OpenAI-style API
      {
        url: `${baseUrl}/chat/completions`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        auth: apiKey ? { type: 'bearer', token: apiKey } : undefined,
        messageField: 'messages',
        responseField: 'choices[0].message.content'
      },
      // Generic chat API
      {
        url: baseUrl,
        method: 'POST',
        messageField: 'message',
        responseField: 'response'
      },
      // Simple text endpoint
      {
        url: baseUrl,
        method: 'POST',
        requestFormat: 'text',
        responseFormat: 'text'
      }
    ];

    for (const config of commonConfigs) {
      try {
        const connector = new ChatAgentConnector(config as ConnectionConfig);
        const result = await connector.testConnection();
        if (result.success) {
          return config as ConnectionConfig;
        }
      } catch (error) {
        // Continue to next config
        continue;
      }
    }

    return null;
  }
}