import { loadConfig } from '../src/config/index.js';
import { FeishuBaseClient } from '../src/appos/feishu/base-client.js';
const c=loadConfig();
const client=new FeishuBaseClient({appId:c.feishu.appId,appSecret:c.feishu.appSecret,appToken:c.feishu.baseAppToken,baseUrl:c.feishu.openBaseUrl});
const id='baf_probe_analytics_id';
const found=await client.findRecordsByField('AnalyticsFacts','id',id);
console.log('found', found.length);
if (!found.length) {
 const r=await client.createRecord('AnalyticsFacts',{id,title:'[系统事实] 分析同步探针',date:Date.now(),grain:'event',scope:'ops',metric_code:'sync_probe',metric_name:'同步探针',metric_value:1,status:'ok',note:'自动化事实同步连通性校验',demo_tag:''});
 console.log('created',r.record_id);
} else console.log('exists',found[0].record_id);
