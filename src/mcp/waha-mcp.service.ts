import {
  Injectable,
  Logger,
  OnModuleInit,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { SessionManager } from '@waha/core/abc/manager.abc';
import {
  MessageTextRequest,
  MessageImageRequest,
  MessageFileRequest,
  CheckNumberStatusQuery,
} from '@waha/structures/chatting.dto';
import { ContactQuery } from '@waha/structures/contacts.dto';
import { WhatsappConfigService } from '@waha/config.service';

@Injectable()
export class WahaMcpService implements OnModuleInit {
  private readonly logger = new Logger(WahaMcpService.name);
  private mcpServer: any; // MCP Server instance
  private httpTransport: any; // Reusable HTTP transport instance
  private enabledTransports: string[] = [];
  private McpServer: any;
  private StdioServerTransportClass: any;
  private StreamableHTTPServerTransportClass: any;

  constructor(
    private sessionManager: SessionManager,
    private configService: WhatsappConfigService,
  ) {}

  async onModuleInit() {
    const enableMcp = process.env.WAHA_MCP_ENABLED === 'true';
    if (!enableMcp) {
      this.logger.log(
        'MCP server is disabled. Set WAHA_MCP_ENABLED=true to enable.',
      );
      return;
    }

    this.logger.log('Initializing WAHA MCP Server...');

    // Lazy-load MCP SDK only when enabled
    // Direct requires to workaround MCP SDK export path resolution issues in CommonJS
    try {
      const McpSdk = require('@modelcontextprotocol/sdk/server/mcp.js');
      const StdioTransportSdk = require('@modelcontextprotocol/sdk/server/stdio.js');
      const HttpTransportSdk = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

      // MCP SDK exports McpServer (not Server)
      this.McpServer = McpSdk.McpServer;
      this.StdioServerTransportClass = StdioTransportSdk.StdioServerTransport;
      this.StreamableHTTPServerTransportClass =
        HttpTransportSdk.StreamableHTTPServerTransport;

      if (
        !this.McpServer ||
        !this.StdioServerTransportClass ||
        !this.StreamableHTTPServerTransportClass
      ) {
        this.logger.error('Could not load required MCP SDK classes');
        return;
      }
    } catch (error) {
      this.logger.error('Failed to load MCP SDK', error);
      return;
    }

    this.mcpServer = new this.McpServer({
      name: 'waha',
      version: '1.0.0',
    });

    this.registerTools();
    this.registerResources();
    this.registerPrompts();
    this.setupRequestLogging();

    // Determine which transports to enable
    const enableStdio = process.env.WAHA_MCP_STDIO !== 'false'; // Default: enabled
    const enableHttp = process.env.WAHA_MCP_HTTP === 'true'; // Default: disabled

    // Connect via stdio for local process communication (like Claude Desktop)
    if (enableStdio) {
      try {
        const transport = new this.StdioServerTransportClass();
        await this.mcpServer.connect(transport);
        this.enabledTransports.push('stdio');
        this.logger.log(
          'WAHA MCP Server stdio transport initialized - client connected',
        );
      } catch (error) {
        this.logger.warn(
          'Failed to initialize stdio transport (this is normal if not running as subprocess)',
          error,
        );
      }
    }

    // HTTP transport is handled via controller
    if (enableHttp) {
      try {
        // Create and connect a single reusable HTTP transport
        this.httpTransport = new this.StreamableHTTPServerTransportClass({
          sessionIdGenerator: undefined, // Stateless mode
          enableJsonResponse: true,
        });

        // Connect the HTTP transport once during initialization
        await this.mcpServer.connect(this.httpTransport);

        this.enabledTransports.push('http');
        this.logger.log('WAHA MCP Server HTTP transport enabled at /mcp');
      } catch (error) {
        this.logger.error('Failed to initialize HTTP transport', error);
      }
    }

    this.logger.log(
      `WAHA MCP Server initialized successfully with transports: ${this.enabledTransports.join(
        ', ',
      )}`,
    );
  }

  /**
   * Handle HTTP requests to the MCP endpoint
   * Reuses a single transport instance that was connected during initialization
   */
  async handleHttpRequest(req: Request, res: Response) {
    if (!this.httpTransport) {
      res.status(503).json({ error: 'MCP HTTP transport not initialized' });
      return;
    }

    this.logger.log(
      `New MCP HTTP request from ${req.ip || req.socket.remoteAddress}`,
    );

    try {
      // Reuse the connected transport for this request
      await this.httpTransport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error('Error handling MCP HTTP request', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Assert that a session is allowed for MCP access.
   * Throws ForbiddenException if the session is not in the allowlist.
   * @param sessionName - The session name to check
   * @throws ForbiddenException if session is not allowed
   */
  private assertMcpSessionAllowed(sessionName: string): void {
    if (!this.configService.isMcpSessionAllowed(sessionName)) {
      const allowedSessions = this.configService.getMcpAllowedSessions();
      const allowedList =
        allowedSessions && allowedSessions.length > 0
          ? allowedSessions.join(', ')
          : 'none configured';

      this.logger.warn(
        `MCP access denied for session "${sessionName}". Allowed sessions: ${allowedList}`,
      );

      throw new ForbiddenException(
        `Session "${sessionName}" is not allowed for MCP access. ` +
          `Allowed sessions: ${allowedList}. ` +
          `Configure WAHA_MCP_ALLOWED_SESSIONS to grant access.`,
      );
    }
  }

  /**
   * Serialize message ID to string.
   * Handles both WEBJS (object with _serialized) and NOWEB/GOWS (may already be string).
   */
  private serializeId(id: any): string {
    if (typeof id === 'string') {
      return id;
    }
    if (id && typeof id === 'object') {
      // WEBJS engine returns an object with _serialized property
      return id._serialized || id.id || String(id);
    }
    return String(id);
  }

  /**
   * Serialize a field that might be an ID object or string.
   */
  private serializeField(field: any): string | undefined {
    if (!field) {
      return undefined;
    }
    if (typeof field === 'string') {
      return field;
    }
    if (typeof field === 'object' && field._serialized) {
      return field._serialized;
    }
    return String(field);
  }

  private setupRequestLogging() {
    if (!this.mcpServer) {
      return;
    }

    const server = (this.mcpServer as any).server;
    const handlers: Map<string, any> | undefined = server?._requestHandlers;
    if (!(handlers instanceof Map)) {
      this.logger.warn(
        'MCP SDK does not expose request handlers; skipping MCP request logging hooks',
      );
      return;
    }

    this.wrapRequestHandler(
      handlers,
      'tools/list',
      async (original, request, extra) => {
        this.logger.log('MCP client is discovering available tools');
        const response = await original(request, extra);
        const tools = Array.isArray(response?.tools) ? response.tools : [];
        this.logger.log(`Returned ${tools.length} tools to MCP client`);
        return response;
      },
    );

    this.wrapRequestHandler(
      handlers,
      'resources/list',
      async (original, request, extra) => {
        this.logger.log('MCP client is discovering available resources');
        const response = await original(request, extra);
        const resources = Array.isArray(response?.resources)
          ? response.resources
          : [];
        this.logger.log(`Returned ${resources.length} resources to MCP client`);
        return response;
      },
    );
  }

  private wrapRequestHandler(
    handlers: Map<string, any>,
    method: string,
    wrapper: (
      original: (req?: any, extra?: any) => Promise<any>,
      request: any,
      extra: any,
    ) => Promise<any>,
  ) {
    const original = handlers.get(method);
    if (typeof original !== 'function') {
      this.logger.warn(
        `MCP handler for ${method} not found; skipping logging hook`,
      );
      return;
    }

    handlers.set(method, (request: any, extra: any) =>
      wrapper(original, request, extra),
    );
  }

  private registerTools() {
    // Tool: Send Text Message
    this.mcpServer.registerTool(
      'waha_send_text',
      {
        title: 'Send Text Message',
        description: 'Send a text message via WhatsApp',
        inputSchema: {
          session: z.string().describe('Session name'),
          chatId: z
            .string()
            .describe('Chat ID (phone number with @c.us or group ID)'),
          text: z.string().describe('Message text'),
        },
        outputSchema: {
          id: z.string(),
          timestamp: z.number().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        },
      },
      async ({ session, chatId, text }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const request = new MessageTextRequest();
          request.session = session;
          request.chatId = chatId;
          request.text = text;
          const result = await whatsapp.sendText(request);

          const output = {
            id: this.serializeId(result.id),
            timestamp: result.timestamp,
            from: this.serializeField(result.from),
            to: this.serializeField(result.to),
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: Send Image
    this.mcpServer.registerTool(
      'waha_send_image',
      {
        title: 'Send Image',
        description: 'Send an image via WhatsApp from URL or base64',
        inputSchema: {
          session: z.string().describe('Session name'),
          chatId: z.string().describe('Chat ID'),
          fileUrl: z
            .string()
            .optional()
            .describe('Image URL'),
          fileData: z
            .string()
            .optional()
            .describe('Base64 encoded image'),
          mimetype: z
            .string()
            .optional()
            .describe('MIME type'),
          filename: z
            .string()
            .optional()
            .describe('File name'),
          caption: z
            .string()
            .optional()
            .describe('Image caption'),
        },
        outputSchema: {
          id: z.string(),
          timestamp: z.number().optional(),
        },
      },
      async ({
        session,
        chatId,
        fileUrl,
        fileData,
        mimetype,
        filename,
        caption,
      }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const request = new MessageImageRequest();
          request.session = session;
          request.chatId = chatId;
          if (fileUrl) {
            request.file = {
              url: fileUrl,
              mimetype: mimetype || 'image/jpeg',
              filename,
            };
          } else if (fileData) {
            request.file = {
              data: fileData,
              mimetype: mimetype || 'image/jpeg',
              filename,
            };
          }
          request.caption = caption;
          const result = await whatsapp.sendImage(request);

          const output = {
            id: this.serializeId(result.id),
            timestamp: result.timestamp,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: Send File
    this.mcpServer.registerTool(
      'waha_send_file',
      {
        title: 'Send File',
        description: 'Send a file via WhatsApp from URL or base64',
        inputSchema: {
          session: z.string().describe('Session name'),
          chatId: z.string().describe('Chat ID'),
          fileUrl: z
            .string()
            .optional()
            .describe('File URL'),
          fileData: z
            .string()
            .optional()
            .describe('Base64 encoded file'),
          mimetype: z.string().describe('MIME type (required)'),
          filename: z
            .string()
            .optional()
            .describe('File name'),
          caption: z
            .string()
            .optional()
            .describe('File caption'),
        },
        outputSchema: {
          id: z.string(),
          timestamp: z.number().optional(),
        },
      },
      async ({
        session,
        chatId,
        fileUrl,
        fileData,
        mimetype,
        filename,
        caption,
      }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const request = new MessageFileRequest();
          request.session = session;
          request.chatId = chatId;
          if (fileUrl) {
            request.file = { url: fileUrl, mimetype, filename };
          } else if (fileData) {
            request.file = { data: fileData, mimetype, filename };
          }
          request.caption = caption;
          const result = await whatsapp.sendFile(request);

          const output = {
            id: this.serializeId(result.id),
            timestamp: result.timestamp,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: Check Number Exists
    this.mcpServer.registerTool(
      'waha_check_number',
      {
        title: 'Check Number Status',
        description: 'Check if a phone number is registered on WhatsApp',
        inputSchema: {
          session: z.string().describe('Session name'),
          phone: z.string().describe('Phone number in international format'),
        },
        outputSchema: {
          numberExists: z.boolean(),
          chatId: z.string().optional(),
        },
      },
      async ({ session, phone }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const query = new CheckNumberStatusQuery();
          query.session = session;
          query.phone = phone;
          const result = await whatsapp.checkNumberStatus(query);

          const output = {
            numberExists: result.numberExists,
            chatId: this.serializeField(result.chatId),
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: Get Contact Info
    this.mcpServer.registerTool(
      'waha_get_contact',
      {
        title: 'Get Contact Info',
        description: 'Get contact information from WhatsApp',
        inputSchema: {
          session: z.string().describe('Session name'),
          contactId: z
            .string()
            .describe('Contact ID (phone number with @c.us)'),
        },
        outputSchema: {
          id: z.string(),
          name: z.string().optional(),
          pushname: z.string().optional(),
          isMyContact: z.boolean().optional(),
        },
      },
      async ({ session, contactId }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const query = new ContactQuery();
          query.session = session;
          query.contactId = contactId;
          const result: any = await whatsapp.getContact(query);

          const output = {
            id: this.serializeField(result?.id) || contactId,
            name: result?.name || '',
            pushname: result?.pushname || '',
            isMyContact: result?.isMyContact || false,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: List Sessions
    this.mcpServer.registerTool(
      'waha_list_sessions',
      {
        title: 'List Sessions',
        description: 'List all WhatsApp sessions',
        inputSchema: {
          all: z
            .boolean()
            .optional()
            .describe('Include stopped sessions'),
        },
        outputSchema: {
          sessions: z.array(
            z.object({
              name: z.string(),
              status: z.string(),
            }),
          ),
        },
      },
      async ({ all }) => {
        try {
          const sessions = await this.sessionManager.getSessions(all);
          // Filter sessions based on MCP allowlist
          const allowedSessions = sessions.filter((s) =>
            this.configService.isMcpSessionAllowed(s.name),
          );
          const output = {
            sessions: allowedSessions.map((s) => ({
              name: s.name,
              status: s.status,
            })),
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    // Tool: Get Session Info
    this.mcpServer.registerTool(
      'waha_get_session',
      {
        title: 'Get Session Info',
        description: 'Get detailed information about a WhatsApp session',
        inputSchema: {
          session: z.string().describe('Session name'),
        },
        outputSchema: {
          name: z.string(),
          status: z.string(),
          me: z
            .object({
              id: z.string().optional(),
              pushName: z.string().optional(),
            })
            .optional(),
        },
      },
      async ({ session }) => {
        try {
          this.assertMcpSessionAllowed(session);
          const sessionInfo = await this.sessionManager.getSessionInfo(session);
          if (!sessionInfo) {
            throw new Error('Session not found');
          }

          const output = {
            name: sessionInfo.name,
            status: sessionInfo.status,
            me: sessionInfo.me
              ? {
                  id: this.serializeField(sessionInfo.me.id),
                  pushName: sessionInfo.me.pushName,
                }
              : undefined,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      },
    );

    this.logger.log('Registered 7 MCP tools');
  }

  private registerResources() {
    // Resource: Session list
    this.mcpServer.registerResource(
      'sessions',
      'waha://sessions',
      {
        title: 'WhatsApp Sessions',
        description: 'List of all active WhatsApp sessions',
        mimeType: 'application/json',
      },
      async (uri) => {
        try {
          const sessions = await this.sessionManager.getSessions(false);
          // Filter sessions based on MCP allowlist
          const allowedSessions = sessions.filter((s) =>
            this.configService.isMcpSessionAllowed(s.name),
          );
          const data = allowedSessions.map((s) => ({
            name: s.name,
            status: s.status,
            me: s.me,
          }));

          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            contents: [
              {
                uri: uri.href,
                text: `Error: ${errorMsg}`,
              },
            ],
          };
        }
      },
    );

    this.logger.log('Registered 1 MCP resource');
  }

  private registerPrompts() {
    // Prompt: Send a message workflow
    this.mcpServer.registerPrompt(
      'send-message',
      {
        title: 'Send WhatsApp Message',
        description: 'Guide through sending a WhatsApp message',
        argsSchema: {
          session: z.string().describe('Session name'),
          recipient: z.string().describe('Recipient phone number or chat ID'),
          messageType: z
            .enum(['text', 'image', 'file'])
            .describe('Type of message to send'),
        },
      },
      ({ session, recipient, messageType }) => {
        let instructions = `You are helping send a WhatsApp message using WAHA (WhatsApp HTTP API).\n\n`;
        instructions += `Session: ${session}\n`;
        instructions += `Recipient: ${recipient}\n`;
        instructions += `Message Type: ${messageType}\n\n`;

        if (messageType === 'text') {
          instructions += `To send a text message, use the waha_send_text tool with:\n`;
          instructions += `- session: "${session}"\n`;
          instructions += `- chatId: "${recipient}"\n`;
          instructions += `- text: <message content>\n`;
        } else if (messageType === 'image') {
          instructions += `To send an image, use the waha_send_image tool with:\n`;
          instructions += `- session: "${session}"\n`;
          instructions += `- chatId: "${recipient}"\n`;
          instructions += `- file.url: <image URL> OR file.data: <base64 image>\n`;
          instructions += `- caption: <optional caption>\n`;
        } else if (messageType === 'file') {
          instructions += `To send a file, use the waha_send_file tool with:\n`;
          instructions += `- session: "${session}"\n`;
          instructions += `- chatId: "${recipient}"\n`;
          instructions += `- file.url: <file URL> OR file.data: <base64 file>\n`;
          instructions += `- caption: <optional caption>\n`;
        }

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: instructions,
              },
            },
          ],
        };
      },
    );

    this.logger.log('Registered 1 MCP prompt');
  }
}
