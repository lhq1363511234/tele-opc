import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const taskId = process.argv[2];
const campaignId = process.argv[3] || '';
if (!taskId) {
  console.error('usage: node enqueue_mail_console_test.mjs <taskId> [campaignId]');
  process.exit(1);
}
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL missing');
  process.exit(1);
}
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue('tele-opc-tasks', { connection });
const job = await queue.add(
  'task',
  { taskId, source: 'mail_console_test' },
  { removeOnComplete: 100, removeOnFail: 100 }
);
console.log(JSON.stringify({ ok: true, jobId: job.id, taskId, campaignId }));
await queue.close();
await connection.quit();
