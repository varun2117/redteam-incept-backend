import { PrismaClient } from '@prisma/client'

// Global singleton for better connection management
let globalPrisma: PrismaClient | undefined

function createPrismaClient() {
  // Try multiple database URL sources
  let databaseUrl = process.env.DATABASE_URL || 
                   process.env.POSTGRES_PRISMA_URL || 
                   process.env.POSTGRES_URL || ''
  
  // For direct connections (non-pooling) - preferred for serverless
  const directUrl = process.env.DATABASE_URL_NON_POOLING || 
                   process.env.POSTGRES_URL_NON_POOLING || 
                   process.env.DIRECT_URL || ''

  // Detect serverless environment
  const isServerless = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME)
  
  // Use direct URL for serverless to avoid connection pooling issues
  if (isServerless && directUrl) {
    databaseUrl = directUrl
    console.log('Backend: Using direct connection URL for serverless environment')
  }

  // Only modify URL for PostgreSQL connections
  if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
    try {
      const url = new URL(databaseUrl)
      
      // Optimized settings for serverless with prepared statement prevention
      url.searchParams.set('prepared_statements', 'false')
      url.searchParams.set('statement_cache_size', '0')
      
      if (isServerless) {
        // Serverless-friendly settings
        url.searchParams.set('connection_limit', '3')
        url.searchParams.set('pool_size', '3')
        url.searchParams.set('pool_timeout', '20')
        url.searchParams.set('connect_timeout', '30')
      } else {
        // Development settings
        url.searchParams.set('connection_limit', '10')
        url.searchParams.set('pool_size', '10')
        url.searchParams.set('pool_timeout', '60')
        url.searchParams.set('connect_timeout', '30')
      }
      
      // Remove any pgbouncer settings that might interfere
      url.searchParams.delete('pgbouncer')
      
      databaseUrl = url.toString()
      console.log('Backend: PostgreSQL configured with optimized serverless settings')
    } catch (error) {
      console.warn('Backend: Failed to modify PostgreSQL URL:', error)
    }
  }

  return new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
  })
}

function getPrismaInstance() {
  const isServerless = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME)
  
  if (isServerless) {
    // In serverless, always create fresh instances to avoid connection issues
    return createPrismaClient()
  }
  
  // In development, use singleton
  if (!globalPrisma) {
    globalPrisma = createPrismaClient()
  }
  return globalPrisma
}

// Robust operation wrapper with retry logic
export async function executePrismaOperation<T>(
  operation: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  const maxRetries = 3
  const isServerless = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME)
  let lastError: any
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const client = getPrismaInstance()
    
    try {
      if (attempt > 0) {
        console.log(`Backend: Prisma operation retry ${attempt + 1}/${maxRetries}`)
      }
      
      // Execute operation
      const result = await operation(client)
      
      // Only disconnect in serverless environments
      if (isServerless) {
        try {
          await client.$disconnect()
        } catch (disconnectError) {
          console.warn('Backend: Failed to disconnect Prisma client:', disconnectError)
        }
      }
      
      return result
      
    } catch (error: any) {
      lastError = error
      console.error(`Backend: Prisma operation attempt ${attempt + 1} failed:`, error?.message || error)
      
      // Force disconnect on error in serverless
      if (isServerless) {
        try {
          await client.$disconnect()
        } catch {}
      }
      
      // Check if it's a retryable error
      const isRetryable = error?.message?.includes('prepared statement') ||
                         error?.message?.includes('connection') ||
                         error?.message?.includes('Timed out fetching') ||
                         error?.message?.includes('connection pool') ||
                         error?.message?.includes('SQLITE_BUSY') ||
                         error?.code === '42P05' ||
                         error?.code === 'P2024' ||
                         error?.code === 'P1001'
      
      if (isRetryable && attempt < maxRetries - 1) {
        // Short delay for retries
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000) + Math.random() * 500
        console.log(`Backend: Retrying in ${Math.round(delay)}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      break
    }
  }
  
  throw lastError
}

// Legacy exports for compatibility
export const prisma = getPrismaInstance()
export function getPrisma() { return getPrismaInstance() }
export function getFreshPrismaClient() { return createPrismaClient() }
export default prisma