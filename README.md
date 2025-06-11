# Red Team Agent Backend

A comprehensive backend service for the LLM Red Team Agent that can connect to external chat agents and perform autonomous security testing.

## Features

- **External Chat Agent Connectivity**: Connect to any chat agent via HTTP API
- **Auto-Detection**: Automatically detect chat agent configuration formats
- **Real-time Assessment**: Live progress updates via WebSocket
- **Multiple Protocol Support**: Support for various API formats (OpenAI, Ollama, custom APIs)
- **Robust Error Handling**: Retry logic, timeout handling, and graceful failures
- **Rate Limiting**: Prevent abuse and ensure fair usage
- **Security**: Input validation, sanitization, and secure API handling

## Supported Chat Agent Types

### OpenAI-Compatible APIs
- OpenAI API
- Azure OpenAI
- OpenRouter
- Any OpenAI-compatible endpoint

### Local AI Services
- Ollama
- Text Generation WebUI (oobabooga)
- KoboldAI
- LocalAI

### Custom APIs
- Any HTTP-based chat API
- Configurable request/response formats
- Custom authentication methods

## Quick Start

### 1. Installation

```bash
cd backend
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Development Server

```bash
npm run dev
```

The backend will start on `http://localhost:3001`

### 4. Production Build

```bash
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status

### Chat Agent Management
- `POST /api/agent/test` - Test chat agent connection
- `POST /api/agent/message` - Send single message to agent
- `POST /api/agent/detect` - Auto-detect agent configuration
- `GET /api/agent/templates` - Get configuration templates
- `POST /api/agent/validate-config` - Validate configuration

### Security Assessment
- `POST /api/assessment/start` - Start new assessment
- `GET /api/assessment/:id/status` - Get assessment status
- `GET /api/assessment/:id/results` - Get assessment results
- `POST /api/assessment/:id/stop` - Cancel assessment
- `GET /api/assessment/` - List assessments
- `POST /api/assessment/test-connection` - Test chat agent connection
- `POST /api/assessment/detect-config` - Auto-detect configuration

## Usage Examples

### Start Security Assessment

```bash
curl -X POST http://localhost:3001/api/assessment/start \
  -H "Content-Type: application/json" \
  -d '{
    "targetName": "My Chat Agent",
    "targetDescription": "Custom AI assistant",
    "chatAgentUrl": "http://localhost:11434/api/generate",
    "chatAgentConfig": {
      "method": "POST",
      "requestFormat": "json",
      "messageField": "prompt",
      "responseField": "response"
    },
    "openrouterApiKey": "sk-or-your-key-here",
    "selectedModel": "anthropic/claude-sonnet-4"
  }'
```

### Test Chat Agent Connection

```bash
curl -X POST http://localhost:3001/api/agent/test \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:11434/api/generate",
    "config": {
      "method": "POST",
      "messageField": "prompt",
      "responseField": "response"
    }
  }'
```

### Auto-Detect Configuration

```bash
curl -X POST http://localhost:3001/api/agent/detect \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:11434",
    "apiKey": "optional-api-key"
  }'
```

## Configuration Options

### Chat Agent Configuration

```typescript
interface ConnectionConfig {
  url: string;                    // Chat agent endpoint URL
  method?: 'GET' | 'POST' | 'PUT'; // HTTP method (default: POST)
  headers?: Record<string, string>; // Custom headers
  auth?: {                        // Authentication
    type: 'bearer' | 'api-key' | 'basic';
    token?: string;               // Bearer token
    apiKey?: string;              // API key value
    headerName?: string;          // API key header name
    username?: string;            // Basic auth username
    password?: string;            // Basic auth password
  };
  timeout?: number;               // Request timeout (default: 30000ms)
  retries?: number;               // Retry attempts (default: 3)
  requestFormat?: 'json' | 'form' | 'text'; // Request format
  responseFormat?: 'json' | 'text'; // Response format
  messageField?: string;          // Request message field name
  responseField?: string;         // Response message field name
}
```

### Common Configurations

#### Ollama
```json
{
  "url": "http://localhost:11434/api/generate",
  "method": "POST",
  "messageField": "prompt",
  "responseField": "response"
}
```

#### OpenAI API
```json
{
  "url": "https://api.openai.com/v1/chat/completions",
  "method": "POST",
  "auth": {
    "type": "bearer",
    "token": "your-api-key"
  },
  "messageField": "messages",
  "responseField": "choices[0].message.content"
}
```

#### Text Generation WebUI
```json
{
  "url": "http://localhost:5000/api/v1/generate",
  "method": "POST",
  "messageField": "prompt",
  "responseField": "results[0].text"
}
```

## Real-time Updates

The backend provides real-time assessment progress via WebSocket:

```javascript
const socket = io('http://localhost:3001');

// Join assessment room
socket.emit('join-assessment', assessmentId);

// Listen for progress updates
socket.on('progress', (data) => {
  console.log('Progress:', data.progress);
});

// Listen for completion
socket.on('completed', (data) => {
  console.log('Assessment completed:', data.results);
});
```

## Security Considerations

### Rate Limiting
- General API: 100 requests per minute
- Assessment start: 5 assessments per 5 minutes
- Configurable limits via environment variables

### Input Validation
- All inputs are validated and sanitized
- URL validation for chat agent endpoints
- API key format validation
- Request size limits

### Error Handling
- Detailed error logging
- Graceful error responses
- No sensitive data in error messages
- Proper HTTP status codes

## Environment Variables

```env
# Server
PORT=3001
NODE_ENV=development
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000

# Optional OpenRouter key (can be provided per request)
OPENROUTER_API_KEY=sk-or-your-key

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Assessment limits
MAX_CONCURRENT_ASSESSMENTS=10
ASSESSMENT_TIMEOUT_MS=1800000
MAX_TEST_CASES_PER_VECTOR=5
```

## Development

### Project Structure
```
backend/
├── src/
│   ├── connectors/          # Chat agent connectors
│   ├── services/            # Business logic services
│   ├── routes/              # API route handlers
│   ├── middleware/          # Express middleware
│   ├── utils/               # Utility functions
│   └── index.ts             # Main server file
├── package.json
├── tsconfig.json
└── README.md
```

### Available Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests

### Adding New Chat Agent Support

1. Update `ChatAgentConnector.ts` with new configuration options
2. Add template in `/api/agent/templates` endpoint
3. Update auto-detection logic if needed
4. Add validation rules in `validation.ts`
5. Test with the new agent type

## Troubleshooting

### Common Issues

**Chat Agent Connection Failed**
- Verify the URL is accessible
- Check authentication credentials
- Ensure the agent is running
- Try different configuration options

**Assessment Stuck in Progress**
- Check backend logs for errors
- Verify OpenRouter API key is valid
- Ensure chat agent is responding
- Check rate limits

**WebSocket Connection Issues**
- Verify CORS configuration
- Check firewall/proxy settings
- Ensure frontend URL is whitelisted

### Debug Mode

Set `NODE_ENV=development` for detailed error messages and logging.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.