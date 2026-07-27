import crypto, { randomUUID } from 'node:crypto';
import type pg from 'pg';

export class PersonalWechatBridgeStore {
  constructor(private readonly pool: pg.Pool) {}
  async createDevice(name: string, settings: Record<string, unknown> = {}) {
    const id=`brd_${randomUUID()}`; const token=`brg_${crypto.randomBytes(32).toString('base64url')}`;
    const hash=hashToken(token);
    const result=await this.pool.query(`INSERT INTO bridge_devices(id,name,token_hash,settings) VALUES($1,$2,$3,$4) RETURNING id,name,platform,status,settings,created_at`,[id,name,hash,JSON.stringify(settings)]);
    return {device:result.rows[0],token};
  }
  async authenticate(token: string) {
    if(!token.startsWith('brg_')) return null;
    const result=await this.pool.query(`SELECT id,name,platform,status,settings,last_seen_at,last_error,created_at,updated_at FROM bridge_devices WHERE token_hash=$1 AND status='active'`,[hashToken(token)]);
    return result.rows[0] ?? null;
  }
  async heartbeat(deviceId:string, error?:string) { await this.pool.query(`UPDATE bridge_devices SET last_seen_at=now(),last_error=$2,updated_at=now() WHERE id=$1`,[deviceId,error??null]); }
  async listDevices(){ return (await this.pool.query(`SELECT id,name,platform,status,settings,last_seen_at,last_error,created_at,updated_at FROM bridge_devices ORDER BY created_at DESC`)).rows; }
  async enqueue(params:{deviceId:string;taskId:string;sourceMessageId:string;conversationId:string;conversationName?:string;text:string}){
    const result=await this.pool.query(`INSERT INTO bridge_outbox(id,device_id,task_id,source_message_id,conversation_id,conversation_name,text) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(device_id,source_message_id) DO NOTHING RETURNING *`,[`bro_${randomUUID()}`,params.deviceId,params.taskId,params.sourceMessageId,params.conversationId,params.conversationName??null,params.text]);
    return result.rows[0]??null;
  }
  async claim(deviceId:string,limit:number){
    const client=await this.pool.connect(); try{ await client.query('BEGIN');
      const lease=`lease_${randomUUID()}`;
      const result=await client.query(`WITH picked AS (SELECT id FROM bridge_outbox WHERE device_id=$1 AND (status='pending' OR (status='leased' AND leased_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE bridge_outbox b SET status='leased',lease_token=$3,leased_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() FROM picked WHERE b.id=picked.id RETURNING b.*`,[deviceId,limit,lease]);
      await client.query('COMMIT'); return result.rows;
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async ack(deviceId:string,id:string,leaseToken:string,status:'sent'|'failed',error?:string){
    const result=await this.pool.query(`UPDATE bridge_outbox SET status=$4,error=$5,lease_token=NULL,leased_until=NULL,updated_at=now() WHERE id=$1 AND device_id=$2 AND lease_token=$3 RETURNING *`,[id,deviceId,leaseToken,status,error??null]); return result.rows[0]??null;
  }
}
export function hashToken(token:string){return crypto.createHash('sha256').update(token).digest('hex')}
