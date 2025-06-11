import axios, { AxiosResponse } from 'axios';
import { getLangfuseClient } from '../lib/langfuse';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';
  private langfuse = getLangfuseClient();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    console.log(`🔑 OpenRouterClient initialized with API key: ${apiKey ? `${apiKey.substring(0, 10)}...` : 'EMPTY'}`);
  }

  async createChatCompletion({
    model = 'anthropic/claude-sonnet-4',
    messages,
    temperature = 0.7,
    max_tokens = 2000,
    response_format,
    traceId,
    traceName = 'backend-openrouter-chat-completion',
    userId,
    sessionId,
    metadata = {}
  }: {
    model?: string;
    messages: OpenRouterMessage[];
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: 'json_object' };
    traceId?: string;
    traceName?: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  }): Promise<OpenRouterResponse> {
    const startTime = Date.now();
    
    // Create Langfuse trace and generation if available
    let trace = null;
    let generation = null;
    
    if (this.langfuse) {
      trace = this.langfuse.trace({
        id: traceId,
        name: traceName,
        userId,
        sessionId,
        metadata: {
          ...metadata,
          model,
          temperature,
          max_tokens,
          response_format: response_format?.type || 'text',
          backend: true
        }
      });
      
      generation = trace.generation({
        name: 'backend-openrouter-completion',
        model,
        input: messages,
        metadata: {
          temperature,
          max_tokens,
          response_format: response_format?.type || 'text',
          provider: 'openrouter',
          backend: true
        }
      });
    }

    try {
      const response: AxiosResponse = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens,
          ...(response_format && { response_format })
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'http://localhost:3001',
            'X-Title': 'LLM Red Team Agent Backend'
          },
          timeout: 60000 // 60 second timeout
        }
      );

      const result: OpenRouterResponse = response.data;
      
      // Log successful completion to Langfuse if available
      if (generation && result.usage) {
        generation.end({
          output: result.choices[0]?.message,
          usage: {
            promptTokens: result.usage.prompt_tokens,
            completionTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens
          },
          metadata: {
            responseId: result.id,
            finishReason: result.choices[0]?.finish_reason,
            latencyMs: Date.now() - startTime
          }
        });
      }

      return result;
    } catch (error) {
      // Log error to Langfuse if available
      if (generation) {
        generation.end({
          output: { error: error instanceof Error ? error.message : String(error) },
          level: 'ERROR',
          metadata: {
            latencyMs: Date.now() - startTime
          }
        });
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.error?.message || error.message;
        throw new Error(`OpenRouter API error (${status}): ${message}`);
      }
      throw error;
    }
  }

  async getAvailableModels() {
    try {
      const response: AxiosResponse = await axios.get(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3001'
        }
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch models: ${error.response?.status} ${error.message}`);
      }
      throw error;
    }
  }
}