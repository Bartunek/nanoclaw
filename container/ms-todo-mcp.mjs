#!/usr/bin/env node
/**
 * Microsoft To Do MCP Server — custom implementation using Node.js built-ins only.
 * No npm dependencies. Reads/writes tokens from MSTODO_TOKEN_FILE.
 * Auto-refreshes tokens using CLIENT_ID, CLIENT_SECRET, TENANT_ID env vars.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const TOKEN_FILE = process.env.MSTODO_TOKEN_FILE;
const CLIENT_ID = process.env.MS_TODO_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_TODO_CLIENT_SECRET;
const TENANT_ID = process.env.MS_TODO_TENANT_ID;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function loadTokens() {
  if (TOKEN_FILE && existsSync(TOKEN_FILE)) {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  }
  throw new Error('No token file found. Set MSTODO_TOKEN_FILE env var.');
}

function saveTokens(tokens) {
  if (TOKEN_FILE) {
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  }
}

async function refreshTokens(tokens) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'Tasks.ReadWrite User.Read offline_access',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }
  );
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const newTokens = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveTokens(newTokens);
  return newTokens;
}

async function getAccessToken() {
  let tokens = loadTokens();
  if (tokens.expiresAt && Date.now() > tokens.expiresAt - 60000) {
    tokens = await refreshTokens(tokens);
  }
  return tokens.accessToken;
}

async function graphCall(method, path, body = null) {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

const TOOLS = [
  {
    name: 'todo_list_lists',
    description: 'Get all Microsoft To Do task lists',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'todo_get_tasks',
    description: 'Get tasks from a To Do list. If listId is omitted, returns tasks from all lists.',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'Task list ID (optional)' },
        includeCompleted: { type: 'boolean', description: 'Include completed tasks (default: false)' },
      },
    },
  },
  {
    name: 'todo_create_task',
    description: 'Create a new task in a Microsoft To Do list',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'Task list ID (required)' },
        title: { type: 'string', description: 'Task title (required)' },
        body: { type: 'string', description: 'Task notes' },
        dueDate: { type: 'string', description: 'Due date YYYY-MM-DD' },
        importance: { type: 'string', enum: ['low', 'normal', 'high'] },
      },
      required: ['listId', 'title'],
    },
  },
  {
    name: 'todo_update_task',
    description: 'Update a task — change title, mark complete, set due date, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'Task list ID' },
        taskId: { type: 'string', description: 'Task ID' },
        title: { type: 'string' },
        status: { type: 'string', enum: ['notStarted', 'inProgress', 'completed', 'waitingOnOthers', 'deferred'] },
        importance: { type: 'string', enum: ['low', 'normal', 'high'] },
        body: { type: 'string', description: 'New notes' },
        dueDate: { type: 'string', description: 'Due date YYYY-MM-DD' },
      },
      required: ['listId', 'taskId'],
    },
  },
  {
    name: 'todo_delete_task',
    description: 'Delete a task',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'Task list ID' },
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['listId', 'taskId'],
    },
  },
  {
    name: 'todo_create_list',
    description: 'Create a new Microsoft To Do task list',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: 'List name' },
      },
      required: ['displayName'],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'todo_list_lists': {
      const data = await graphCall('GET', '/me/todo/lists');
      return data.value.map((l) => ({ id: l.id, name: l.displayName, isDefault: l.isDefault }));
    }
    case 'todo_get_tasks': {
      const lists = args.listId
        ? [{ id: args.listId, displayName: 'List' }]
        : (await graphCall('GET', '/me/todo/lists')).value;
      const results = [];
      for (const list of lists) {
        let path = `/me/todo/lists/${list.id}/tasks`;
        if (!args.includeCompleted) path += "?$filter=status ne 'completed'";
        const data = await graphCall('GET', path);
        for (const t of data.value) {
          results.push({
            id: t.id,
            listId: list.id,
            listName: list.displayName,
            title: t.title,
            status: t.status,
            importance: t.importance,
            dueDate: t.dueDateTime?.dateTime?.slice(0, 10) || null,
            body: t.body?.content || null,
          });
        }
      }
      return results;
    }
    case 'todo_create_task': {
      const body = { title: args.title, importance: args.importance || 'normal' };
      if (args.body) body.body = { content: args.body, contentType: 'text' };
      if (args.dueDate) body.dueDateTime = { dateTime: `${args.dueDate}T00:00:00`, timeZone: 'UTC' };
      const task = await graphCall('POST', `/me/todo/lists/${args.listId}/tasks`, body);
      return { id: task.id, title: task.title, status: task.status };
    }
    case 'todo_update_task': {
      const body = {};
      if (args.title !== undefined) body.title = args.title;
      if (args.status !== undefined) body.status = args.status;
      if (args.importance !== undefined) body.importance = args.importance;
      if (args.body !== undefined) body.body = { content: args.body, contentType: 'text' };
      if (args.dueDate !== undefined) body.dueDateTime = { dateTime: `${args.dueDate}T00:00:00`, timeZone: 'UTC' };
      const task = await graphCall('PATCH', `/me/todo/lists/${args.listId}/tasks/${args.taskId}`, body);
      return { id: task.id, title: task.title, status: task.status };
    }
    case 'todo_delete_task': {
      await graphCall('DELETE', `/me/todo/lists/${args.listId}/tasks/${args.taskId}`);
      return { deleted: true };
    }
    case 'todo_create_list': {
      const list = await graphCall('POST', '/me/todo/lists', { displayName: args.displayName });
      return { id: list.id, name: list.displayName };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP stdio protocol
const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'microsoft-todo', version: '1.0.0' },
        },
      });
    } else if (method === 'notifications/initialized') {
      // notification — no response
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const result = await callTool(params.name, params.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});
