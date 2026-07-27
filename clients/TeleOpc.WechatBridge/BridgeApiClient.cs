using System.Net.Http.Headers; using System.Net.Http.Json; using System.Text.Json;
namespace TeleOpc.WechatBridge;
public sealed class BridgeApiClient {
 readonly HttpClient http=new(){Timeout=TimeSpan.FromSeconds(90)}; readonly BridgeSettings settings;
 public BridgeApiClient(BridgeSettings s){settings=s;http.BaseAddress=new Uri(s.ServerUrl.TrimEnd('/')+"/");http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",s.DeviceToken);}
 public async Task UploadAsync(WechatInbound m,CancellationToken ct){var r=await http.PostAsJsonAsync("api/bridge/v1/messages",m,ct);r.EnsureSuccessStatusCode();}
 public async Task<List<OutboxItem>> ClaimAsync(CancellationToken ct){var x=await http.GetFromJsonAsync<OutboxResponse>("api/bridge/v1/outbox?limit=10",ct);return x?.items??[];}
 public async Task AckAsync(OutboxItem i,bool sent,string? error,CancellationToken ct){var r=await http.PostAsJsonAsync($"api/bridge/v1/outbox/{i.id}/ack",new{leaseToken=i.lease_token,status=sent?"sent":"failed",error},ct);r.EnsureSuccessStatusCode();}
 public async Task HeartbeatAsync(string? error,CancellationToken ct)=>_=(await http.PostAsJsonAsync("api/bridge/v1/heartbeat",new{error},ct)).EnsureSuccessStatusCode();
}
public sealed record WechatInbound(string messageId,string conversationId,string? conversationName,string text,bool isGroup,string receivedAt);
public sealed class OutboxResponse{public bool ok{get;set;} public List<OutboxItem> items{get;set;}=[];}
public sealed class OutboxItem{public string id{get;set;}="";public string lease_token{get;set;}="";public string conversation_id{get;set;}="";public string? conversation_name{get;set;}public string text{get;set;}="";}
