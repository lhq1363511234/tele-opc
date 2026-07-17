import { Queue } from 'bullmq';

export const taskQueueName = 'tele-opc-tasks';

export interface TaskJobData {
  taskId: string;
  source: 'intake' | 'approval' | 'retry';
  approvalId?: string;
  actionType?: string;
}

export interface EnqueuedTask {
  jobId: string | number | undefined;
}

export interface TaskDispatcher {
  enqueueTask(data: TaskJobData): Promise<EnqueuedTask>;
}

export class BullMqTaskDispatcher implements TaskDispatcher {
  private readonly queue: Queue<TaskJobData>;

  constructor(redisUrl: string) {
    this.queue = createTaskQueue(redisUrl);
  }

  async enqueueTask(data: TaskJobData): Promise<EnqueuedTask> {
    const job = await this.queue.add('task.execute', data, {
      jobId: taskJobId(data),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 1000
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60
      }
    });
    return { jobId: job.id };
  }
}

export class NoopTaskDispatcher implements TaskDispatcher {
  async enqueueTask(_data: TaskJobData): Promise<EnqueuedTask> {
    return { jobId: undefined };
  }
}

export function createTaskQueue(redisUrl: string) {
  return new Queue<TaskJobData>(taskQueueName, {
    connection: parseRedisConnection(redisUrl)
  });
}

export function taskJobId(data: TaskJobData) {
  return ['task', data.source, data.taskId]
    .join('-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 180);
}

export function parseRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null
  };
}
