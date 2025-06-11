import { Langfuse } from 'langfuse'

// Global singleton for Langfuse client
let langfuseClient: Langfuse | null = null

export function getLangfuseClient(): Langfuse | null {
  // Only initialize if environment variables are provided
  if (!process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_PUBLIC_KEY) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Langfuse not configured - missing LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY')
    }
    return null
  }

  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
    })

    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Langfuse backend client initialized for LLM observability')
    }
  }

  return langfuseClient
}

// Helper function to safely shutdown Langfuse (for serverless environments)
export async function shutdownLangfuse(): Promise<void> {
  if (langfuseClient) {
    await langfuseClient.shutdownAsync()
  }
}

// Helper types for better type safety
export interface LangfuseTraceData {
  name: string
  userId?: string
  sessionId?: string
  metadata?: Record<string, any>
  tags?: string[]
}

export interface LangfuseGenerationData {
  name: string
  model: string
  input: any
  output?: any
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  metadata?: Record<string, any>
}

// Helper function to create a trace safely
export function createTrace(data: LangfuseTraceData) {
  const client = getLangfuseClient()
  if (!client) return null
  
  return client.trace(data)
}

// Helper function to create a generation safely
export function createGeneration(trace: any, data: LangfuseGenerationData) {
  if (!trace) return null
  
  return trace.generation(data)
}