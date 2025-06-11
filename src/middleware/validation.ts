import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ChatAgentConnector } from '../connectors/ChatAgentConnector';

// Validation schemas
const assessmentRequestSchema = Joi.object({
  targetName: Joi.string().required().min(1).max(200).trim(),
  targetDescription: Joi.string().optional().max(1000).trim(),
  chatAgentUrl: Joi.string().required().uri().custom((value, helpers) => {
    if (!ChatAgentConnector.validateUrl(value)) {
      return helpers.error('Invalid URL format');
    }
    return value;
  }),
  chatAgentConfig: Joi.object({
    method: Joi.string().valid('GET', 'POST', 'PUT').optional(),
    headers: Joi.object().optional(),
    auth: Joi.object({
      type: Joi.string().valid('bearer', 'api-key', 'basic').required(),
      token: Joi.string().optional(),
      apiKey: Joi.string().optional(),
      headerName: Joi.string().optional(),
      username: Joi.string().optional(),
      password: Joi.string().optional()
    }).optional(),
    timeout: Joi.number().integer().min(1000).max(120000).optional(),
    retries: Joi.number().integer().min(0).max(10).optional(),
    requestFormat: Joi.string().valid('json', 'form', 'text').optional(),
    responseFormat: Joi.string().valid('json', 'text').optional(),
    messageField: Joi.string().optional(),
    responseField: Joi.string().optional()
  }).optional(),
  openrouterApiKey: Joi.string().required().pattern(/^sk-or-/).messages({
    'string.pattern.base': 'OpenRouter API key must start with "sk-or-"'
  }),
  selectedModel: Joi.string().required().min(1),
  userId: Joi.string().optional()
});

const chatMessageSchema = Joi.object({
  url: Joi.string().required().uri(),
  message: Joi.string().required().min(1).max(10000),
  config: Joi.object().optional()
});

const testConnectionSchema = Joi.object({
  chatAgentUrl: Joi.string().required().uri(),
  chatAgentConfig: Joi.object().optional()
});

// Validation middleware factory
const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

// Specific validation middleware functions
export const validateAssessmentRequest = validate(assessmentRequestSchema);
export const validateChatMessage = validate(chatMessageSchema);
export const validateTestConnection = validate(testConnectionSchema);

// Custom validation functions
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const { openrouterApiKey } = req.body;
  
  if (!openrouterApiKey) {
    return res.status(400).json({
      success: false,
      message: 'OpenRouter API key is required'
    });
  }

  if (!openrouterApiKey.startsWith('sk-or-')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid OpenRouter API key format. Must start with "sk-or-"'
    });
  }

  if (openrouterApiKey.length < 20) {
    return res.status(400).json({
      success: false,
      message: 'OpenRouter API key appears to be too short'
    });
  }

  next();
};

export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Basic input sanitization
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.trim().slice(0, 10000); // Limit string length
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitize(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  next();
};

// Rate limiting validation
export const validateAssessmentRateLimit = (req: Request, res: Response, next: NextFunction) => {
  // Check if user is making too many concurrent assessments
  // This would typically check against a database or Redis
  // For now, we'll just pass through
  next();
};