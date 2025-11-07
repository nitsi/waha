'use strict';

require('dotenv').config();

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Client } = require('@modelcontextprotocol/sdk/client');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const MCP_HTTP_URL = process.env.MCP_HTTP_URL ?? 'http://localhost:3000/mcp';
const API_KEY = process.env.WAHA_MCP_HTTP_API_KEY ?? process.env.WAHA_API_KEY;
const HTTP_TIMEOUT_MS = Number(process.env.MCP_HTTP_TIMEOUT_MS ?? 5000);

function createTransport() {
  const fetchWithTimeout = async (input, init = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(
          `MCP HTTP request timed out after ${HTTP_TIMEOUT_MS}ms (${MCP_HTTP_URL})`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  return new StreamableHTTPClientTransport(MCP_HTTP_URL, {
    fetch: fetchWithTimeout,
    requestInit: {
      headers: {
        ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
      },
    },
  });
}

test('MCP HTTP endpoint exposes WAHA tools', async () => {
  const client = new Client({
    name: 'waha-mcp-http-test',
    version: '1.0.0',
  });
  const transport = createTransport();

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();

    assert.ok(Array.isArray(tools), 'tools/list did not return an array');
    assert.ok(tools.length > 0, 'tools/list returned no tools');

    const toolNames = tools.map((tool) => tool.name);
    for (const expectedTool of ['waha_send_text', 'waha_list_sessions']) {
      assert.ok(
        toolNames.includes(expectedTool),
        `Expected tool '${expectedTool}' but only received: ${toolNames.join(
          ', ',
        )}`,
      );
    }
  } finally {
    await client.close().catch(() => undefined);
  }
});
