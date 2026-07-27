import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import { WechatReplyDraftService } from '../wechat-ilink/draft-service.js';
import { PersonalWechatBridgeStore } from './store.js';

export class PersonalWechatBridgeService {
 private readonly drafts:WechatReplyDraftService;
 constructor(private readonly config:AppConfig,private readonly repos:Repositories,private readonly store:PersonalWechatBridgeStore){this.drafts=new WechatReplyDraftService(config,repos)}
 async ingest(device:{id:string},input:{messageId:string;conversationId:string;conversationName?:string;text:string;isGroup?:boolean;receivedAt?:string}){
  const owner=await this.repos.getPrimaryOwnerConversation(this.config.telegram.ownerIds); if(!owner) throw new Error('owner_mapping_not_found');
  const externalId=`${device.id}:${input.messageId}`;
  const inbound=await this.repos.createChannelInboundMessage({channel:'wechat_personal',externalMessageId:externalId,externalChatId:input.conversationId,externalUserId:input.conversationId,userId:owner.userId,chatId:owner.chatId,text:input.text,raw:{deviceId:device.id,conversationName:input.conversationName,isGroup:input.isGroup,receivedAt:input.receivedAt}});
  if(inbound.duplicate) return {duplicate:true};
  const task=await this.repos.createTask({title:`个人微信回复：${input.conversationName??input.conversationId}`,description:input.text,originMessageId:inbound.internalMessageId,riskLevel:'medium',status:'running',planningMetadata:{source:'personal_wechat_bridge',deviceId:device.id,conversationId:input.conversationId}});
  if(input.isGroup){await this.repos.updateTaskStatus(task.id,'review','群聊自动回复当前已关闭。');return {duplicate:false,ignored:'group'}}
  const draft=await this.drafts.draft(input.text,input.conversationId);
  if(!draft){await this.repos.updateTaskStatus(task.id,'review','数字本人未生成可发送回复。');return {duplicate:false,queued:false}}
  const queued=await this.store.enqueue({deviceId:device.id,taskId:task.id,sourceMessageId:externalId,conversationId:input.conversationId,conversationName:input.conversationName,text:draft});
  await this.repos.updateTaskStatus(task.id,'waiting_external','回复已进入 Windows 客户端发送队列。');
  return {duplicate:false,queued:Boolean(queued),taskId:task.id};
 }
}
