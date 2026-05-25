import {
  createDanaClient,
  DanaClientError,
  type WorkUnitInput,
} from '@metaswarm-dashboard/dana-client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

const DANA_BASE_URL = process.env['DANA_SERVER_URL'] ?? 'http://localhost:4173';

const CreateTaskBody = z.object({
  goal: z.string().min(1, 'goal is required'),
  workUnits: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        spec: z.string().min(1),
        checkpoint: z.boolean().optional(),
      }),
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  gitRemote: z.string().optional(),
});

const ApproveCheckpointBody = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().optional(),
});

function danaErrorHandler(reply: FastifyReply, err: unknown): void {
  if (err instanceof DanaClientError) {
    const body = err.body;
    let message = err.message;
    if (typeof body === 'object' && body !== null) {
      const bodyErr = (body as Record<string, unknown>).error;
      if (typeof bodyErr === 'string') {
        message = bodyErr;
      }
    }
    void reply.code(err.status).send({
      error: {
        code: 'dana_error',
        message,
        detail: err.body,
      },
    });
    return;
  }
  void reply.code(502).send({
    error: {
      code: 'upstream_error',
      message: err instanceof Error ? err.message : 'Unknown upstream error',
    },
  });
}

export function registerVirtualFactoryRoutes(app: FastifyInstance): void {
  const dana = createDanaClient(DANA_BASE_URL);

  app.get('/api/virtual-factory/tasks', async (req, reply) => {
    try {
      const status = (req.query as { status?: string }).status;
      const tasks = await dana.listTasks(status);
      return reply.code(200).send(tasks);
    } catch (err) {
      danaErrorHandler(reply, err);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/virtual-factory/tasks/:id',
    async (req, reply) => {
      try {
        const task = await dana.getTask(req.params.id);
        return reply.code(200).send(task);
      } catch (err) {
        danaErrorHandler(reply, err);
      }
    },
  );

  app.post('/api/virtual-factory/tasks', async (req, reply) => {
    const parsed = CreateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'bad_request',
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      });
    }
    try {
      const { goal, workUnits, tags, workingDir, gitRemote } = parsed.data;
      const result = await dana.createTask(
        goal,
        workUnits as WorkUnitInput[] | undefined,
        tags,
        workingDir,
        gitRemote,
      );
      return reply.code(201).send(result);
    } catch (err) {
      danaErrorHandler(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/virtual-factory/tasks/:id/cancel',
    async (req, reply) => {
      try {
        await dana.cancelTask(req.params.id);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        danaErrorHandler(reply, err);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/virtual-factory/tasks/:id',
    async (req, reply) => {
      try {
        await dana.deleteTask(req.params.id);
        return reply.code(200).send({ status: 'deleted' });
      } catch (err) {
        danaErrorHandler(reply, err);
      }
    },
  );

  app.get('/api/virtual-factory/checkpoints', async (req, reply) => {
    try {
      const checkpoints = await dana.listCheckpoints();
      return reply.code(200).send(checkpoints);
    } catch (err) {
      danaErrorHandler(reply, err);
    }
  });

  app.post<{ Params: { taskId: string } }>(
    '/api/virtual-factory/checkpoints/:taskId/approve',
    async (req, reply) => {
      const parsed = ApproveCheckpointBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'bad_request',
            message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          },
        });
      }
      try {
        const { action, comment } = parsed.data;
        await dana.approveCheckpoint(req.params.taskId, action, comment);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        danaErrorHandler(reply, err);
      }
    },
  );

  app.get('/api/virtual-factory/config', async (req, reply) => {
    try {
      const config = await dana.getConfig();
      return reply.code(200).send(config);
    } catch (err) {
      danaErrorHandler(reply, err);
    }
  });

  app.get('/api/virtual-factory/health', async (req, reply) => {
    try {
      const health = await dana.getHealth();
      return reply.code(200).send(health);
    } catch (err) {
      danaErrorHandler(reply, err);
    }
  });
}
