import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SessionManager } from '@waha/core/abc/manager.abc';
import {
  MessageTextRequest,
  MessageImageRequest,
  MessageFileRequest,
  CheckNumberStatusQuery,
} from '@waha/structures/chatting.dto';
import { ContactQuery } from '@waha/structures/contacts.dto';

@Injectable()
export class WahaMcpService implements OnModuleInit {
  private readonly logger = new Logger(WahaMcpService.name);
  private mcpServer: McpServer;

  constructor(private sessionManager: SessionManager) {}

  async onModuleInit() {
    const enableMcp = process.env.WAHA_MCP_ENABLED === 'true';
    if (!enableMcp) {
      this.logger.log('MCP server is disabled. Set WAHA_MCP_ENABLED=true to enable.');
      return;
    }

    this.logger.log('Initializing WAHA MCP Server...');
    this.mcpServer = new McpServer({
      name: 'waha',
      version: '1.0.0',
    });

    this.registerTools();
    this.registerResources();
    this.registerPrompts();

    // Connect via stdio for local process communication
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    this.logger.log('WAHA MCP Server initialized successfully');
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
          chatId: z.string().describe('Chat ID (phone number with @c.us or group ID)'),
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
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const request = new MessageTextRequest();
          request.session = session;
          request.chatId = chatId;
          request.text = text;
          const result = await whatsapp.sendText(request);

          const output = {
            id: result.id,
            timestamp: result.timestamp,
            from: result.from,
            to: result.to,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          fileUrl: z.string().optional().describe('Image URL'),
          fileData: z.string().optional().describe('Base64 encoded image'),
          mimetype: z.string().optional().describe('MIME type'),
          filename: z.string().optional().describe('File name'),
          caption: z.string().optional().describe('Image caption'),
        },
        outputSchema: {
          id: z.string(),
          timestamp: z.number().optional(),
        },
      },
      async ({ session, chatId, fileUrl, fileData, mimetype, filename, caption }) => {
        try {
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const request = new MessageImageRequest();
          request.session = session;
          request.chatId = chatId;
          if (fileUrl) {
            request.file = { url: fileUrl, mimetype: mimetype || 'image/jpeg', filename };
          } else if (fileData) {
            request.file = { data: fileData, mimetype: mimetype || 'image/jpeg', filename };
          }
          request.caption = caption;
          const result = await whatsapp.sendImage(request);

          const output = {
            id: result.id,
            timestamp: result.timestamp,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          fileUrl: z.string().optional().describe('File URL'),
          fileData: z.string().optional().describe('Base64 encoded file'),
          mimetype: z.string().describe('MIME type (required)'),
          filename: z.string().optional().describe('File name'),
          caption: z.string().optional().describe('File caption'),
        },
        outputSchema: {
          id: z.string(),
          timestamp: z.number().optional(),
        },
      },
      async ({ session, chatId, fileUrl, fileData, mimetype, filename, caption }) => {
        try {
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
            id: result.id,
            timestamp: result.timestamp,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const query = new CheckNumberStatusQuery();
          query.session = session;
          query.phone = phone;
          const result = await whatsapp.checkNumberStatus(query);

          const output = {
            numberExists: result.numberExists,
            chatId: result.chatId,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          contactId: z.string().describe('Contact ID (phone number with @c.us)'),
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
          const whatsapp = await this.sessionManager.getWorkingSession(session);
          const query = new ContactQuery();
          query.session = session;
          query.contactId = contactId;
          const result: any = await whatsapp.getContact(query);

          const output = {
            id: result?.id || contactId,
            name: result?.name || '',
            pushname: result?.pushname || '',
            isMyContact: result?.isMyContact || false,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          all: z.boolean().optional().describe('Include stopped sessions'),
        },
        outputSchema: {
          sessions: z.array(z.object({
            name: z.string(),
            status: z.string(),
          })),
        },
      },
      async ({ all }) => {
        try {
          const sessions = await this.sessionManager.getSessions(all);
          const output = {
            sessions: sessions.map(s => ({
              name: s.name,
              status: s.status,
            })),
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          me: z.object({
            id: z.string().optional(),
            pushName: z.string().optional(),
          }).optional(),
        },
      },
      async ({ session }) => {
        try {
          const sessionInfo = await this.sessionManager.getSessionInfo(session);
          if (!sessionInfo) {
            throw new Error('Session not found');
          }

          const output = {
            name: sessionInfo.name,
            status: sessionInfo.status,
            me: sessionInfo.me,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
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
          const data = sessions.map(s => ({
            name: s.name,
            status: s.status,
            me: s.me,
          }));

          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            }],
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            contents: [{
              uri: uri.href,
              text: `Error: ${errorMsg}`,
            }],
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
          messageType: z.enum(['text', 'image', 'file']).describe('Type of message to send'),
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
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: instructions,
            },
          }],
        };
      },
    );

    this.logger.log('Registered 1 MCP prompt');
  }
}
